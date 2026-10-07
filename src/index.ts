import wasmModule from "../dist/classes.wasm";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
}

// 1. Explicit TeaVM imports required by the WebAssembly module
const teavmImports: WebAssembly.Imports = {
  teavm: {
    currentTimeMillis: () => Date.now(),
    logChar: (c: number) => console.log(String.fromCharCode(c)),
    logInt: (i: number) => console.log(i),
    logString: (s: any) => console.log(s),
    putchar: (c: number) => console.log(String.fromCharCode(c)),
    logOutOfMemory: () => console.error("TeaVM Out Of Memory Error"),
  },
  teavmMath: Math as unknown as Record<string, WebAssembly.ImportValue>,
};

// 2. Cache the WebAssembly instance globally to speed up cold starts
let wasmInstancePromise: Promise<WebAssembly.Instance> | null = null;

async function getWasmInstance(): Promise<WebAssembly.Instance> {
  if (!wasmInstancePromise) {
    wasmInstancePromise = WebAssembly.instantiate(wasmModule, teavmImports);
  }
  return wasmInstancePromise;
}

// Convert Hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    buf[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return buf;
}

// Verify Ed25519 signature sent by Discord
async function verifyDiscordRequest(
  request: Request,
  body: string,
  publicKeyHex: string,
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!signature || !timestamp || !publicKeyHex) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToUint8Array(publicKeyHex) as BufferSource,
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
      false,
      ["verify"],
    );

    const encoder = new TextEncoder();
    return await crypto.subtle.verify(
      "NODE-ED25519",
      key,
      hexToUint8Array(signature) as BufferSource,
      encoder.encode(timestamp + body) as BufferSource,
    );
  } catch (e) {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await request.text();

    // Step 1: Verify incoming Discord request signature
    const isValid = await verifyDiscordRequest(
      request,
      body,
      env.DISCORD_PUBLIC_KEY,
    );
    if (!isValid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    // Step 2: Handle Discord PING (Type 1)
    const interaction = JSON.parse(body);
    if (interaction.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const instance = await getWasmInstance();
      const exports = instance.exports as any;

      // Ensure export exists
      if (typeof exports.handleRequest !== "function") {
        throw new Error(
          "Exported method 'handleRequest' not found on Wasm instance.",
        );
      }

      const commandName = interaction.data?.name;
      const commandCode = { ping: 1, hello: 2, info: 3 }[commandName as
        "ping" | "hello" | "info"] || 0;
      const result = exports.handleRequest(commandCode);
      const content = {
        1: "🏓 Pong from Java TeaVM on Cloudflare Edge!",
        2: "👋 Hello there from Cloudflare Workers!",
        3: "🤖 **Bot Status:** Online | **Runtime:** Java 17 (TeaVM Wasm) on Cloudflare Edge",
      }[result as 1 | 2 | 3] || `Unknown command: ${commandName || ""}`;
      const responseJson = JSON.stringify({
        type: 4,
        data: { content },
      });

      return new Response(responseJson, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("Wasm Execution Error:", err);

      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `⚠️ Error executing Java Worker: ${err?.message || err}`,
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
