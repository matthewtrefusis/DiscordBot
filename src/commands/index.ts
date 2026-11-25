import avatarCommand from "./avatar";
import banCommand from "./ban";
import chooseCommand from "./choose";
import coinflipCommand from "./coinflip";
import eightballCommand from "./eightball";
import feedbackCommand from "./feedback";
import feedbackConfigCommand from "./feedback-config";
import feedbackStatsCommand from "./feedback-stats";
import helloCommand from "./hello";
import helpCommand from "./help";
import infoCommand from "./info";
import eventCommand from "./event";
import eventCancelCommand from "./event-cancel";
import eventsListCommand from "./events-list";
import kickCommand from "./kick";
import membercountCommand from "./membercount";
import pingCommand from "./ping";
import pollCommand from "./poll";
import pollCloseCommand from "./poll-close";
import pollResultsCommand from "./poll-results";
import purgeCommand from "./purge";
import remindCommand from "./remind";
import remindAtCommand from "./remind-at";
import reportCommand from "./report";
import rollCommand from "./roll";
import serverinfoCommand from "./serverinfo";
import setupFeedbackCommand from "./setup-feedback";
import setupReportsCommand from "./setup-reports";
import setupStreamAlertsCommand from "./setup-stream-alerts";
import streamAddCommand from "./stream-add";
import streamListCommand from "./stream-list";
import streamRemoveCommand from "./stream-remove";
import streamPauseCommand from "./stream-pause";
import streamResumeCommand from "./stream-resume";
import streamTestCommand from "./stream-test";
import timezoneCommand from "./timezone";
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
  feedbackConfigCommand,
  feedbackStatsCommand,
  reportCommand,
  setupReportsCommand,
  setupFeedbackCommand,
  serverinfoCommand,
  membercountCommand,
  pollCommand,
  pollCloseCommand,
  pollResultsCommand,
  remindCommand,
  remindAtCommand,
  timezoneCommand,
  eventCommand,
  eventsListCommand,
  eventCancelCommand,
  setupStreamAlertsCommand,
  streamAddCommand,
  streamRemoveCommand,
  streamListCommand,
  streamTestCommand,
  streamPauseCommand,
  streamResumeCommand,
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
