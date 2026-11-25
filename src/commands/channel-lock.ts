import { getModerationContext } from "./moderation-helpers";
import { isRecord } from "./helpers";
import type { CommandContext, DiscordCommand } from "./types";

const SEND_MESSAGES = 2048n;
type Overwrite = { id: string; type: number; allow: string; deny: string };
type LockSnapshot =
  | { hadOverwrite: false }
  | { hadOverwrite: true; allow: string; deny: string };

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function parseOverwrites(value: unknown): Overwrite[] | null {
  if (!Array.isArray(value)) return null;
  const result: Overwrite[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" || !/^\d{17,20}$/.test(item.id) ||
      (item.type !== 0 && item.type !== 1) ||
      typeof item.allow !== "string" || !/^\d+$/.test(item.allow) ||
      typeof item.deny !== "string" || !/^\d+$/.test(item.deny)
    ) return null;
    result.push({ id: item.id, type: item.type, allow: item.allow, deny: item.deny });
  }
  return result;
}

function parseLockSnapshot(value: unknown): LockSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.hadOverwrite === false) return { hadOverwrite: false };
  if (
    value.hadOverwrite === true &&
    typeof value.allow === "string" &&
    /^\d+$/.test(value.allow) &&
    typeof value.deny === "string" &&
    /^\d+$/.test(value.deny)
  ) {
    return { hadOverwrite: true, allow: value.allow, deny: value.deny };
  }
  return null;
}

async function getChannel(
  token: string,
  channelId: string,
): Promise<{ overwrites: Overwrite[] } | null> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok) throw new Error(`Discord channel lookup returned HTTP ${response.status}.`);
  const channel: unknown = await response.json();
  if (!isRecord(channel)) return null;
  const overwrites = parseOverwrites(channel.permission_overwrites);
  return overwrites ? { overwrites } : null;
}

async function setOverwrites(
  token: string,
  channelId: string,
  overwrites: Overwrite[],
): Promise<void> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ permission_overwrites: overwrites }),
  });
  if (!response.ok) throw new Error(`Discord permission update returned HTTP ${response.status}.`);
}

function permissionContext(
  context: CommandContext,
): { guildId: string; channelId: string; botToken: string } | string {
  const result = getModerationContext(
    context,
    16n,
    "Manage Channels",
  );
  if ("error" in result) return result.error.content;
  const channelId = context.interaction.channel_id;
  if (!isSnowflake(channelId)) return "This command needs a server text channel.";
  if (!context.env.FEEDBACK_CONFIG) {
    console.error("FEEDBACK_CONFIG KV binding is not configured for channel locking.");
    return "Channel locking is temporarily unavailable.";
  }
  return { ...result, channelId };
}

async function lockChannel(context: CommandContext): Promise<string> {
  const permission = permissionContext(context);
  if (typeof permission === "string") return permission;
  const store = context.env.FEEDBACK_CONFIG;
  if (!store) return "Channel locking is temporarily unavailable.";
  const key = `channel-lock:${permission.guildId}:${permission.channelId}`;
  try {
    if (await store.get(key)) return "This channel is already locked by the bot.";
    const channel = await getChannel(permission.botToken, permission.channelId);
    if (!channel) throw new Error("Discord returned invalid channel permissions.");
    const previous = channel.overwrites.find(
      (overwrite) => overwrite.id === permission.guildId && overwrite.type === 0,
    );
    const snapshot = {
      hadOverwrite: Boolean(previous),
      ...(previous ? { allow: previous.allow, deny: previous.deny } : {}),
    };
    const currentAllow = previous ? BigInt(previous.allow) : 0n;
    const currentDeny = previous ? BigInt(previous.deny) : 0n;
    const updated: Overwrite = {
      id: permission.guildId,
      type: 0,
      allow: (currentAllow & ~SEND_MESSAGES).toString(),
      deny: (currentDeny | SEND_MESSAGES).toString(),
    };
    await store.put(key, JSON.stringify(snapshot));
    try {
      await setOverwrites(
        permission.botToken,
        permission.channelId,
        previous
          ? channel.overwrites.map((overwrite) =>
            overwrite.id === permission.guildId && overwrite.type === 0
              ? updated
              : overwrite
          )
          : [...channel.overwrites, updated],
      );
    } catch (error) {
      await store.delete(key);
      throw error;
    }
    return "Locked this channel for @everyone.";
  } catch (error) {
    console.error("Could not lock channel:", error instanceof Error ? error.message : String(error));
    return "The channel could not be locked. Check the bot's Manage Channels permission.";
  }
}

async function unlockChannel(context: CommandContext): Promise<string> {
  const permission = permissionContext(context);
  if (typeof permission === "string") return permission;
  const store = context.env.FEEDBACK_CONFIG;
  if (!store) return "Channel locking is temporarily unavailable.";
  const key = `channel-lock:${permission.guildId}:${permission.channelId}`;
  try {
    const rawSnapshot = await store.get(key);
    if (!rawSnapshot) return "This channel is not locked by the bot.";
    let snapshotValue: unknown;
    try {
      snapshotValue = JSON.parse(rawSnapshot);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Stored channel lock settings are invalid JSON.");
      throw error;
    }
    const snapshot = parseLockSnapshot(snapshotValue);
    if (!snapshot) throw new Error("Stored channel lock settings have an invalid format.");
    const channel = await getChannel(permission.botToken, permission.channelId);
    if (!channel) throw new Error("Discord returned invalid channel permissions.");
    const current = channel.overwrites.find(
      (overwrite) => overwrite.id === permission.guildId && overwrite.type === 0,
    );
    let updated = channel.overwrites;
    if (snapshot.hadOverwrite && current) {
      const currentAllow = BigInt(current.allow);
      const currentDeny = BigInt(current.deny);
      const previousAllow = BigInt(snapshot.allow);
      const previousDeny = BigInt(snapshot.deny);
      const restored: Overwrite = {
        id: permission.guildId,
        type: 0,
        allow: ((currentAllow & ~SEND_MESSAGES) |
          (previousAllow & SEND_MESSAGES)).toString(),
        deny: ((currentDeny & ~SEND_MESSAGES) |
          (previousDeny & SEND_MESSAGES)).toString(),
      };
      updated = channel.overwrites.map((overwrite) =>
        overwrite.id === permission.guildId && overwrite.type === 0
          ? restored
          : overwrite
      );
    } else if (snapshot.hadOverwrite) {
      updated = [...channel.overwrites, {
        id: permission.guildId,
        type: 0,
        allow: snapshot.allow,
        deny: snapshot.deny,
      }];
    } else if (current) {
      const remainingAllow = BigInt(current.allow) & ~SEND_MESSAGES;
      const remainingDeny = BigInt(current.deny) & ~SEND_MESSAGES;
      updated = remainingAllow === 0n && remainingDeny === 0n
        ? channel.overwrites.filter(
          (overwrite) => overwrite.id !== permission.guildId || overwrite.type !== 0,
        )
        : channel.overwrites.map((overwrite) =>
          overwrite.id === permission.guildId && overwrite.type === 0
            ? {
              id: permission.guildId,
              type: 0,
              allow: remainingAllow.toString(),
              deny: remainingDeny.toString(),
            }
            : overwrite
        );
    }
    await setOverwrites(permission.botToken, permission.channelId, updated);
    await store.delete(key);
    return "Restored this channel's previous @everyone permissions.";
  } catch (error) {
    console.error("Could not unlock channel:", error instanceof Error ? error.message : String(error));
    return "The channel could not be unlocked. Its saved permissions were not intentionally discarded.";
  }
}

const channelLockCommand = {
  name: "channel-lock",
  description: "Prevent @everyone from sending messages in this channel.",
  default_member_permissions: "16",
  execute: async (context) => ({
    content: await lockChannel(context),
    ephemeral: true,
  }),
} satisfies DiscordCommand;

const channelUnlockCommand = {
  name: "channel-unlock",
  description: "Restore this channel's previous @everyone permissions.",
  default_member_permissions: "16",
  execute: async (context) => ({
    content: await unlockChannel(context),
    ephemeral: true,
  }),
} satisfies DiscordCommand;

export { channelLockCommand, channelUnlockCommand };
