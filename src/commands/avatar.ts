import { getDisplayName, getUser } from "./helpers";
import type { DiscordCommand } from "./types";

const avatarCommand = {
  name: "avatar",
  description: "Show your avatar or another user's avatar.",
  options: [
    {
      type: 6,
      name: "user",
      description: "The user whose avatar you want to see.",
    },
  ],
  execute: ({ interaction }) => {
    const user = getUser(interaction, "user");
    if (!user || typeof user.id !== "string") {
      return "I couldn't find that user's avatar.";
    }

    const avatarHash = user.avatar;
    const avatarUrl = typeof avatarHash === "string"
      ? `https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}.${avatarHash.startsWith("a_") ? "gif" : "png"}?size=1024`
      : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;

    return `**${getDisplayName(user)}'s avatar:** ${avatarUrl}`;
  },
} satisfies DiscordCommand;

export default avatarCommand;
