import { listGuildEvents } from "../events";
import type { DiscordCommand } from "./types";

const eventsListCommand = {
  name: "events",
  description: "List upcoming scheduled announcements in this server.",
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return {
        content: "Upcoming events can only be listed in a server.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Events are temporarily unavailable.",
        ephemeral: true,
      };
    }

    try {
      const now = Date.now();
      const events = (await listGuildEvents(env.FEEDBACK_CONFIG, guildId))
        .filter(({ event }) => event.startsAt > now)
        .sort((left, right) => left.event.startsAt - right.event.startsAt)
        .slice(0, 8);
      if (events.length === 0) {
        return { content: "There are no upcoming scheduled events." };
      }
      return {
        content: events
          .map(({ event }) =>
            `• **${event.title}** — <t:${Math.floor(event.startsAt / 1000)}:F> in <#${event.channelId}>`
          )
          .join("\n"),
      };
    } catch (error) {
      console.error(
        "Could not list scheduled events:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not load upcoming events. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default eventsListCommand;
