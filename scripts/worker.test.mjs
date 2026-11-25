import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import worker from "../src/index.ts";
import { eventDueKey } from "../src/events.ts";
import { parseLocalDateTime } from "../src/time-utils.ts";

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

function createMemoryStore(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    values,
    store: {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
      list: async ({ prefix }) => ({
        keys: [...values.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
      }),
    },
  };
}

async function runServerManagerCommand(
  name,
  options,
  envOverrides,
  executionContext,
  additionalData = {},
  guildId = "guild-id",
  channelId = "234567890123456789",
) {
  const response = await worker.fetch(
    signedRequest({
      type: 2,
      guild_id: guildId,
      channel_id: channelId,
      application_id: "345678901234567890",
      token: "test-interaction-token",
      data: { name, options, ...additionalData },
      member: {
        permissions: "32",
        user: { id: "123456789012345678", username: "tester" },
      },
    }),
    { DISCORD_PUBLIC_KEY: publicKeyHex, ...envOverrides },
    executionContext,
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
  const savedValues = new Map();
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
            if (key === "feedback-settings:guild-id") {
              return JSON.stringify({
                channelId: "987654321098765432",
                categories: ["Bug", "Suggestion", "Other"],
              });
            }
            return savedValues.get(key) ?? null;
          },
          put: async (key, value) => savedValues.set(key, value),
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
    assert.deepEqual(
      JSON.parse(savedValues.get("feedback-stats:guild-id")),
      { Suggestion: 1 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shows feedback category totals only to server managers", async () => {
  const { store } = createMemoryStore([
    ["feedback-settings:guild-id", JSON.stringify({
      channelId: "987654321098765432",
      categories: ["Bug", "Suggestion"],
    })],
    ["feedback-stats:guild-id", JSON.stringify({ Bug: 3, Suggestion: 8 })],
  ]);
  const response = await runServerManagerCommand(
    "feedback-stats",
    [],
    { FEEDBACK_CONFIG: store },
  );
  assert.equal(response.data.flags, 64);
  assert.match(response.data.content, /Bug: \*\*3\*\*/);
  assert.match(response.data.content, /Suggestion: \*\*8\*\*/);
});

test("configures a private report channel and sends identified reports to it", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const backgroundTasks = [];
  const guildId = "123456789012345678";
  const { values, store } = createMemoryStore();
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };

  try {
    const setup = await runServerManagerCommand(
      "setup-reports",
      [{ name: "channel", value: "987654321098765432" }],
      { FEEDBACK_CONFIG: store },
      undefined,
      {
        resolved: {
          channels: {
            "987654321098765432": { type: 0, guild_id: guildId },
          },
        },
      },
      guildId,
    );
    assert.match(setup.data.content, /private to moderators/);
    assert.equal(
      values.get(`report-settings:${guildId}`),
      "987654321098765432",
    );

    const response = await worker.fetch(
      signedRequest({
        type: 2,
        guild_id: guildId,
        application_id: "application-id",
        token: "interaction-token",
        data: {
          name: "report",
          options: [
            { name: "message", value: "A user is spamming." },
            {
              name: "message_link",
              value: `https://discord.com/channels/${guildId}/123456789012345678/234567890123456789`,
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
        FEEDBACK_CONFIG: store,
      },
      { waitUntil: (task) => backgroundTasks.push(task) },
    );
    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await Promise.all(backgroundTasks);
    const posted = JSON.parse(requests[0].options.body);
    assert.match(posted.content, /Report from Test User/);
    assert.match(posted.content, /123456789012345678/);
    assert.match(posted.content, /A user is spamming/);
    assert.ok(
      posted.content.includes(`https://discord.com/channels/${guildId}/`),
    );
    assert.deepEqual(posted.allowed_mentions, { parse: [] });
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

    const pollId = customIds[0].split(":")[1];
    const results = await runServerManagerCommand(
      "poll-results",
      [{ name: "poll", value: pollId }],
      { FEEDBACK_CONFIG: store },
      undefined,
      {},
      "123456789012345678",
    );
    assert.match(results.data.content, /Current results/);
    assert.match(results.data.content, /Total votes: \*\*1\*\*/);

    const closed = await runServerManagerCommand(
      "poll-close",
      [{ name: "poll", value: pollId }],
      {
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: store,
      },
      undefined,
      {},
      "123456789012345678",
    );
    assert.match(closed.data.content, /Closed/);
    const pollState = JSON.parse(values.get(`poll:${pollId}`));
    assert.equal(pollState.closed, true);
    const edit = requests.find((request) => request.options.method === "PATCH");
    assert.ok(edit);
    assert.equal(
      JSON.parse(edit.options.body).components[0].components[0].disabled,
      true,
    );
    const closedVote = await vote(customIds[0]);
    assert.equal(closedVote.type, 4);
    assert.match(closedVote.data.content, /poll is closed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sets a timezone and schedules reminders at local times", async () => {
  const { values, store } = createMemoryStore();
  const timezone = await runCommand(
    "timezone",
    [{ name: "timezone", value: "Etc/UTC" }],
    { FEEDBACK_CONFIG: store },
  );
  assert.match(timezone.data.content, /Etc\/UTC/);

  const localTime = new Date(Date.now() + 20 * 60_000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const response = await runCommand(
    "remind-at",
    [
      { name: "local_time", value: localTime },
      { name: "message", value: "Join the call" },
    ],
    { FEEDBACK_CONFIG: store },
  );
  assert.match(response.data.content, /I'll DM you/);
  const reminder = JSON.parse(
    values.get([...values.keys()].find((key) => key.startsWith("reminder:"))),
  );
  assert.equal(reminder.message, "Join the call");
  assert.equal(reminder.userId, "123456789012345678");
  assert.equal(
    Math.floor(reminder.dueAt / 60_000),
    Math.floor(new Date(`${localTime}:00Z`).getTime() / 60_000),
  );
});

test("rejects daylight-saving gaps and ambiguous local reminder times", () => {
  assert.equal(
    parseLocalDateTime("2026-03-08 02:30", "America/New_York").status,
    "invalid",
  );
  assert.equal(
    parseLocalDateTime("2026-11-01 01:30", "America/New_York").status,
    "ambiguous",
  );
});

test("schedules and delivers events and lists or cancels upcoming ones", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const guildId = "123456789012345678";
  const userId = "123456789012345678";
  const { values, store } = createMemoryStore([
    [`timezone:${userId}`, "Etc/UTC"],
  ]);
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };

  try {
    const localTime = new Date(Date.now() + 30 * 60_000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    const scheduled = await runServerManagerCommand(
      "event",
      [
        { name: "title", value: "Community meetup" },
        { name: "local_time", value: localTime },
      ],
      { FEEDBACK_CONFIG: store },
      undefined,
      {},
      guildId,
    );
    assert.match(scheduled.data.content, /Community meetup/);
    const eventKey = [...values.keys()].find((key) =>
      key.startsWith(`event:${guildId}:`)
    );
    assert.ok(eventKey);

    const listed = await runServerManagerCommand(
      "events",
      [],
      { FEEDBACK_CONFIG: store },
      undefined,
      {},
      guildId,
    );
    assert.match(listed.data.content, /Community meetup/);

    const cancelId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const cancelStartsAt = Date.now() + 60 * 60_000;
    values.set(`event:${guildId}:${cancelId}`, JSON.stringify({
      guildId,
      channelId: "234567890123456789",
      title: "Cancel this meetup",
      startsAt: cancelStartsAt,
      createdBy: userId,
      attempts: 0,
    }));
    values.set(eventDueKey(cancelStartsAt, guildId, cancelId), "1");
    const cancelled = await runServerManagerCommand(
      "event-cancel",
      [{ name: "event", value: cancelId }],
      { FEEDBACK_CONFIG: store },
      undefined,
      {},
      guildId,
    );
    assert.match(cancelled.data.content, /Cancelled/);
    assert.equal(values.has(`event:${guildId}:${cancelId}`), false);
    assert.equal(
      values.has(eventDueKey(cancelStartsAt, guildId, cancelId)),
      false,
    );

    const event = JSON.parse(values.get(eventKey));
    const eventId = eventKey.slice(eventKey.lastIndexOf(":") + 1);
    values.delete(eventDueKey(event.startsAt, guildId, eventId));
    values.set(eventKey, JSON.stringify({ ...event, startsAt: 0 }));
    const dueEventIndex = eventDueKey(0, guildId, eventId);
    values.set(dueEventIndex, "1");
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
    assert.equal(values.has(eventKey), false);
    assert.equal(values.has(dueEventIndex), false);
    assert.match(JSON.parse(requests[0].options.body).content, /Community meetup/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pauses and resumes stream sources and can send a test alert", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const guildId = "123456789012345678";
  const source = {
    platform: "twitch",
    url: "https://www.twitch.tv/samplechannel",
    channelId: "987654321",
    displayName: "SampleChannel",
    channelLogin: "samplechannel",
  };
  const { values, store } = createMemoryStore([
    [
      `stream-settings:${guildId}`,
      JSON.stringify({
        channelId: "234567890123456789",
        sources: [source],
      }),
    ],
  ]);
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };

  try {
    const paused = await runServerManagerCommand(
      "stream-pause",
      [{ name: "channel_url", value: source.url }],
      { FEEDBACK_CONFIG: store },
      undefined,
      {},
      guildId,
    );
    assert.match(paused.data.content, /Paused/);
    assert.equal(
      JSON.parse(values.get(`stream-settings:${guildId}`)).sources[0].paused,
      true,
    );

    const resumed = await runServerManagerCommand(
      "stream-resume",
      [{ name: "channel_url", value: source.url }],
      { FEEDBACK_CONFIG: store },
      undefined,
      {},
      guildId,
    );
    assert.match(resumed.data.content, /Resumed/);
    const resumedSource = JSON.parse(
      values.get(`stream-settings:${guildId}`),
    ).sources[0];
    assert.equal(resumedSource.paused, false);
    assert.equal(resumedSource.resumePending, true);

    const backgroundTasks = [];
    const tested = await runServerManagerCommand(
      "stream-test",
      [],
      {
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: store,
      },
      { waitUntil: (task) => backgroundTasks.push(task) },
      {},
      guildId,
    );
    assert.deepEqual(tested, { type: 5, data: { flags: 64 } });
    await Promise.all(backgroundTasks);
    assert.match(JSON.parse(requests[0].options.body).content, /Stream alert test/);
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

test("adds a Twitch channel from its URL through Discord", async () => {
  const originalFetch = globalThis.fetch;
  const { values, store } = createMemoryStore([
    [
      "stream-settings:guild-id",
      JSON.stringify({
        channelId: "234567890123456789",
        sources: [],
      }),
    ],
  ]);
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url === "https://id.twitch.tv/oauth2/token") {
      return Response.json({
        access_token: "test-twitch-token",
        expires_in: 3600,
      });
    }
    if (url === "https://api.twitch.tv/helix/users?login=samplechannel") {
      return Response.json({
        data: [{
          id: "123456789",
          display_name: "SampleChannel",
          login: "samplechannel",
        }],
      });
    }
    if (url.startsWith("https://discord.com/api/v10/webhooks/")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    let backgroundTask;
    const response = await runServerManagerCommand(
      "stream-add",
      [{
        name: "channel_url",
        value: "https://www.twitch.tv/SampleChannel",
      }],
      {
        FEEDBACK_CONFIG: store,
        TWITCH_CLIENT_ID: "test-client-id",
        TWITCH_CLIENT_SECRET: "test-client-secret",
      },
      { waitUntil: (task) => { backgroundTask = task; } },
    );

    assert.deepEqual(response, {
      type: 5,
      data: { flags: 64 },
    });
    await backgroundTask;

    const settings = JSON.parse(values.get("stream-settings:guild-id"));
    assert.equal(settings.sources.length, 1);
    assert.equal(settings.sources[0].platform, "twitch");
    assert.equal(settings.sources[0].url, "https://www.twitch.tv/samplechannel");
    assert.equal(settings.sources[0].channelId, "123456789");
    assert.equal(requests.length, 3);
    assert.equal(
      requests[1].options.headers.Authorization,
      "Bearer test-twitch-token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adds a YouTube channel from its URL through Discord", async () => {
  const originalFetch = globalThis.fetch;
  const { values, store } = createMemoryStore([
    [
      "stream-settings:guild-id",
      JSON.stringify({
        channelId: "234567890123456789",
        sources: [],
      }),
    ],
  ]);
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels?")) {
      return Response.json({
        items: [{
          id: "UCabcdefghijklmnopqrstuv",
          snippet: { title: "Example YouTube Channel" },
          contentDetails: {
            relatedPlaylists: { uploads: "UUabcdefghijklmnopqrstuv" },
          },
        }],
      });
    }
    if (url.startsWith("https://discord.com/api/v10/webhooks/")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    let backgroundTask;
    const response = await runServerManagerCommand(
      "stream-add",
      [{
        name: "channel_url",
        value: "https://www.youtube.com/@ExampleHandle/streams?sub_confirmation=1",
      }],
      {
        FEEDBACK_CONFIG: store,
        YOUTUBE_API_KEY: "test-youtube-key",
      },
      { waitUntil: (task) => { backgroundTask = task; } },
    );

    assert.deepEqual(response, {
      type: 5,
      data: { flags: 64 },
    });
    await backgroundTask;

    const settings = JSON.parse(values.get("stream-settings:guild-id"));
    assert.equal(settings.sources.length, 1);
    assert.equal(settings.sources[0].platform, "youtube");
    assert.equal(settings.sources[0].url, "https://www.youtube.com/@examplehandle");
    assert.equal(settings.sources[0].channelId, "UCabcdefghijklmnopqrstuv");
    assert.equal(
      settings.sources[0].uploadsPlaylistId,
      "UUabcdefghijklmnopqrstuv",
    );
    assert.match(requests[0].url, /forHandle=ExampleHandle/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("changes the livestream announcement channel without dropping sources", async () => {
  const { values, store } = createMemoryStore([
    [
      "stream-settings:guild-id",
      JSON.stringify({
        channelId: "234567890123456789",
        sources: [{
          platform: "twitch",
          url: "https://www.twitch.tv/samplechannel",
          channelId: "123456789",
          channelLogin: "samplechannel",
          displayName: "SampleChannel",
        }],
      }),
    ],
  ]);
  const response = await runServerManagerCommand(
    "setup-stream-alerts",
    [{ name: "channel", value: "987654321098765432" }],
    { FEEDBACK_CONFIG: store },
    undefined,
    {
      resolved: {
        channels: {
          "987654321098765432": {
            type: 0,
            guild_id: "guild-id",
          },
        },
      },
    },
  );

  assert.match(response.data.content, /<#987654321098765432>/);
  const settings = JSON.parse(values.get("stream-settings:guild-id"));
  assert.equal(settings.channelId, "987654321098765432");
  assert.equal(settings.sources.length, 1);
  assert.equal(settings.sources[0].channelId, "123456789");
});

test("announces a new YouTube livestream and respects the polling interval", async () => {
  const originalFetch = globalThis.fetch;
  const streamSettingsKey = "stream-settings:123456789012345678";
  const { values, store } = createMemoryStore([
    [
      streamSettingsKey,
      JSON.stringify({
        channelId: "234567890123456789",
        sources: [{
          platform: "youtube",
          url: "https://www.youtube.com/@example",
          channelId: "UCabcdefghijklmnopqrstuv",
          displayName: "Example Channel",
          uploadsPlaylistId: "UUabcdefghijklmnopqrstuv",
        }],
      }),
    ],
  ]);
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url.startsWith("https://www.googleapis.com/youtube/v3/playlistItems?")) {
      return Response.json({
        items: [{ contentDetails: { videoId: "live-video-id" } }],
      });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?")) {
      return Response.json({
        items: [{
          id: "live-video-id",
          snippet: {
            title: "We are live",
            liveBroadcastContent: "live",
          },
        }],
      });
    }
    if (url === "https://discord.com/api/v10/channels/234567890123456789/messages") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const runScheduled = async (scheduledTime) => {
    let scheduledTask;
    await worker.scheduled(
      { scheduledTime },
      {
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: store,
        YOUTUBE_API_KEY: "test-youtube-key",
      },
      { waitUntil: (task) => { scheduledTask = task; } },
    );
    await scheduledTask;
  };

  try {
    const now = Date.now();
    await runScheduled(now);

    assert.equal(requests.length, 3);
    const announcement = JSON.parse(requests[2].options.body);
    assert.match(announcement.content, /Example Channel is live: We are live/);
    assert.match(announcement.content, /youtube\.com\/watch\?v=live-video-id/);
    assert.deepEqual(announcement.allowed_mentions, { parse: [] });

    const savedSettings = JSON.parse(values.get(streamSettingsKey));
    assert.equal(savedSettings.sources[0].activeStreamId, "live-video-id");
    assert.equal(savedSettings.sources[0].lastCheckedAt, now);

    await runScheduled(now + 60_000);
    assert.equal(requests.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("announces new YouTube uploads but skips livestream recordings", async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  const streamSettingsKey = "stream-settings:123456789012345678";
  const { values, store } = createMemoryStore([
    [
      streamSettingsKey,
      JSON.stringify({
        channelId: "234567890123456789",
        sources: [{
          platform: "youtube",
          url: "https://www.youtube.com/@example",
          channelId: "UCabcdefghijklmnopqrstuv",
          displayName: "Example Channel",
          uploadsPlaylistId: "UUabcdefghijklmnopqrstuv",
          addedAt: now - 60_000,
        }],
      }),
    ],
  ]);
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url.startsWith("https://www.googleapis.com/youtube/v3/playlistItems?")) {
      return Response.json({
        items: [
          {
            contentDetails: {
              videoId: "new-upload",
              videoPublishedAt: new Date(now - 5_000).toISOString(),
            },
          },
          {
            contentDetails: {
              videoId: "stream-recording",
              videoPublishedAt: new Date(now - 10_000).toISOString(),
            },
          },
          {
            contentDetails: {
              videoId: "old-upload",
              videoPublishedAt: new Date(now - 120_000).toISOString(),
            },
          },
        ],
      });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?")) {
      return Response.json({
        items: [
          {
            id: "new-upload",
            snippet: { title: "New public video", liveBroadcastContent: "none" },
          },
          {
            id: "stream-recording",
            snippet: { title: "Finished stream", liveBroadcastContent: "none" },
            liveStreamingDetails: {
              actualStartTime: new Date(now - 60_000).toISOString(),
            },
          },
          {
            id: "old-upload",
            snippet: { title: "Old video", liveBroadcastContent: "none" },
          },
        ],
      });
    }
    if (url === "https://discord.com/api/v10/channels/234567890123456789/messages") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    let scheduledTask;
    await worker.scheduled(
      { scheduledTime: now },
      {
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: store,
        YOUTUBE_API_KEY: "test-youtube-key",
      },
      { waitUntil: (task) => { scheduledTask = task; } },
    );
    await scheduledTask;

    const announcements = requests.filter((request) =>
      request.url === "https://discord.com/api/v10/channels/234567890123456789/messages"
    );
    assert.equal(announcements.length, 1);
    const announcement = JSON.parse(announcements[0].options.body);
    assert.match(announcement.content, /New public video/);
    assert.match(announcement.content, /watch\?v=new-upload/);
    assert.doesNotMatch(announcement.content, /Finished stream/);

    const settings = JSON.parse(values.get(streamSettingsKey));
    assert.equal(settings.sources[0].lastObservedVideoId, "new-upload");
    assert.equal(settings.sources[0].lastCheckedAt, now);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("announces Twitch VODs unless their live stream was already announced", async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  const streamSettingsKey = "stream-settings:123456789012345678";
  const { values, store } = createMemoryStore([
    [
      streamSettingsKey,
      JSON.stringify({
        channelId: "234567890123456789",
        sources: [{
          platform: "twitch",
          url: "https://www.twitch.tv/samplechannel",
          channelId: "123456789",
          channelLogin: "samplechannel",
          displayName: "SampleChannel",
          activeStreamId: "already-alerted-stream",
          lastObservedVideoId: "older-vod",
        }],
      }),
    ],
  ]);
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url === "https://id.twitch.tv/oauth2/token") {
      return Response.json({
        access_token: "test-twitch-token",
        expires_in: 3600,
      });
    }
    if (url.startsWith("https://api.twitch.tv/helix/streams?")) {
      return Response.json({ data: [] });
    }
    if (url.startsWith("https://api.twitch.tv/helix/videos?")) {
      return Response.json({
        data: [
          {
            id: "already-alerted-vod",
            title: "Already announced live",
            url: "https://www.twitch.tv/videos/already-alerted-vod",
            created_at: new Date(now - 10_000).toISOString(),
            stream_id: "already-alerted-stream",
          },
          {
            id: "unannounced-vod",
            title: "VOD without a live alert",
            url: "https://www.twitch.tv/videos/unannounced-vod",
            created_at: new Date(now - 20_000).toISOString(),
            stream_id: "unannounced-stream",
          },
          {
            id: "older-vod",
            title: "Old VOD",
            url: "https://www.twitch.tv/videos/older-vod",
            created_at: new Date(now - 120_000).toISOString(),
            stream_id: "old-stream",
          },
        ],
      });
    }
    if (url === "https://discord.com/api/v10/channels/234567890123456789/messages") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    let scheduledTask;
    await worker.scheduled(
      { scheduledTime: now },
      {
        DISCORD_BOT_TOKEN: "test-bot-token",
        FEEDBACK_CONFIG: store,
        TWITCH_CLIENT_ID: "test-client-id",
        TWITCH_CLIENT_SECRET: "test-client-secret",
      },
      { waitUntil: (task) => { scheduledTask = task; } },
    );
    await scheduledTask;

    const announcements = requests.filter((request) =>
      request.url === "https://discord.com/api/v10/channels/234567890123456789/messages"
    );
    assert.equal(announcements.length, 1);
    assert.match(
      JSON.parse(announcements[0].options.body).content,
      /VOD without a live alert/,
    );
    assert.equal(
      values.get("stream-live-alerted:123456789012345678:123456789:already-alerted-stream"),
      "1",
    );

    const settings = JSON.parse(values.get(streamSettingsKey));
    assert.equal(settings.sources[0].activeStreamId, null);
    assert.equal(settings.sources[0].lastObservedVideoId, "already-alerted-vod");
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
