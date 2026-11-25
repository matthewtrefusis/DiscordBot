import { getOption, isRecord } from "./helpers";
import { listGuildEvents } from "../events";
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

const eventAttendeesCommand = {
  name: "event-attendees",
  description: "Show the RSVP list for a scheduled event.",
  options: [
    {
      type: 3,
      name: "event",
      description: "The event whose attendees to list.",
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
          event.title.toLowerCase().includes(query)
        )
        .slice(0, 25)
        .map(({ key, event }) => ({
          name: event.title.slice(0, 100),
          value: key.slice(key.lastIndexOf(":") + 1),
        }));
    } catch (error) {
      console.error(
        "Could not load events for attendee list:",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const eventId = getOption(interaction, "event");
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof eventId !== "string" ||
      !env.FEEDBACK_CONFIG
    ) {
      return {
        content: "Choose an event in this server.",
        ephemeral: true,
      };
    }
    try {
      const event = (await listGuildEvents(env.FEEDBACK_CONFIG, guildId))
        .find(({ key }) =>
          key === `event:${guildId}:${eventId}`
        )?.event;
      if (!event) {
        return {
          content: "That event is unavailable.",
          ephemeral: true,
        };
      }
      const attendees = event.participants.slice(0, 30)
        .map((userId) => `<@${userId}>`);
      const additional = event.participants.length - attendees.length;
      return {
        content: attendees.length
          ? `**Attending ${event.title} (${event.participants.length}):**\n${attendees.join("\n")}${additional > 0 ? `\n…and ${additional} more.` : ""}`
          : `No one has RSVP’d to **${event.title}** yet.`,
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not read event attendees:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not load event attendees. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default eventAttendeesCommand;
