import { getOption, getUser } from "./helpers";
import { eventDueKey, eventKey } from "../events";
import { canManageServer } from "./permissions";
import { parseLocalDateTime, readUserTimeZone } from "../time-utils";
import type { DiscordCommand } from "./types";

const MAX_EVENT_DELAY_MS = 356 * 24 * 60 * 60 * 1000;

const eventCommand = {
  name: "event",
  description: "Schedule an announcement in this channel.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "title",
      description: "What is happening?",
      required: true,
      min_length: 1,
      max_length: 150,
    },
    {
      type: 3,
      name: "local_time",
      description: "Local date and time, YYYY-MM-DD HH:mm (24-hour clock).",
      required: true,
      min_length: 16,
      max_length: 16,
    },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;
    const user = getUser(interaction);
    const userId = user?.id;
    const titleValue = getOption(interaction, "title");
    const title = typeof titleValue === "string" ? titleValue.trim() : "";
    const localTime = getOption(interaction, "local_time");
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof channelId !== "string" ||
      !/^\d{17,20}$/.test(channelId)
    ) {
      return {
        content: "Events can only be scheduled in a server text channel.",
        ephemeral: true,
      };
    }
    if (!canManageServer(interaction)) {
      return {
        content: "You need Manage Server permission to schedule events.",
        ephemeral: true,
      };
    }
    if (
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId) ||
      title.length === 0 ||
      title.length > 150 ||
      typeof localTime !== "string"
    ) {
      return {
        content: "Provide an event title and a valid local date and time.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Event scheduling is temporarily unavailable.",
        ephemeral: true,
      };
    }

    let timeZone: string | null;
    try {
      timeZone = await readUserTimeZone(env.FEEDBACK_CONFIG, userId);
    } catch (error) {
      console.error(
        "Could not read event creator timezone:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Your timezone could not be loaded. Please try again later.",
        ephemeral: true,
      };
    }
    if (!timeZone) {
      return {
        content: "Set your timezone first with `/timezone timezone:Europe/London`.",
        ephemeral: true,
      };
    }

    const result = parseLocalDateTime(localTime, timeZone);
    if (result.status === "ambiguous") {
      return {
        content: "That local time occurs twice because of a daylight-saving change. Choose a different time.",
        ephemeral: true,
      };
    }
    if (result.status !== "valid") {
      return {
        content: "Use a real date and time in `YYYY-MM-DD HH:mm` format. Times skipped by daylight-saving changes are not valid.",
        ephemeral: true,
      };
    }
    const now = Date.now();
    if (
      result.timestamp < now + 60_000 ||
      result.timestamp > now + MAX_EVENT_DELAY_MS
    ) {
      return {
        content: "Choose a time at least one minute from now and no more than 356 days away.",
        ephemeral: true,
      };
    }

    const eventId = crypto.randomUUID();
    const scheduledEvent = {
      guildId,
      channelId,
      title,
      startsAt: result.timestamp,
      createdBy: userId,
      attempts: 0,
    };
    try {
      await env.FEEDBACK_CONFIG.put(
        eventKey(guildId, eventId),
        JSON.stringify(scheduledEvent),
      );
      await env.FEEDBACK_CONFIG.put(
        eventDueKey(result.timestamp, guildId, eventId),
        "1",
      );
    } catch (error) {
      for (const incompleteKey of [
        eventKey(guildId, eventId),
        eventDueKey(result.timestamp, guildId, eventId),
      ]) {
        try {
          await env.FEEDBACK_CONFIG.delete(incompleteKey);
        } catch (deleteError) {
          console.error(
            `Could not remove incomplete scheduled event state ${incompleteKey}:`,
            deleteError instanceof Error
              ? deleteError.message
              : String(deleteError),
          );
        }
      }
      console.error(
        "Could not save scheduled event:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "The event could not be scheduled. Please try again later.",
        ephemeral: true,
      };
    }
    return {
      content: `Scheduled **${title}** for <t:${Math.floor(result.timestamp / 1000)}:F> in <#${channelId}>.`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default eventCommand;
