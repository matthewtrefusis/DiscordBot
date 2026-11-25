import { setStreamSourcePaused } from "./stream-controls";
import type { DiscordCommand } from "./types";

const streamPauseCommand = {
  name: "stream-pause",
  description: "Pause alerts for a configured channel.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "channel_url",
      description: "The configured YouTube or Twitch channel URL.",
      required: true,
      min_length: 10,
      max_length: 200,
    },
  ],
  execute: (context) => setStreamSourcePaused(context, true),
} satisfies DiscordCommand;

export default streamPauseCommand;
