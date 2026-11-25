import { getDisplayName, getUser } from "./helpers";
import type { DiscordCommand } from "./types";

const userinfoCommand = {
  name: "userinfo",
  description: "Show details about yourself or another user.",
  options: [
    {
      type: 6,
      name: "user",
      description: "The user to look up.",
    },
  ],
  execute: ({ interaction }) => {
    const user = getUser(interaction, "user");
    if (!user) {
      return "I couldn't find that user.";
    }

    const userId = typeof user.id === "string" ? user.id : "Unavailable";
    const isBot = user.bot === true ? "Yes" : "No";
    return `**User:** ${getDisplayName(user)}\n**ID:** ${userId}\n**Bot:** ${isBot}`;
  },
} satisfies DiscordCommand;

export default userinfoCommand;
