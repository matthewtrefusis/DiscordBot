import { commandsByName } from "./commands/index";
import type { CommandContext } from "./commands/types";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hexToBytes(
  hex: string,
  byteLength: number,
): Uint8Array<ArrayBuffer> | null {
  if (
    hex.length !== byteLength * 2 ||
    !/^[0-9a-f]+$/i.test(hex)
  ) {
    return null;
  }

  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  for (let i = 0; i < byteLength; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifyDiscordRequest(
  request: Request,
  body: string,
  publicKeyHex: string,
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) {
    return false;
  }

  const publicKey = hexToBytes(publicKeyHex, 32);
  const signatureBytes = hexToBytes(signature, 64);
  if (!publicKey || !signatureBytes) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signatureBytes,
    new TextEncoder().encode(timestamp + body),
  );
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function interactionResponse(content: string): Response {
  return jsonResponse({
    type: 4,
    data: {
      content,
      allowed_mentions: { parse: [] },
    },
  });
}

function getUsername(interaction: JsonRecord): string {
  const member = interaction.member;
  const memberUser = isRecord(member) ? member.user : undefined;
  const user = isRecord(memberUser)
    ? memberUser
    : isRecord(interaction.user)
      ? interaction.user
      : undefined;

  if (typeof user?.global_name === "string" && user.global_name.length > 0) {
    return user.global_name;
  }
  if (typeof user?.username === "string" && user.username.length > 0) {
    return user.username;
  }
  return "there";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET") {
      return jsonResponse({ status: "ok", service: "discord-bot" });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    }

    const body = await request.text();
    if (!env.DISCORD_PUBLIC_KEY) {
      console.error("DISCORD_PUBLIC_KEY is not configured.");
      return jsonResponse({ error: "Bot is not configured." }, 500);
    }

    if (!(await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY))) {
      return jsonResponse({ error: "Invalid request signature." }, 401);
    }

    let interaction: unknown;
    try {
      interaction = JSON.parse(body);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid JSON body." }, 400);
      }
      throw error;
    }
    if (!isRecord(interaction)) {
      return jsonResponse({ error: "Invalid interaction payload." }, 400);
    }

    if (interaction.type === 1) {
      return jsonResponse({ type: 1 });
    }

    if (interaction.type !== 2) {
      return jsonResponse({ error: "Unsupported interaction type." }, 400);
    }

    const data = interaction.data;
    if (!isRecord(data) || typeof data.name !== "string") {
      return jsonResponse({ error: "Invalid application command." }, 400);
    }

    const command = commandsByName.get(data.name);
    if (!command) {
      return interactionResponse(`Unknown command: ${data.name}`);
    }
    const context: CommandContext = {
      interaction,
      username: getUsername(interaction),
    };
    return interactionResponse(command.execute(context));
  },
};
