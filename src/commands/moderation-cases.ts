import { getOption, getUser, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import {
  getModerationContext,
  getModerationTargetId,
  MODERATION_PERMISSIONS,
  recordModerationCase,
} from "./moderation-helpers";
import type { DiscordCommand } from "./types";

interface ModerationCase {
  id: string;
  guildId: string;
  targetId: string;
  moderatorId: string;
  action: string;
  reason: string;
  createdAt: number;
}

function parseCase(value: string): ModerationCase | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.id !== "string" ||
    typeof parsed.guildId !== "string" || !/^\d{17,20}$/.test(parsed.guildId) ||
    typeof parsed.targetId !== "string" || !/^\d{17,20}$/.test(parsed.targetId) ||
    typeof parsed.moderatorId !== "string" || !/^\d{17,20}$/.test(parsed.moderatorId) ||
    typeof parsed.action !== "string" ||
    typeof parsed.reason !== "string" ||
    typeof parsed.createdAt !== "number" || !Number.isFinite(parsed.createdAt)
  ) return null;
  return {
    id: parsed.id,
    guildId: parsed.guildId,
    targetId: parsed.targetId,
    moderatorId: parsed.moderatorId,
    action: parsed.action,
    reason: parsed.reason,
    createdAt: parsed.createdAt,
  };
}

const warnCommand = {
  name: "warn",
  description: "Record a moderator warning for a member.",
  default_member_permissions: "1099511627776",
  options: [
    { type: 6, name: "user", description: "The member to warn.", required: true },
    { type: 3, name: "reason", description: "Why the warning is being issued.", required: true, min_length: 1, max_length: 400 },
  ],
  execute: async (context) => {
    const { env, interaction } = context;
    const moderation = getModerationContext(context, MODERATION_PERMISSIONS.moderateMembers, "Moderate Members");
    if ("error" in moderation) return moderation.error;
    const targetId = getModerationTargetId(getOption(interaction, "user"));
    const moderatorId = getUser(interaction)?.id;
    const reasonValue = getOption(interaction, "reason");
    const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";
    if (!targetId || typeof moderatorId !== "string" || !reason || reason.length > 400) {
      return { content: "Choose a member and provide a reason of at most 400 characters.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured for moderation cases.");
      return { content: "Moderation case storage is temporarily unavailable.", ephemeral: true };
    }
    try {
      await recordModerationCase(env.FEEDBACK_CONFIG, moderation.guildId, targetId, moderatorId, "warning", reason);
      return { content: `Recorded a warning for <@${targetId}>.`, ephemeral: true };
    } catch (error) {
      console.error("Could not save warning case:", error instanceof Error ? error.message : String(error));
      return { content: "The warning could not be recorded. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const moderationCasesCommand = {
  name: "mod-cases",
  description: "Show a member's moderation case history.",
  default_member_permissions: "32",
  options: [{ type: 6, name: "user", description: "The member whose cases to show.", required: true }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const targetId = getModerationTargetId(getOption(interaction, "user"));
    if (!canManageServer(interaction)) return { content: "You need Manage Server permission to view moderation cases.", ephemeral: true };
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) || !targetId || !env.FEEDBACK_CONFIG) {
      return { content: "Choose a valid member in a server with case storage.", ephemeral: true };
    }
    try {
      const cases: ModerationCase[] = [];
      let cursor: string | undefined;
      do {
        const page = await env.FEEDBACK_CONFIG.list({
          prefix: `moderation-case:${guildId}:`,
          limit: 1000,
          ...(cursor ? { cursor } : {}),
        });
        for (const { name } of page.keys) {
          const raw = await env.FEEDBACK_CONFIG.get(name);
          if (!raw) continue;
          const record = parseCase(raw);
          if (record?.targetId === targetId) cases.push(record);
          else if (!record) console.error(`Ignoring malformed moderation case ${name}.`);
        }
        if (page.list_complete) break;
        if (!page.cursor) throw new Error("Cloudflare KV did not return a moderation case cursor.");
        cursor = page.cursor;
      } while (true);
      cases.sort((a, b) => b.createdAt - a.createdAt);
      const recent = cases.slice(0, 10);
      if (!recent.length) return { content: `No moderation cases found for <@${targetId}>.`, ephemeral: true };
      return {
        content: `**Moderation history for <@${targetId}> (${cases.length})**\n` +
          recent.map((record) =>
            `• **${record.action}** by <@${record.moderatorId}> · <t:${Math.floor(record.createdAt / 1000)}:R>${record.reason ? `\n  ${record.reason}` : ""}`
          ).join("\n"),
        ephemeral: true,
      };
    } catch (error) {
      console.error("Could not load moderation cases:", error instanceof Error ? error.message : String(error));
      return { content: "Moderation cases could not be loaded.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

export { warnCommand, moderationCasesCommand };
