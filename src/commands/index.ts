import avatarCommand from "./avatar";
import chooseCommand from "./choose";
import coinflipCommand from "./coinflip";
import eightballCommand from "./eightball";
import feedbackCommand from "./feedback";
import helloCommand from "./hello";
import helpCommand from "./help";
import infoCommand from "./info";
import pingCommand from "./ping";
import rollCommand from "./roll";
import setupFeedbackCommand from "./setup-feedback";
import timestampCommand from "./timestamp";
import userinfoCommand from "./userinfo";
import type { DiscordCommand } from "./types";

export const commands: DiscordCommand[] = [
  helpCommand,
  helloCommand,
  infoCommand,
  pingCommand,
  userinfoCommand,
  avatarCommand,
  timestampCommand,
  rollCommand,
  coinflipCommand,
  chooseCommand,
  eightballCommand,
  feedbackCommand,
  setupFeedbackCommand,
];

export const commandsByName = new Map(
  commands.map((command) => [command.name, command]),
);
