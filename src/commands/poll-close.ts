import { getOption, isRecord } from "./helpers";
import {
  listPolls,
  pollKey,
  readPollState,
  renderPoll,
} from "./poll";
import { canManageServer } from "./permissions";
import type { DiscordCommand } from "./types";

function focusedValue(interaction: Record<string, unknown>): string {
  const data = interaction.data;
  const options = isRecord(data) && Array.isArray(data.options)
    ? data.options
    : [];
  const focused = options.find(
    (option) => isRecord(option) && option.focused === true,
  );
  return isRecord(focused) && typeof focused.value === "string"
    ? focused.value.toLowerCase()
    : "";
}

const pollCloseCommand = {
  name: "poll-close",
  description: "Close a poll and prevent further votes.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "poll",
      description: "The poll to close.",
      required: true,
      autocomplete: true,
    },
  ],
  autocomplete: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      !env.FEEDBACK_CONFIG
    ) {
      return [];
    }
    try {
      const query = focusedValue(interaction);
      return (await listPolls(env.FEEDBACK_CONFIG, guildId))
        .filter(({ poll }) =>
          !poll.closed && poll.question.toLowerCase().includes(query)
        )
        .slice(0, 25)
        .map(({ id, poll }) => ({
          name: poll.question.slice(0, 100),
          value: id,
        }));
    } catch (error) {
      console.error(
        "Could not load polls for closing:",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const pollId = getOption(interaction, "poll");
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return {
        content: "This command can only be used in a server.",
        ephemeral: true,
      };
    }
    if (!canManageServer(interaction)) {
      return {
        content: "You need Manage Server permission to close polls.",
        ephemeral: true,
      };
    }
    if (
      !env.FEEDBACK_CONFIG ||
      !env.DISCORD_BOT_TOKEN ||
      typeof pollId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(pollId)
    ) {
      return {
        content: "Choose an open poll to close.",
        ephemeral: true,
      };
    }

    let closed = false;
    try {
      const key = pollKey(pollId);
      const rawPoll = await env.FEEDBACK_CONFIG.get(key);
      const poll = rawPoll ? readPollState(rawPoll) : null;
      if (!poll || poll.guildId !== guildId) {
        return {
          content: "That poll is unavailable.",
          ephemeral: true,
        };
      }
      if (poll.closed) {
        return {
          content: "That poll is already closed.",
          ephemeral: true,
        };
      }

      const closedPoll = { ...poll, closed: true };
      await env.FEEDBACK_CONFIG.put(
        key,
        JSON.stringify(closedPoll),
        { expirationTtl: 365 * 24 * 60 * 60 },
      );
      closed = true;
      if (closedPoll.messageId) {
        const response = await fetch(
          `https://discord.com/api/v10/channels/${encodeURIComponent(closedPoll.channelId)}/messages/${encodeURIComponent(closedPoll.messageId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...renderPoll(pollId, closedPoll),
              allowed_mentions: { parse: [] },
            }),
          },
        );
        if (!response.ok) {
          throw new Error(`Discord returned HTTP ${response.status}.`);
        }
      }
      return {
        content: `Closed **${poll.question}**.`,
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not close poll:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: closed
          ? "The poll is closed, but its message could not be updated. Please check the bot's channel permissions."
          : "The poll could not be closed. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default pollCloseCommand;
