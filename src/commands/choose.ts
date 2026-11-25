import { getOption } from "./helpers";
import { randomInteger } from "./random";
import type { DiscordCommand } from "./types";

const chooseCommand = {
  name: "choose",
  description: "Randomly choose from a comma-separated list.",
  options: [
    {
      type: 3,
      name: "choices",
      description: "Enter at least two choices separated by commas.",
      required: true,
      min_length: 3,
      max_length: 1000,
    },
  ],
  execute: ({ interaction }) => {
    const value = getOption(interaction, "choices");
    const choices = typeof value === "string"
      ? value.split(",").map((choice) => choice.trim()).filter(Boolean)
      : [];

    if (choices.length < 2) {
      return "Enter at least two comma-separated choices.";
    }
    if (choices.length > 25) {
      return "Please provide no more than 25 choices.";
    }
    return `I choose: **${choices[randomInteger(0, choices.length - 1)]}**`;
  },
} satisfies DiscordCommand;

export default chooseCommand;
