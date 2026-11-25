import { getOption, isRecord } from "./helpers";
import { countsFor, listPolls } from "./poll";
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

const pollResultsCommand = {
  name: "poll-results",
  description: "Show the current or final results of a poll.",
  options: [
    {
      type: 3,
      name: "poll",
      description: "The poll whose results to show.",
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
          poll.question.toLowerCase().includes(query)
        )
        .slice(0, 25)
        .map(({ id, poll }) => ({
          name: `${poll.closed ? "Closed · " : ""}${poll.question}`.slice(0, 100),
          value: id,
        }));
    } catch (error) {
      console.error(
        "Could not load polls for results:",
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
    if (!env.FEEDBACK_CONFIG || typeof pollId !== "string") {
      return {
        content: "Choose a poll to view its results.",
        ephemeral: true,
      };
    }
    try {
      const poll = (await listPolls(env.FEEDBACK_CONFIG, guildId))
        .find(({ id }) => id === pollId)?.poll;
      if (!poll) {
        return {
          content: "That poll is unavailable.",
          ephemeral: true,
        };
      }
      const counts = countsFor(poll);
      const total = counts.reduce((sum, count) => sum + count, 0);
      return {
        content: [
          `**${poll.closed ? "Final results" : "Current results"}: ${poll.question}**`,
          ...poll.options.map((option, index) =>
            `• ${option}: **${counts[index]}** vote(s)`
          ),
          `Total votes: **${total}**`,
        ].join("\n"),
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not read poll results:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not load poll results. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default pollResultsCommand;
