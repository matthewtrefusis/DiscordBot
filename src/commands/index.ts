import avatarCommand from "./avatar";
import chooseCommand from "./choose";
import coinflipCommand from "./coinflip";
import eightballCommand from "./eightball";
import helloCommand from "./hello";
import helpCommand from "./help";
import infoCommand from "./info";
import pingCommand from "./ping";
import rollCommand from "./roll";
import timestampCommand from "./timestamp";
import userinfoCommand from "./userinfo";

export const commands = [
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
];

export const commandsByName = new Map(
  commands.map((command) => [command.name, command]),
);
