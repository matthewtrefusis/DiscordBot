import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import { listPolls } from "./poll";
import {
  POLL_REMINDER_TTL_SECONDS,
  pollReminderDueKey,
  pollReminderKey,
} from "../poll-reminders";
import type { DiscordCommand } from "./types";

const MAX_REMINDER_MINUTES = 356 * 24 * 60;

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

const pollRemindCommand = {
  name: "poll-remind",
  description: "Schedule a reminder for an open poll.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "poll",
      description: "The poll to remind members about.",
      required: true,
      autocomplete: true,
    },
    {
      type: 4,
      name: "minutes",
      description: "How many minutes from now (1-512640).",
      required: true,
      min_value: 1,
      max_value: MAX_REMINDER_MINUTES,
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
        "Could not load polls for reminders:",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const pollId = getOption(interaction, "poll");
    const minutes = getOption(interaction, "minutes");
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return {
        content: "This command can only be used in a server.",
        ephemeral: true,
      };
    }
    if (!canManageServer(interaction)) {
      return {
        content: "You need Manage Server permission to schedule poll reminders.",
        ephemeral: true,
      };
    }
    if (
      typeof pollId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(pollId) ||
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_REMINDER_MINUTES
    ) {
      return {
        content: "Choose an open poll and a reminder delay between 1 minute and 356 days.",
        ephemeral: true,
      };
    }
    const store = env.FEEDBACK_CONFIG;
    if (!store) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Poll reminders are temporarily unavailable.",
        ephemeral: true,
      };
    }
    try {
      const poll = (await listPolls(store, guildId))
        .find(({ id }) => id === pollId)?.poll;
      if (!poll || poll.closed) {
        return {
          content: "That poll is unavailable or closed.",
          ephemeral: true,
        };
      }
      const dueAt = Date.now() + minutes * 60_000;
      const id = crypto.randomUUID();
      const reminder = {
        id,
        guildId,
        channelId: poll.channelId,
        pollId,
        dueAt,
        attempts: 0,
      };
      try {
        await store.put(pollReminderKey(id), JSON.stringify(reminder), {
          expirationTtl: POLL_REMINDER_TTL_SECONDS,
        });
        await store.put(pollReminderDueKey(dueAt, id), "1", {
          expirationTtl: POLL_REMINDER_TTL_SECONDS,
        });
      } catch (error) {
        for (const key of [
          pollReminderKey(id),
          pollReminderDueKey(dueAt, id),
        ]) {
          try {
            await store.delete(key);
          } catch (deleteError) {
            console.error(
              `Could not remove incomplete poll reminder ${key}:`,
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError),
            );
          }
        }
        throw error;
      }
      return {
        content: `I'll remind the channel to vote on **${poll.question}** <t:${Math.floor(dueAt / 1000)}:R>.`,
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not schedule poll reminder:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "The poll reminder could not be scheduled. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default pollRemindCommand;
