import { isRecord } from "./helpers";
import type {
  CommandContext,
  CommandResponse,
  KeyValueStore,
} from "./types";

const ADMINISTRATOR = 8n;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export const MODERATION_PERMISSIONS = {
  kickMembers: 2n,
  banMembers: 4n,
  manageMessages: 8192n,
  moderateMembers: 1099511627776n,
} as const;

type ModerationContextResult =
  | { guildId: string; botToken: string }
  | { error: CommandResponse };

type DiscordRequestResult =
  | { response: Response }
  | { error: string };

interface DiscordRequest {
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: string;
  botToken: string;
  body?: unknown;
  reason?: string;
}

export function getModerationContext(
  context: CommandContext,
  requiredPermission: bigint,
  permissionName: string,
): ModerationContextResult {
  const guildId = context.interaction.guild_id;
  if (typeof guildId !== "string") {
    return {
      error: {
        content: "Moderation commands can only be used in a server.",
        ephemeral: true,
      },
    };
  }

  const member = context.interaction.member;
  const rawPermissions = isRecord(member) ? member.permissions : undefined;
  const permissions = typeof rawPermissions === "string" &&
      /^\d+$/.test(rawPermissions)
    ? BigInt(rawPermissions)
    : 0n;
  if (
    (permissions & requiredPermission) === 0n &&
    (permissions & ADMINISTRATOR) === 0n
  ) {
    return {
      error: {
        content: `You need the ${permissionName} permission to use this command.`,
        ephemeral: true,
      },
    };
  }

  const botToken = context.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error("DISCORD_BOT_TOKEN is not configured for moderation.");
    return {
      error: {
        content: "Moderation is not configured. Please contact a server admin.",
        ephemeral: true,
      },
    };
  }

  return { guildId, botToken };
}

export function getModerationTargetId(value: unknown): string | null {
  return typeof value === "string" && /^\d{17,20}$/.test(value)
    ? value
    : null;
}

export function getModerationReason(value: unknown): string | null {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    return null;
  }

  const reason = value.trim();
  return reason.length <= 400 ? reason : null;
}

export function moderationResponse(
  backgroundTask: Promise<string>,
): CommandResponse {
  return {
    content: "Applying moderation action…",
    ephemeral: true,
    backgroundTask,
  };
}

export async function requestDiscord(
  request: DiscordRequest,
): Promise<DiscordRequestResult> {
  const headers: Record<string, string> = {
    Authorization: `Bot ${request.botToken}`,
  };
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (request.reason) {
    headers["X-Audit-Log-Reason"] = encodeURIComponent(request.reason);
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10${request.path}`,
      {
        method: request.method,
        headers,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
      },
    );
    if (!response.ok) {
      return { error: getDiscordErrorMessage(request.method, response.status) };
    }
    return { response };
  } catch (error) {
    console.error(
      `Discord moderation request failed (${request.method}):`,
      error instanceof Error ? error.message : String(error),
    );
    return {
      error: "Discord could not complete that moderation action. Please try again.",
    };
  }
}

export async function recordModerationCase(
  store: KeyValueStore,
  guildId: string,
  targetId: string,
  moderatorId: string,
  action: string,
  reason: string,
): Promise<void> {
  const createdAt = Date.now();
  const id = crypto.randomUUID();
  await store.put(
    `moderation-case:${guildId}:${String(createdAt).padStart(16, "0")}:${id}`,
    JSON.stringify({
      id,
      guildId,
      targetId,
      moderatorId,
      action,
      reason,
      createdAt,
    }),
    { expirationTtl: 365 * 24 * 60 * 60 },
  );
}

export async function moderationActionWithCase(
  request: Promise<DiscordRequestResult>,
  store: KeyValueStore | undefined,
  guildId: string,
  targetId: string,
  moderatorId: string,
  action: string,
  reason: string,
  successMessage: string,
): Promise<string> {
  const result = await request;
  if ("error" in result) return result.error;
  if (!store) {
    console.error("Moderation action succeeded without case-history storage.");
    return `${successMessage} Case history is unavailable because KV is not configured.`;
  }
  try {
    await recordModerationCase(
      store,
      guildId,
      targetId,
      moderatorId,
      action,
      reason,
    );
    return successMessage;
  } catch (error) {
    console.error(
      "Moderation action succeeded but its case record could not be saved:",
      error instanceof Error ? error.message : String(error),
    );
    return `${successMessage} The case record could not be saved.`;
  }
}

function getDiscordErrorMessage(method: string, status: number): string {
  console.error(`Discord moderation request failed (${method}, HTTP ${status}).`);
  if (status === 401) {
    return "The bot could not authenticate with Discord. Please contact an admin.";
  }
  if (status === 403) {
    return "Discord denied this action. Check the bot's permissions and, when targeting members, its role hierarchy.";
  }
  if (status === 404) {
    return "That member or resource could not be found.";
  }
  if (status === 429) {
    return "Discord is rate limiting the bot. Please try again shortly.";
  }
  return "Discord could not complete that moderation action. Please try again.";
}

export async function purgeRecentMessages(
  botToken: string,
  channelId: string,
  count: number,
  reason: string,
): Promise<string> {
  const channelPath = `/channels/${encodeURIComponent(channelId)}`;
  const fetched = await requestDiscord({
    method: "GET",
    path: `${channelPath}/messages?limit=${count}`,
    botToken,
  });
  if ("error" in fetched) {
    return fetched.error;
  }

  let messages: unknown;
  try {
    messages = await fetched.response.json();
  } catch (error) {
    console.error(
      "Could not parse Discord's recent messages response:",
      error instanceof Error ? error.message : String(error),
    );
    return "Discord returned an invalid message list. Please try again.";
  }
  if (!Array.isArray(messages)) {
    console.error("Discord returned an invalid recent messages response.");
    return "Discord returned an invalid message list. Please try again.";
  }

  const cutoff = Date.now() - TWO_WEEKS_MS;
  const messageIds = messages
    .filter((message: unknown): message is { id: string; timestamp: string } =>
      isRecord(message) &&
      typeof message.id === "string" &&
      /^\d{17,20}$/.test(message.id) &&
      typeof message.timestamp === "string" &&
      Date.parse(message.timestamp) >= cutoff
    )
    .map((message) => message.id);

  if (messageIds.length === 0) {
    return "No messages newer than 14 days were found.";
  }

  const deletion = messageIds.length === 1
    ? await requestDiscord({
      method: "DELETE",
      path: `${channelPath}/messages/${encodeURIComponent(messageIds[0])}`,
      botToken,
      reason,
    })
    : await requestDiscord({
      method: "POST",
      path: `${channelPath}/messages/bulk-delete`,
      botToken,
      body: { messages: messageIds },
      reason,
    });
  if ("error" in deletion) {
    return deletion.error;
  }

  const deleted = messageIds.length;
  return `Deleted ${deleted} message${deleted === 1 ? "" : "s"}.`;
}
