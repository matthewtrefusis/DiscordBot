# Discord Bot on Cloudflare Workers

A serverless Discord bot built with TypeScript and Cloudflare Workers, offering anonymous categorized feedback, utility commands, and moderation through Discord's HTTP Interactions API—without a persistent gateway connection.

## Features

- Ed25519 verification of every Discord interaction.
- Slash commands for server details, polls, reminders, categorized anonymous feedback, utilities, and moderation.
- A `GET` health check.
- Runs directly on Cloudflare Workers.

## Commands

| Command | Arguments | Description |
| --- | --- | --- |
| `/help` | None | Lists all available commands. |
| `/hello` | None | Greets you by your Discord display name or username. |
| `/info` | None | Shows the bot status and runtime. |
| `/ping` | None | Checks that the bot is responding and replies with “Pong!”. |
| `/serverinfo` | None | Shows details and approximate counts for this server. |
| `/membercount` | None | Shows this server's approximate member count. |
| `/userinfo` | Optional `user` | Shows a user's name, ID, and bot status. Defaults to you. |
| `/avatar` | Optional `user` | Displays a user's avatar. Defaults to you. |
| `/timestamp` | Required `seconds` | Formats Unix seconds as local and relative Discord timestamps. |
| `/roll` | Optional `min`, `max` | Rolls within a range; defaults to 1–100. |
| `/coinflip` | None | Flips a coin. |
| `/choose` | Required `choices` | Chooses from comma-separated options (up to 25). |
| `/8ball` | Required `question` | Gives a randomized 8-ball answer. |
| `/feedback` | Required `category`, `message` | Sends anonymous, categorized feedback to this server's configured channel. |
| `/setup-feedback` | Required `channel`, comma-separated `categories` (Manage Server) | Set this server's feedback destination and available categories. |
| `/feedback-config` | None (Manage Server) | Shows the configured feedback channel and categories. |
| `/poll` | Required `question`, comma-separated `options` (2–5) | Posts a poll; voters can change their choice. |
| `/remind` | Required `minutes` (1–512,640), `message` | Sends you a private reminder by DM, up to 356 days later. |
| `/kick` | Required `user`, optional `reason` (Kick Members) | Remove a member from the server. |
| `/ban` | Required `user`, optional `reason` (Ban Members) | Ban a member from the server. |
| `/unban` | Required `user_id`, optional `reason` (Ban Members) | Unban a user by Discord ID. |
| `/timeout` | Required `user`, `minutes` (1–40,320), optional `reason` (Moderate Members) | Temporarily prevent a member from chatting, up to 28 days. |
| `/untimeout` | Required `user`, optional `reason` (Moderate Members) | Remove a member's timeout. |
| `/purge` | Required `count` (1–100), optional `reason` (Manage Messages) | Delete recent messages from the current channel. |

Moderation responses are only visible to the moderator who ran the command. The bot needs the corresponding Discord permissions, and its role must be higher than members it moderates. `/purge` also needs View Channel and Read Message History; messages older than 14 days are skipped because Discord does not allow them in bulk deletion.

Feedback is posted by the bot without the submitter's username or ID, and the Worker does not store or log the feedback text. This is anonymous to people reading the feedback channel, not to Discord or Cloudflare; users should avoid including identifying details in their message.

Poll options, vote counts, and voter IDs are stored in Cloudflare KV so voters can change their choice. Reminder text, recipient IDs, and due times are also stored in KV until delivery. A once-per-minute Cron Trigger sends reminders by DM and retries failed deliveries up to five times; users must allow DMs from the bot.

## Requirements

- Node.js 22 or newer and npm.
- A Cloudflare account.
- A Discord application with a bot and slash commands enabled.

## Setup

Install dependencies and check the TypeScript:

```sh
npm ci
npm run typecheck
```

In the [Discord Developer Portal](https://discord.com/developers/applications), create or select your application. Copy its **Application ID**, **Public Key**, and bot token. Keep the bot token private; it is used locally to register commands and as a Worker secret to deliver feedback and moderation actions.

## Register slash commands

Copy `.env.example` to `.env` and fill in the application ID and bot token. Optionally set a guild ID to register commands to one server for faster testing; without it, commands are registered globally.

```sh
npm run register
```

The script registers every command listed above by reading the shared command registry. It bulk-overwrites this application's commands of the selected scope.

## Run locally

Create a private feedback channel and give the bot permission to view the channel and send messages there. Copy `.dev.vars.example` to `.dev.vars`, then fill in the Discord application public key and bot token. The file is git-ignored:

```dotenv
DISCORD_PUBLIC_KEY=your-discord-application-public-key
DISCORD_BOT_TOKEN=your-discord-bot-token
```

Then start the local Worker:

```sh
npm run dev
```

The local URL's `GET /` route is a health check. For Discord to send interactions to a local Worker, expose it through a secure tunnel and configure that public URL as the application's **Interactions Endpoint URL**.

After adding the bot to a server, a member with **Manage Server** permission can run `/setup-feedback channel:#your-private-channel categories:Bug,Suggestion,Other`. The destination and category list are saved per server in Cloudflare KV. `/feedback` offers configured categories as you type; feedback is rejected if its category is no longer configured.

## Deploy

Authenticate Wrangler and save the Discord public key as a Worker secret:

```sh
npx wrangler login
npx wrangler kv namespace create FEEDBACK_CONFIG
```

Replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` with the ID printed by Wrangler. Keep this namespace ID for future deploys so server settings persist. Then set the Worker secrets and deploy:

```sh
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npm run deploy
```

The Worker uses a once-per-minute Cron Trigger for reminders. After deployment, run `/setup-feedback` in each server to select its private feedback channel and categories.

Set the deployed Worker URL as the application's **Interactions Endpoint URL** in the Discord Developer Portal. Discord validates the endpoint with a signed `PING` request.

## Project structure

```text
├── scripts/
│   └── register-commands.mjs  # Register slash commands through Discord's REST API
├── src/
│   ├── commands/
│   │   ├── avatar.ts
│   │   ├── choose.ts
│   │   ├── coinflip.ts
│   │   ├── eightball.ts
│   │   ├── feedback.ts
│   │   ├── feedback-config.ts
│   │   ├── feedback-settings.ts
│   │   ├── guild-info.ts
│   │   ├── hello.ts
│   │   ├── help.ts
│   │   ├── helpers.ts
│   │   ├── info.ts
│   │   ├── index.ts
│   │   ├── membercount.ts
│   │   ├── ping.ts
│   │   ├── poll.ts
│   │   ├── random.ts
│   │   ├── remind.ts
│   │   ├── roll.ts
│   │   ├── setup-feedback.ts
│   │   ├── serverinfo.ts
│   │   ├── timestamp.ts
│   │   ├── userinfo.ts
│   │   └── types.ts
│   ├── index.ts               # Worker routes, verification, command dispatch, Cron Trigger
│   └── reminders.ts           # Scheduled reminder delivery
├── package.json
├── tsconfig.json
└── wrangler.toml
```
