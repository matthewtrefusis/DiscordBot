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

async function runCommand(
  name,
  options = [],
  envOverrides = {},
  executionContext,
) {
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      guild_id: "guild-id",
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
    { DISCORD_PUBLIC_KEY: publicKeyHex, ...envOverrides },
    executionContext,
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function runAutocomplete(name, options, envOverrides = {}) {
  const response = await worker.fetch(
    signedRequest({
      type: 4,
      guild_id: "guild-id",
      data: { name, options },
    }),
    { DISCORD_PUBLIC_KEY: publicKeyHex, ...envOverrides },
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
  assert.match(help.data.content, /`\/timeout user minutes \[reason\]`/);
  assert.match(help.data.content, /`\/purge count \[reason\]`/);

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

test("shows server details and the approximate member count", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({
      id: "123456789012345678",
      name: "Example server",
      owner_id: "234567890123456789",
      approximate_member_count: 42,
      approximate_presence_count: 12,
      premium_tier: 2,
    });
  };

  try {
    const env = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "test-bot-token",
    };
    const serverInfo = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: "123456789012345678",
        data: { name: "serverinfo" },
      }),
      env,
    );
    const memberCount = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: "123456789012345678",
        data: { name: "membercount" },
      }),
      env,
    );

    const serverInfoPayload = await serverInfo.json();
    assert.match(serverInfoPayload.data.content, /Example server/);
    assert.match(serverInfoPayload.data.content, /~42/);
    assert.match((await memberCount.json()).data.content, /approximately \*\*42\*\*/);
    assert.equal(requests.length, 2);
    assert.match(requests[0], /with_counts=true/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shows feedback configuration only to server managers", async () => {
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      guild_id: "guild-id",
      data: { name: "feedback-config" },
      member: { permissions: "32" },
    }),
    {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      FEEDBACK_CONFIG: {
        get: async () => JSON.stringify({
          channelId: "987654321098765432",
          categories: ["Bug", "Suggestion"],
        }),
        put: async () => {},
      },
    },
  );
  const payload = await response.json();

  assert.equal(payload.data.flags, 64);
  assert.match(payload.data.content, /<#987654321098765432>/);
  assert.match(payload.data.content, /Bug, Suggestion/);
});

test("does not reveal feedback configuration to other members", async () => {
  let settingsRead = false;
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      guild_id: "guild-id",
      data: { name: "feedback-config" },
      member: { permissions: "0" },
    }),
    {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      FEEDBACK_CONFIG: {
        get: async () => {
          settingsRead = true;
          return null;
        },
        put: async () => {},
      },
    },
  );
  const payload = await response.json();

  assert.equal(payload.data.flags, 64);
  assert.match(payload.data.content, /Manage Server/);
  assert.equal(settingsRead, false);
});

test("lets a server manager configure the feedback destination and categories", async () => {
  const savedSettings = new Map();
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      guild_id: "guild-id",
      data: {
        name: "setup-feedback",
        options: [
          { name: "channel", value: "987654321098765432" },
          { name: "categories", value: "Bug, Suggestion, Other" },
        ],
        resolved: {
          channels: {
            "987654321098765432": {
              type: 0,
              guild_id: "guild-id",
            },
          },
        },
      },
      member: { permissions: "32" },
    }),
    {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      FEEDBACK_CONFIG: {
        get: async (key) => savedSettings.get(key) ?? null,
        put: async (key, value) => savedSettings.set(key, value),
      },
    },
  );
  const payload = await response.json();

  assert.equal(payload.type, 4);
  assert.equal(payload.data.flags, 64);
  assert.equal(
    savedSettings.get("feedback-settings:guild-id"),
    JSON.stringify({
      channelId: "987654321098765432",
      categories: ["Bug", "Suggestion", "Other"],
    }),
  );
});

test("rejects feedback setup by members without Manage Server", async () => {
  let stored = false;
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      guild_id: "guild-id",
      data: {
        name: "setup-feedback",
        options: [
          { name: "channel", value: "987654321098765432" },
          { name: "categories", value: "Bug, Suggestion, Other" },
        ],
        resolved: {
          channels: {
            "987654321098765432": { type: 0, guild_id: "guild-id" },
          },
        },
      },
      member: { permissions: "0" },
    }),
    {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      FEEDBACK_CONFIG: {
        get: async () => null,
        put: async () => {
          stored = true;
        },
      },
    },
  );
  const payload = await response.json();

  assert.equal(payload.data.flags, 64);
  assert.match(payload.data.content, /Manage Server/);
  assert.equal(stored, false);
});

test("provides configured feedback categories through Discord autocomplete", async () => {
  const response = await runAutocomplete(
    "feedback",
    [{ name: "category", value: "bug", focused: true }],
    {
      FEEDBACK_CONFIG: {
        get: async (key) => {
          assert.equal(key, "feedback-settings:guild-id");
          return JSON.stringify({
            channelId: "987654321098765432",
            categories: ["Bug report", "Suggestion", "Other"],
          });
        },
        put: async () => {},
      },
    },
  );

  assert.deepEqual(response, {
    type: 8,
    data: { choices: [{ name: "Bug report", value: "Bug report" }] },
  });
});

test("rejects feedback with a category that is not configured", async () => {
  const response = await runCommand(
    "feedback",
    [
      { name: "category", value: "Other" },
      { name: "message", value: "A useful note" },
    ],
    {
      DISCORD_BOT_TOKEN: "test-bot-token",
      FEEDBACK_CONFIG: {
        get: async () => JSON.stringify({
          channelId: "987654321098765432",
          categories: ["Bug", "Suggestion"],
        }),
        put: async () => {},
      },
    },
  );

  assert.equal(response.data.flags, 64);
  assert.match(response.data.content, /category is no longer available/);
});

test("delivers feedback without including the submitter's identity", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const backgroundTasks = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: 200 });
  };

  try {
    const response = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: "guild-id",
        application_id: "application-id",
        token: "interaction-token",
        data: {
          name: "feedback",
          options: [
            { name: "category", value: "Suggestion" },
            {
              name: "message",
              value: "Please improve the welcome channel @everyone",
            },
          ],
        },
        member: {
          user: {
            id: "123456789012345678",
            username: "test-user",
            global_name: "Test User",
          },
        },
      }),
      {
        DISCORD_PUBLIC_KEY: publicKeyHex,
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: {
          get: async (key) => {
            assert.equal(key, "feedback-settings:guild-id");
            return JSON.stringify({
              channelId: "987654321098765432",
              categories: ["Bug", "Suggestion", "Other"],
            });
          },
          put: async () => {},
        },
      },
      { waitUntil: (task) => backgroundTasks.push(task) },
    );

    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await Promise.all(backgroundTasks);
    assert.equal(requests.length, 2);

    const postedMessage = JSON.parse(requests[0].options.body);
    assert.match(postedMessage.content, /Anonymous feedback · Suggestion/);
    assert.match(postedMessage.content, /Please improve the welcome channel/);
    assert.doesNotMatch(postedMessage.content, /Test User|test-user|123456789012345678/);
    assert.deepEqual(postedMessage.allowed_mentions, { parse: [] });

    const followup = JSON.parse(requests[1].options.body);
    assert.match(followup.content, /submitted anonymously/);
    assert.equal(followup.flags, 64);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates polls and lets a voter change their choice", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const backgroundTasks = [];
  const values = new Map();
  const store = {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
    list: async () => ({
      keys: [...values.keys()].map((name) => ({ name })),
      list_complete: true,
    }),
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/channels/")) {
      return Response.json({ id: "345678901234567890" });
    }
    return new Response(null, { status: 204 });
  };

  try {
    const response = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: "123456789012345678",
        channel_id: "234567890123456789",
        application_id: "application-id",
        token: "interaction-token",
        data: {
          name: "poll",
          options: [
            { name: "question", value: "Which color?" },
            { name: "options", value: "Red, Blue" },
          ],
        },
        member: { user: { id: "456789012345678901" } },
      }),
      {
        DISCORD_PUBLIC_KEY: publicKeyHex,
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: store,
      },
      { waitUntil: (task) => backgroundTasks.push(task) },
    );
    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await Promise.all(backgroundTasks);

    const pollMessage = JSON.parse(requests[0].options.body);
    assert.match(pollMessage.content, /Which color/);
    const customIds = pollMessage.components[0].components.map(
      (button) => button.custom_id,
    );
    const vote = async (customId) => {
      const result = await worker.fetch(
        signedRequest({
          type: 3,
          guild_id: "123456789012345678",
          channel_id: "234567890123456789",
          member: { user: { id: "456789012345678901" } },
          data: { custom_id: customId },
        }),
        {
          DISCORD_PUBLIC_KEY: publicKeyHex,
          DISCORD_BOT_TOKEN: "test-bot-token",
          FEEDBACK_CONFIG: store,
        },
      );
      return result.json();
    };

    const firstVote = await vote(customIds[0]);
    assert.equal(firstVote.type, 7);
    assert.match(firstVote.data.content, /1\. Red — 1 vote/);
    const changedVote = await vote(customIds[1]);
    assert.match(changedVote.data.content, /1\. Red — 0 vote/);
    assert.match(changedVote.data.content, /2\. Blue — 1 vote/);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stores reminders and delivers due reminders by DM", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const values = new Map();
  const store = {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
    list: async ({ prefix }) => ({
      keys: [...values.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    }),
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/users/@me/channels")) {
      return Response.json({ id: "567890123456789012" });
    }
    return new Response(null, { status: 204 });
  };

  try {
    const response = await runCommand(
      "remind",
      [
        { name: "minutes", value: 5 },
        { name: "message", value: "Check the oven" },
      ],
      { FEEDBACK_CONFIG: store },
    );
    assert.equal(response.data.flags, 64);
    assert.match(response.data.content, /I'll DM you/);
    const reminderKey = [...values.keys()].find((key) => key.startsWith("reminder:"));
    assert.ok(reminderKey);

    const savedReminder = JSON.parse(values.get(reminderKey));
    savedReminder.dueAt = 0;
    values.set(reminderKey, JSON.stringify(savedReminder));
    values.set(
      "reminder:future",
      JSON.stringify({
        userId: "123456789012345678",
        message: "Later",
        dueAt: Date.now() + 60_000,
        attempts: 0,
      }),
    );

    let scheduledTask;
    await worker.scheduled(
      { scheduledTime: Date.now() },
      {
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: store,
      },
      { waitUntil: (task) => { scheduledTask = task; } },
    );
    await scheduledTask;

    assert.equal(values.has(reminderKey), false);
    assert.equal(values.has("reminder:future"), true);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      JSON.parse(requests[0].options.body),
      { recipient_id: "123456789012345678" },
    );
    assert.match(JSON.parse(requests[1].options.body).content, /Check the oven/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("moderation commands reject members without the required permission", async () => {
  const originalFetch = globalThis.fetch;
  let calledDiscord = false;
  globalThis.fetch = async () => {
    calledDiscord = true;
    throw new Error("Discord should not be called for unauthorized members.");
  };

  try {
    const response = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: "123456789012345678",
        data: {
          name: "kick",
          options: [{ name: "user", value: "234567890123456789" }],
        },
        member: { permissions: "0" },
      }),
      {
        DISCORD_PUBLIC_KEY: publicKeyHex,
        DISCORD_BOT_TOKEN: "test-bot-token",
      },
    );
    const payload = await response.json();

    assert.equal(payload.data.flags, 64);
    assert.match(payload.data.content, /Kick Members permission/);
    assert.equal(calledDiscord, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("timeouts members and records the reason in Discord's audit log", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const backgroundTasks = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };

  try {
    const response = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: "123456789012345678",
        application_id: "application-id",
        token: "interaction-token",
        data: {
          name: "timeout",
          options: [
            { name: "user", value: "234567890123456789" },
            { name: "minutes", value: 15 },
            { name: "reason", value: "Repeated spam" },
          ],
        },
        member: { permissions: "1099511627776" },
      }),
      {
        DISCORD_PUBLIC_KEY: publicKeyHex,
        DISCORD_BOT_TOKEN: "test-bot-token",
      },
      { waitUntil: (task) => backgroundTasks.push(task) },
    );

    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await Promise.all(backgroundTasks);
    assert.equal(requests.length, 2);
    assert.match(
      requests[0].url,
      /\/guilds\/123456789012345678\/members\/234567890123456789$/,
    );
    assert.equal(requests[0].options.method, "PATCH");
    assert.equal(
      requests[0].options.headers["X-Audit-Log-Reason"],
      "Repeated%20spam",
    );
    const update = JSON.parse(requests[0].options.body);
    assert.ok(
      Math.abs(Date.parse(update.communication_disabled_until) - Date.now() - 15 * 60_000) <
        10_000,
    );
    assert.match(JSON.parse(requests[1].options.body).content, /Timed out/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("purge skips messages older than 14 days", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const backgroundTasks = [];
  const recentMessageId = "345678901234567890";
  const oldMessageId = "456789012345678901";
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === "GET") {
      return Response.json([
        {
          id: oldMessageId,
          timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { id: recentMessageId, timestamp: new Date().toISOString() },
      ]);
    }
    return new Response(null, { status: 204 });
  };

  try {
    const response = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: "123456789012345678",
        channel_id: "234567890123456789",
        application_id: "application-id",
        token: "interaction-token",
        data: {
          name: "purge",
          options: [
            { name: "count", value: 2 },
            { name: "reason", value: "Clean up spam" },
          ],
        },
        member: { permissions: "8192" },
      }),
      {
        DISCORD_PUBLIC_KEY: publicKeyHex,
        DISCORD_BOT_TOKEN: "test-bot-token",
      },
      { waitUntil: (task) => backgroundTasks.push(task) },
    );

    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await Promise.all(backgroundTasks);
    assert.equal(requests.length, 3);
    assert.match(requests[0].url, /\/channels\/234567890123456789\/messages\?limit=2$/);
    assert.equal(
      requests[1].url,
      `https://discord.com/api/v10/channels/234567890123456789/messages/${recentMessageId}`,
    );
    assert.equal(requests[1].options.method, "DELETE");
    assert.match(
      JSON.parse(requests[2].options.body).content,
      /Deleted 1 message/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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
