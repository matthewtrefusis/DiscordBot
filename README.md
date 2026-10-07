# ⚡ Java Wasm Discord Bot on Cloudflare Workers

A lightweight, high-performance Discord bot written in **Java 17**, compiled directly to **WebAssembly (Wasm)** via **TeaVM**, and deployed globally on **Cloudflare Workers** using the HTTP Interactions API.

---

## ✨ Features

- **Java on the Edge:** Write bot logic in pure Java while running on Cloudflare's serverless V8 edge isolates.
- **WebAssembly Powered:** Compiled using TeaVM for low-latency cold starts and fast execution.
- **Serverless & Cost-Effective:** Operates strictly on Discord's HTTP Interactions API (no 24/7 WebSockets or paid VPS required).
- **Secure:** Built-in Ed25519 cryptographic signature verification using the Web Crypto API.

---

## 🛠️ Tech Stack

- **Language:** Java 17
- **Compiler:** TeaVM (Java Bytecode ➔ WebAssembly)
- **Runtime / Hosting:** Cloudflare Workers (TypeScript / Edge Runtime)
- **Build System:** Maven
- **Deployment:** Wrangler CLI

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) & [npm](https://www.npmjs.com/)
- [Java 17 SDK](https://adoptium.net/)
- [Apache Maven](https://maven.apache.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 2. Build the WebAssembly Binary
Compile your Java code into `.wasm` artifacts. The npm script selects the installed Java 17 JDK on Windows:
```bash
npm run build:java
```

The bot currently provides `/ping`, `/hello`, and `/info`.

### 3. Configure Secrets
Set your Discord Application Public Key in Cloudflare Secrets:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
```

### 4. Deploy to Cloudflare
Build and deploy the worker, then register its slash commands:

```bash
npm run deploy
```

### 5. Register Slash Commands
If you deploy with `npm run deploy`, registration is already included. To register separately, update the local, git-ignored `register.js` with your App ID and Bot Token, then run:

```bash
node register.js
```

### 📁 Project Structure
```text
├── src/
│   ├── main/java/com/matthewtrefusis/
│   │   └── DiscordWorker.java     # Core Java bot logic & @Export endpoints
│   ├── index.ts                   # TypeScript edge worker & Ed25519 verification
│   ├── wasm.d.ts                  # Wasm module declarations
├── package.json                   # Build, deploy, and registration scripts
├── tsconfig.json                  # TypeScript project configuration
├── dist/                          # Compiled Wasm build output
├── pom.xml                        # Maven & TeaVM plugin configuration
├── wrangler.toml                  # Cloudflare Workers configuration
└── register.js                    # Discord REST API command registration
```
