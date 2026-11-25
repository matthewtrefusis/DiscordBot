import { getOption, getUser } from "./helpers";
import { isValidIanaTimeZone } from "../time-utils";
import type { DiscordCommand } from "./types";

const timezoneCommand = {
  name: "timezone",
  description: "Set your timezone for local-time reminders and events.",
  options: [
    {
      type: 3,
      name: "timezone",
      description: "IANA timezone, for example Europe/London or America/New_York.",
      required: true,
      min_length: 1,
      max_length: 100,
    },
  ],
  execute: async ({ env, interaction }) => {
    const user = getUser(interaction);
    const userId = user?.id;
    const timeZone = getOption(interaction, "timezone");
    if (
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId) ||
      !isValidIanaTimeZone(timeZone)
    ) {
      return {
        content: "Provide a valid IANA timezone such as Europe/London.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Timezone settings are temporarily unavailable.",
        ephemeral: true,
      };
    }

    try {
      await env.FEEDBACK_CONFIG.put(`timezone:${userId}`, timeZone);
    } catch (error) {
      console.error(
        "Could not save timezone:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Your timezone could not be saved. Please try again later.",
        ephemeral: true,
      };
    }
    return {
      content: `Your timezone is set to \`${timeZone}\`.`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default timezoneCommand;
