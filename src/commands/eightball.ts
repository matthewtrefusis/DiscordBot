import { getOption } from "./helpers";
import { randomInteger } from "./random";
import type { DiscordCommand } from "./types";

const answers = [
  "It is certain.",
  "Without a doubt.",
  "Yes, definitely.",
  "You can count on it.",
  "The outlook is good.",
  "Signs point to yes.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict that right now.",
  "Focus and ask again.",
  "Don't count on it.",
  "My reply is no.",
  "The outlook is not good.",
  "Very doubtful.",
];

const eightballCommand = {
  name: "8ball",
  description: "Ask the magic 8-ball a question.",
  options: [
    {
      type: 3,
      name: "question",
      description: "Your question for the 8-ball.",
      required: true,
      min_length: 1,
      max_length: 200,
    },
  ],
  execute: ({ interaction }) => {
    const question = getOption(interaction, "question");
    if (typeof question !== "string" || question.trim().length === 0) {
      return "Please provide a question.";
    }
    return `🎱 ${answers[randomInteger(0, answers.length - 1)]}`;
  },
} satisfies DiscordCommand;

export default eightballCommand;
