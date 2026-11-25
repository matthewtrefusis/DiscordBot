import avatarCommand from "./avatar";
import banCommand from "./ban";
import chooseCommand from "./choose";
import coinflipCommand from "./coinflip";
import eightballCommand from "./eightball";
import feedbackCommand from "./feedback";
import helloCommand from "./hello";
import helpCommand from "./help";
import infoCommand from "./info";
import kickCommand from "./kick";
import pingCommand from "./ping";
import purgeCommand from "./purge";
import rollCommand from "./roll";
import setupFeedbackCommand from "./setup-feedback";
import timestampCommand from "./timestamp";
import timeoutCommand from "./timeout";
import unbanCommand from "./unban";
import untimeoutCommand from "./untimeout";
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
  kickCommand,
  banCommand,
  unbanCommand,
  timeoutCommand,
  untimeoutCommand,
  purgeCommand,
];

export const commandsByName = new Map(
  commands.map((command) => [command.name, command]),
);
