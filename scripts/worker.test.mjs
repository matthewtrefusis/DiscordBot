import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import worker from "../src/index.ts";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

function signedRequest(interaction) {
  const body = JSON.stringify(interaction);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(
    null,
    Buffer.from(timestamp + body),
    privateKey,
  ).toString("hex");

  return new Request("https://bot.example/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    body,
  });
}

async function runCommand(name, options = []) {
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      data: { name, options },
      member: {
        user: {
          id: "123456789012345678",
          username: "tester",
          global_name: "Test User",
          avatar: "avatar-hash",
        },
      },
    }),
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("acknowledges a correctly signed Discord PING", async () => {
  const response = await worker.fetch(signedRequest({ type: 1 }), {
    DISCORD_PUBLIC_KEY: publicKeyHex,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});

test("handles a signed hello command and disables mentions", async () => {
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      data: { name: "hello" },
      member: { user: { global_name: "Test User" } },
    }),
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    type: 4,
    data: {
      content: "👋 Hello Test User",
      allowed_mentions: { parse: [] },
    },
  });
});

test("runs the ping and info slash commands", async () => {
  const ping = await worker.fetch(
    signedRequest({ type: 2, data: { name: "ping" } }),
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );
  const info = await worker.fetch(
    signedRequest({ type: 2, data: { name: "info" } }),
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );

  assert.equal((await ping.json()).data.content, "🏓 Pong!");
  assert.match((await info.json()).data.content, /TypeScript on Cloudflare Workers/);
});

test("runs the help, profile, timestamp, and fun commands", async () => {
  const help = await runCommand("help");
  assert.match(help.data.content, /`\/8ball question`/);

  const userinfo = await runCommand("userinfo");
  assert.match(userinfo.data.content, /Test User/);
  assert.match(userinfo.data.content, /123456789012345678/);

  const avatar = await runCommand("avatar");
  assert.match(avatar.data.content, /cdn\.discordapp\.com\/avatars\/123456789012345678\/avatar-hash/);

  const timestamp = await runCommand("timestamp", [
    { name: "seconds", value: 1_900_000_000 },
  ]);
  assert.equal(
    timestamp.data.content,
    "**Local time:** <t:1900000000:F>\n**Relative:** <t:1900000000:R>",
  );

  const roll = await runCommand("roll", [
    { name: "min", value: -5 },
    { name: "max", value: -1 },
  ]);
  assert.match(roll.data.content, /\*\*-?[1-5]\*\*/);

  const coinflip = await runCommand("coinflip");
  assert.match(coinflip.data.content, /Heads|Tails/);

  const choose = await runCommand("choose", [
    { name: "choices", value: "red, green" },
  ]);
  assert.match(choose.data.content, /I choose: \*\*(red|green)\*\*/);

  const eightball = await runCommand("8ball", [
    { name: "question", value: "Will the tests pass?" },
  ]);
  assert.match(eightball.data.content, /^🎱 /);
});

test("rejects a request whose body was changed after signing", async () => {
  const original = signedRequest({ type: 1 });
  const forged = new Request(original.url, {
    method: "POST",
    headers: original.headers,
    body: JSON.stringify({ type: 2, data: { name: "info" } }),
  });
  const response = await worker.fetch(forged, {
    DISCORD_PUBLIC_KEY: publicKeyHex,
  });

  assert.equal(response.status, 401);
});
