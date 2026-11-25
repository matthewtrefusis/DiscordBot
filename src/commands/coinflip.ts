import { randomInteger } from "./random";
import type { DiscordCommand } from "./types";

const coinflipCommand = {
  name: "coinflip",
  description: "Flip a coin.",
  execute: () => `🪙 ${randomInteger(0, 1) === 0 ? "Heads" : "Tails"}!`,
} satisfies DiscordCommand;

export default coinflipCommand;
