import { getOption } from "./helpers";
import type { DiscordCommand } from "./types";

const timestampCommand = {
  name: "timestamp",
  description: "Convert Unix seconds into Discord timestamps.",
  options: [
    {
      type: 4,
      name: "seconds",
      description: "Unix timestamp in seconds.",
      required: true,
      min_value: 0,
      max_value: 4_102_444_800,
    },
  ],
  execute: ({ interaction }) => {
    const seconds = getOption(interaction, "seconds");
    if (!Number.isSafeInteger(seconds) || typeof seconds !== "number") {
      return "Enter a valid Unix timestamp in seconds.";
    }
    return `**Local time:** <t:${seconds}:F>\n**Relative:** <t:${seconds}:R>`;
  },
} satisfies DiscordCommand;

export default timestampCommand;
