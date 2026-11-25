import { getOption } from "./helpers";
import { randomInteger } from "./random";
import type { DiscordCommand } from "./types";

const rollCommand = {
  name: "roll",
  description: "Roll a number in the selected range (defaults to 1-100).",
  options: [
    {
      type: 4,
      name: "min",
      description: "The lowest possible result.",
      min_value: -1_000_000,
      max_value: 1_000_000,
    },
    {
      type: 4,
      name: "max",
      description: "The highest possible result.",
      min_value: -1_000_000,
      max_value: 1_000_000,
    },
  ],
  execute: ({ interaction }) => {
    const minOption = getOption(interaction, "min");
    const maxOption = getOption(interaction, "max");
    const minimum = typeof minOption === "number" ? minOption : 1;
    const maximum = typeof maxOption === "number" ? maxOption : 100;

    if (minimum > maximum) {
      return "The minimum must not be greater than the maximum.";
    }
    return `🎲 You rolled **${randomInteger(minimum, maximum)}** (${minimum}–${maximum}).`;
  },
} satisfies DiscordCommand;

export default rollCommand;
