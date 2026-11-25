import {
  getDisplayName,
  getOption,
  getUser,
  isRecord,
} from "./helpers";
import { readReportChannel } from "./report-settings";
import type { DiscordCommand, KeyValueStore } from "./types";

const REPORT_TTL_SECONDS = 365 * 24 * 60 * 60;

function isMessageLink(value: string, guildId: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
  return url.protocol === "https:" &&
    (url.hostname === "discord.com" || url.hostname === "www.discord.com") &&
    /^\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}$/.test(url.pathname) &&
    url.pathname.split("/")[2] === guildId;
}

async function deliverReport(
  store: KeyValueStore,
  guildId: string,
  botToken: string,
  channelId: string,
  displayName: string,
  userId: string,
  message: string,
  messageLink: string | undefined,
): Promise<string> {
  const reportId = crypto.randomUUID();
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: [
            `**Report #${reportId.slice(0, 8)} · Report from ${displayName}** (<@${userId}>)`,
            message,
            ...(messageLink ? [`Message: ${messageLink}`] : []),
          ].join("\n"),
          allowed_mentions: { parse: [] },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Discord returned HTTP ${response.status}.`);
    }
    let posted: unknown;
    try {
      posted = await response.json();
    } catch (error) {
      console.error(
        "Report was delivered but Discord's message details could not be read:",
        error instanceof Error ? error.message : String(error),
      );
      return "Your report was sent, but moderators may not be able to track its status.";
    }
    if (!isRecord(posted) || typeof posted.id !== "string" ||
        !/^\d{17,20}$/.test(posted.id)) {
      console.error("Report was delivered but Discord returned an invalid message.");
      return "Your report was sent, but moderators may not be able to track its status.";
    }
    try {
      await store.put(
        `report-case:${guildId}:${reportId}`,
        JSON.stringify({
          id: reportId,
          guildId,
          channelId,
          messageId: posted.id,
          reporterId: userId,
          status: "open",
          createdAt: Date.now(),
        }),
        { expirationTtl: REPORT_TTL_SECONDS },
      );
    } catch (error) {
      console.error(
        "Report was delivered but its case record could not be saved:",
        error instanceof Error ? error.message : String(error),
      );
      return "Your report was sent, but moderators may not be able to track its status.";
    }
    return "Your report was sent to the moderators.";
  } catch (error) {
    console.error(
      "Could not deliver moderator report:",
      error instanceof Error ? error.message : String(error),
    );
    return "Your report could not be delivered. Please try again later.";
  }
}

const reportCommand = {
  name: "report",
  description: "Send a report to this server's moderators with your username.",
  options: [
    {
      type: 3,
      name: "message",
      description: "Describe the issue for the moderators.",
      required: true,
      min_length: 1,
      max_length: 1000,
    },
    {
      type: 3,
      name: "message_link",
      description: "Optional link to the relevant Discord message.",
      required: false,
      max_length: 200,
    },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const user = getUser(interaction);
    const userId = user?.id;
    const messageValue = getOption(interaction, "message");
    const message = typeof messageValue === "string" ? messageValue.trim() : "";
    const linkValue = getOption(interaction, "message_link");
    const messageLink = typeof linkValue === "string" ? linkValue.trim() : "";
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return {
        content: "Reports can only be submitted from a server.",
        ephemeral: true,
      };
    }
    if (
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId) ||
      message.length === 0 ||
      message.length > 1000
    ) {
      return {
        content: "Provide a description of the issue.",
        ephemeral: true,
      };
    }
    if (messageLink && !isMessageLink(messageLink, guildId)) {
      return {
        content: "The message link must point to a Discord message in this server.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG || !env.DISCORD_BOT_TOKEN) {
      console.error("Report delivery is missing its KV binding or bot token.");
      return {
        content: "Reports are temporarily unavailable.",
        ephemeral: true,
      };
    }

    let channelId: string | null;
    try {
      channelId = await readReportChannel(env.FEEDBACK_CONFIG, guildId);
    } catch (error) {
      console.error(
        "Could not read report channel:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Reports are temporarily unavailable. Please contact a server moderator.",
        ephemeral: true,
      };
    }
    if (!channelId) {
      return {
        content: "Reports have not been configured. Ask a server admin to run `/setup-reports`.",
        ephemeral: true,
      };
    }
    const displayName = getDisplayName(user ?? {});
    const store = env.FEEDBACK_CONFIG;
    return {
      content: "Sending your report…",
      ephemeral: true,
      backgroundTask: deliverReport(
        store,
        guildId,
        env.DISCORD_BOT_TOKEN,
        channelId,
        displayName,
        userId,
        message,
        messageLink || undefined,
      ),
    };
  },
} satisfies DiscordCommand;

export default reportCommand;
