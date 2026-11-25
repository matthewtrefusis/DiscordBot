import { sendStreamTest } from "./stream-controls";
import type { DiscordCommand } from "./types";

const streamTestCommand = {
  name: "stream-test",
  description: "Send a test message to the stream alert channel.",
  default_member_permissions: "32",
  execute: (context) => sendStreamTest(context),
} satisfies DiscordCommand;

export default streamTestCommand;
