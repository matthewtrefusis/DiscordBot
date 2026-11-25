import { getOption, isRecord } from "./helpers";
import { eventDueKey, listGuildEvents } from "../events";
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

const eventCancelCommand = {
  name: "event-cancel",
  description: "Cancel a scheduled event in this server.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "event",
      description: "The event to cancel.",
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
      return (await listGuildEvents(env.FEEDBACK_CONFIG, guildId))
        .filter(({ event }) =>
          event.startsAt > Date.now() &&
          event.title.toLowerCase().includes(query)
        )
        .slice(0, 25)
        .map(({ key, event }) => ({
          name: `${event.title.slice(0, 70)} · ${new Date(event.startsAt).toISOString().slice(0, 16)}`,
          value: key.slice(key.lastIndexOf(":") + 1),
        }));
    } catch (error) {
      console.error(
        "Could not load events for cancellation:",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const eventId = getOption(interaction, "event");
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return {
        content: "This command can only be used in a server.",
        ephemeral: true,
      };
    }
    if (!canManageServer(interaction)) {
      return {
        content: "You need Manage Server permission to cancel events.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG || typeof eventId !== "string") {
      return {
        content: "Choose an upcoming event to cancel.",
        ephemeral: true,
      };
    }

    const key = `event:${guildId}:${eventId}`;
    try {
      const events = await listGuildEvents(env.FEEDBACK_CONFIG, guildId);
      const scheduledEvent = events.find((item) => item.key === key);
      if (!scheduledEvent || scheduledEvent.event.startsAt <= Date.now()) {
        return {
          content: "That event has already started or was cancelled.",
          ephemeral: true,
        };
      }
      await env.FEEDBACK_CONFIG.delete(key);
      try {
        await env.FEEDBACK_CONFIG.delete(
          eventDueKey(
            scheduledEvent.event.startsAt,
            scheduledEvent.event.guildId,
            eventId,
          ),
        );
      } catch (error) {
        console.error(
          "Event was cancelled but its due index could not be removed:",
          error instanceof Error ? error.message : String(error),
        );
      }
      return {
        content: `Cancelled **${scheduledEvent.event.title}**.`,
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not cancel scheduled event:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "The event could not be cancelled. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default eventCancelCommand;
