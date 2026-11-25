import { commands } from "../src/commands/index.ts";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !botToken) {
  console.error(
    "Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN before registering commands.",
  );
  process.exitCode = 1;
} else {
  const commandDefinitions = commands.map(({ execute, ...definition }) => definition);
  const commandScope = guildId
    ? `guilds/${encodeURIComponent(guildId)}/`
    : "";
  const endpoint = `https://discord.com/api/v10/applications/${encodeURIComponent(applicationId)}/${commandScope}commands`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandDefinitions),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Discord command registration failed (${response.status}): ${details}`,
    );
  }

  console.log(
    `Registered ${commandDefinitions.length} application commands${guildId ? " for the selected guild" : " globally"}.`,
  );
}
