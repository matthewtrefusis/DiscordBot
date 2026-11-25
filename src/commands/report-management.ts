import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import type { DiscordCommand, KeyValueStore } from "./types";

type ReportStatus = "open" | "reviewing" | "resolved";

interface ReportCase {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  reporterId: string;
  status: ReportStatus;
  createdAt: number;
}

function parseReportCase(value: string): ReportCase | null {
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
    !/^[0-9a-f-]{36}$/.test(parsed.id) ||
    typeof parsed.guildId !== "string" ||
    !/^\d{17,20}$/.test(parsed.guildId) ||
    typeof parsed.channelId !== "string" ||
    !/^\d{17,20}$/.test(parsed.channelId) ||
    typeof parsed.messageId !== "string" ||
    !/^\d{17,20}$/.test(parsed.messageId) ||
    typeof parsed.reporterId !== "string" ||
    !/^\d{17,20}$/.test(parsed.reporterId) ||
    (parsed.status !== "open" && parsed.status !== "reviewing" &&
      parsed.status !== "resolved") ||
    typeof parsed.createdAt !== "number" ||
    !Number.isFinite(parsed.createdAt)
  ) return null;
  return {
    id: parsed.id,
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    messageId: parsed.messageId,
    reporterId: parsed.reporterId,
    status: parsed.status,
    createdAt: parsed.createdAt,
  };
}

async function listReportCases(
  store: KeyValueStore,
  guildId: string,
): Promise<{ key: string; report: ReportCase }[]> {
  const reports: { key: string; report: ReportCase }[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: `report-case:${guildId}:`,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const { name } of page.keys) {
      const raw = await store.get(name);
      if (!raw) continue;
      const report = parseReportCase(raw);
      if (report) reports.push({ key: name, report });
      else console.error(`Ignoring malformed report case ${name}.`);
    }
    if (page.list_complete) break;
    if (!page.cursor) throw new Error("Cloudflare KV did not return a report cursor.");
    cursor = page.cursor;
  } while (true);
  return reports.sort((a, b) => b.report.createdAt - a.report.createdAt);
}

const reportsCommand = {
  name: "reports",
  description: "List moderator reports and their review status.",
  default_member_permissions: "32",
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    if (!canManageServer(interaction)) {
      return { content: "You need Manage Server permission to review reports.", ephemeral: true };
    }
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) || !env.FEEDBACK_CONFIG) {
      return { content: "Report management is unavailable in this context.", ephemeral: true };
    }
    try {
      const reports = await listReportCases(env.FEEDBACK_CONFIG, guildId);
      const open = reports.filter(({ report }) => report.status !== "resolved").slice(0, 10);
      if (!open.length) return { content: "No open moderator reports.", ephemeral: true };
      return {
        content: open.map(({ report }) =>
          `**#${report.id.slice(0, 8)}** · ${report.status} · <@${report.reporterId}> · <t:${Math.floor(report.createdAt / 1000)}:R>\nhttps://discord.com/channels/${guildId}/${report.channelId}/${report.messageId}`
        ).join("\n\n"),
        ephemeral: true,
      };
    } catch (error) {
      console.error("Could not list report cases:", error instanceof Error ? error.message : String(error));
      return { content: "Report cases could not be loaded.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const reportStatusCommand = {
  name: "report-status",
  description: "Update the status of a moderator report.",
  default_member_permissions: "32",
  options: [
    { type: 3, name: "id", description: "The eight-character report ID.", required: true, min_length: 8, max_length: 8 },
    { type: 3, name: "status", description: "The review status.", required: true, choices: [{ name: "Open", value: "open" }, { name: "Reviewing", value: "reviewing" }, { name: "Resolved", value: "resolved" }] },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const id = getOption(interaction, "id");
    const status = getOption(interaction, "status");
    if (!canManageServer(interaction)) {
      return { content: "You need Manage Server permission to update reports.", ephemeral: true };
    }
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
        typeof id !== "string" || !/^[0-9a-f]{8}$/.test(id) || !env.FEEDBACK_CONFIG) {
      return { content: "Choose a valid report ID and status.", ephemeral: true };
    }
    if (status !== "open" && status !== "reviewing" && status !== "resolved") {
      return { content: "Choose open, reviewing, or resolved.", ephemeral: true };
    }
    try {
      const entry = (await listReportCases(env.FEEDBACK_CONFIG, guildId))
        .find(({ report }) => report.id.startsWith(id));
      if (!entry) return { content: "That report was not found.", ephemeral: true };
      const updated = { ...entry.report, status };
      await env.FEEDBACK_CONFIG.put(entry.key, JSON.stringify(updated), {
        expirationTtl: 365 * 24 * 60 * 60,
      });
      if (!env.DISCORD_BOT_TOKEN) {
        console.error("DISCORD_BOT_TOKEN is not configured for report updates.");
        return { content: `Saved report #${id} as **${status}**, but the original post could not be updated.`, ephemeral: true };
      }
      const messageUrl = `https://discord.com/api/v10/channels/${entry.report.channelId}/messages/${entry.report.messageId}`;
      const getResponse = await fetch(messageUrl, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      });
      if (!getResponse.ok) {
        console.error(`Could not load report message (HTTP ${getResponse.status}).`);
        return { content: `Saved report #${id} as **${status}**, but its message could not be updated.`, ephemeral: true };
      }
      const message: unknown = await getResponse.json();
      if (!isRecord(message) || typeof message.content !== "string") {
        console.error("Discord returned an invalid report message.");
        return { content: `Saved report #${id} as **${status}**, but its message could not be updated.`, ephemeral: true };
      }
      const content = message.content.replace(/\n\nStatus: \*\*(open|reviewing|resolved)\*\*$/, "");
      const patchResponse = await fetch(messageUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: `${content}\n\nStatus: **${status}**`,
          allowed_mentions: { parse: [] },
        }),
      });
      if (!patchResponse.ok) {
        console.error(`Could not update report message (HTTP ${patchResponse.status}).`);
        return { content: `Saved report #${id} as **${status}**, but its message could not be updated.`, ephemeral: true };
      }
      return { content: `Report #${id} is now **${status}**.`, ephemeral: true };
    } catch (error) {
      console.error("Could not update report status:", error instanceof Error ? error.message : String(error));
      return { content: "The report status could not be updated.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

export { reportsCommand, reportStatusCommand };
