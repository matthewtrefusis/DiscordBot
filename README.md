# Discord Bot on Cloudflare Workers

A serverless Discord bot built with TypeScript and Cloudflare Workers. It uses Discord's HTTP Interactions API, so it does not need a continuously running process or a gateway connection.

## Features

- Ed25519 verification of every Discord interaction.
- Slash commands for help, user profiles, timestamps, and fun utilities.
- A `GET` health check.
- Runs directly on Cloudflare Workers with no Java, Maven, or WebAssembly build.

## Commands

| Command | Arguments | Description |
| --- | --- | --- |
| `/help` | None | Lists all available commands. |
| `/hello` | None | Greets you by your Discord display name or username. |
| `/info` | None | Shows the bot status and runtime. |
| `/ping` | None | Checks that the bot is responding and replies with “Pong!”. |
| `/userinfo` | Optional `user` | Shows a user's name, ID, and bot status. Defaults to you. |
| `/avatar` | Optional `user` | Displays a user's avatar. Defaults to you. |
| `/timestamp` | Required `seconds` | Formats Unix seconds as local and relative Discord timestamps. |
| `/roll` | Optional `min`, `max` | Rolls within a range; defaults to 1–100. |
| `/coinflip` | None | Flips a coin. |
| `/choose` | Required `choices` | Chooses from comma-separated options (up to 25). |
| `/8ball` | Required `question` | Gives a randomized 8-ball answer. |

This starter set focuses on stateless utility and fun commands; moderation and reminders are not included.

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

In the [Discord Developer Portal](https://discord.com/developers/applications), create or select your application. Copy its **Application ID**, **Public Key**, and bot token. Keep the bot token private; it is only needed by the local slash-command registration script.

## Register slash commands

Copy `.env.example` to `.env` and fill in the application ID and bot token. Optionally set a guild ID to register commands to one server for faster testing; without it, commands are registered globally.

```sh
npm run register
```

The script registers every command listed above by reading the shared command registry. It bulk-overwrites this application's commands of the selected scope.

## Run locally

Copy `.dev.vars.example` to `.dev.vars` and add your Discord application public key. The file is git-ignored:

```dotenv
DISCORD_PUBLIC_KEY=your-discord-application-public-key
```

Then start the local Worker:

```sh
npm run dev
```

The local URL's `GET /` route is a health check. For Discord to send interactions to a local Worker, expose it through a secure tunnel and configure that public URL as the application's **Interactions Endpoint URL**.

## Deploy

Authenticate Wrangler and save the Discord public key as a Worker secret:

```sh
npx wrangler login
npx wrangler secret put DISCORD_PUBLIC_KEY
npm run deploy
```

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
│   │   ├── hello.ts
│   │   ├── help.ts
│   │   ├── helpers.ts
│   │   ├── info.ts
│   │   ├── index.ts
│   │   ├── ping.ts
│   │   ├── random.ts
│   │   ├── roll.ts
│   │   ├── timestamp.ts
│   │   ├── userinfo.ts
│   │   └── types.ts
│   └── index.ts               # Worker routes, signature verification, command dispatch
├── package.json
├── tsconfig.json
└── wrangler.toml
```
