import { commandsByName } from "./commands/index";
import type {
  AutocompleteChoice,
  CommandContext,
  CommandEnvironment,
  InteractionCallback,
  WorkerExecutionContext,
} from "./commands/types";
import { processDueReminders } from "./reminders";
import { processDueEvents } from "./events";
import { processLiveStreamAlerts } from "./streams";
import { processDuePollReminders } from "./poll-reminders";
import { processBirthdays } from "./birthdays";
import { processDueGiveaways } from "./giveaways";

export interface Env extends CommandEnvironment {
  DISCORD_PUBLIC_KEY: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hexToBytes(
  hex: string,
  byteLength: number,
): Uint8Array<ArrayBuffer> | null {
  if (
    hex.length !== byteLength * 2 ||
    !/^[0-9a-f]+$/i.test(hex)
  ) {
    return null;
  }

  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  for (let i = 0; i < byteLength; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifyDiscordRequest(
  request: Request,
  body: string,
  publicKeyHex: string,
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) {
    return false;
  }

  const publicKey = hexToBytes(publicKeyHex, 32);
  const signatureBytes = hexToBytes(signature, 64);
  if (!publicKey || !signatureBytes) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signatureBytes,
    new TextEncoder().encode(timestamp + body),
  );
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function interactionResponse(content: string, ephemeral = false): Response {
  return jsonResponse({
    type: 4,
    data: {
      content,
      allowed_mentions: { parse: [] },
      ...(ephemeral ? { flags: 64 } : {}),
    },
  });
}

function deferredResponse(): Response {
  return jsonResponse({ type: 5, data: { flags: 64 } });
}

function autocompleteResponse(choices: AutocompleteChoice[]): Response {
  return jsonResponse({ type: 8, data: { choices } });
}

function componentResponse(response: InteractionCallback): Response {
  return jsonResponse(response);
}

async function sendInteractionFollowup(
  interaction: JsonRecord,
  content: string,
): Promise<void> {
  const applicationId = interaction.application_id;
  const token = interaction.token;
  if (typeof applicationId !== "string" || typeof token !== "string") {
    throw new Error("Interaction is missing follow-up credentials.");
  }

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        flags: 64,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Interaction follow-up failed with HTTP ${response.status}.`);
  }
}

function getUsername(interaction: JsonRecord): string {
  const member = interaction.member;
  const memberUser = isRecord(member) ? member.user : undefined;
  const user = isRecord(memberUser)
    ? memberUser
    : isRecord(interaction.user)
      ? interaction.user
      : undefined;

  if (typeof user?.global_name === "string" && user.global_name.length > 0) {
    return user.global_name;
  }
  if (typeof user?.username === "string" && user.username.length > 0) {
    return user.username;
  }
  return "there";
}

export default {
  async fetch(
    request: Request,
    env: Env,
    executionContext: WorkerExecutionContext,
  ): Promise<Response> {
    if (request.method === "GET") {
      const exportMatch = /^\/exports\/([0-9a-f-]{36})$/
        .exec(new URL(request.url).pathname);
      if (exportMatch && env.FEEDBACK_CONFIG) {
        const key = `settings-export:${exportMatch[1]}`;
        const rawExport = await env.FEEDBACK_CONFIG.get(key);
        if (!rawExport) {
          return new Response("This export link has expired.", { status: 404 });
        }
        let exportData: unknown;
        try {
          exportData = JSON.parse(rawExport);
        } catch (error) {
          if (error instanceof SyntaxError) {
            console.error("Stored settings export is invalid JSON.");
            return new Response("This export is unavailable.", { status: 500 });
          }
          throw error;
        }
        if (
          !isRecord(exportData) ||
          typeof exportData.guildId !== "string" ||
          !/^\d{17,20}$/.test(exportData.guildId) ||
          typeof exportData.exportedAt !== "string" ||
          !isRecord(exportData.settings) ||
          Object.keys(exportData.settings).length > 10000 ||
          !Object.values(exportData.settings).every(
            (value) => typeof value === "string",
          )
        ) {
          console.error("Stored settings export has an invalid format.");
          return new Response("This export is unavailable.", { status: 500 });
        }
        try {
          await env.FEEDBACK_CONFIG.delete(key);
        } catch (error) {
          console.error(
            "Could not delete downloaded settings export:",
            error instanceof Error ? error.message : String(error),
          );
          return new Response("This export could not be consumed. Please create a new export link.", {
            status: 500,
            headers: { "Cache-Control": "no-store" },
          });
        }
        return new Response(JSON.stringify(exportData, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="discordbot-settings.json"',
            "Cache-Control": "no-store",
          },
        });
      }
      return jsonResponse({ status: "ok", service: "discord-bot" });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    }

    const body = await request.text();
    if (!env.DISCORD_PUBLIC_KEY) {
      console.error("DISCORD_PUBLIC_KEY is not configured.");
      return jsonResponse({ error: "Bot is not configured." }, 500);
    }

    if (!(await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY))) {
      return jsonResponse({ error: "Invalid request signature." }, 401);
    }

    let interaction: unknown;
    try {
      interaction = JSON.parse(body);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid JSON body." }, 400);
      }
      throw error;
    }
    if (!isRecord(interaction)) {
      return jsonResponse({ error: "Invalid interaction payload." }, 400);
    }

    if (interaction.type === 1) {
      return jsonResponse({ type: 1 });
    }

    if (interaction.type === 3) {
      const data = interaction.data;
      const customId = isRecord(data) ? data.custom_id : undefined;
      const commandName = typeof customId === "string"
        ? customId.split(":", 1)[0]
        : "";
      const command = commandsByName.get(commandName);
      if (!command?.component) {
        return componentResponse({
          type: 4,
          data: {
            content: "This interaction is not supported.",
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        });
      }
      const context: CommandContext = {
        env,
        interaction,
        username: getUsername(interaction),
        requestUrl: request.url,
      };
      return componentResponse(await command.component(context));
    }

    if (interaction.type !== 2 && interaction.type !== 4) {
      return jsonResponse({ error: "Unsupported interaction type." }, 400);
    }

    const data = interaction.data;
    if (!isRecord(data) || typeof data.name !== "string") {
      return jsonResponse({ error: "Invalid application command." }, 400);
    }

    const command = commandsByName.get(data.name);
    if (!command) {
      if (interaction.type === 4) {
        return autocompleteResponse([]);
      }
      return interactionResponse(`Unknown command: ${data.name}`);
    }
    const context: CommandContext = {
      env,
      interaction,
      username: getUsername(interaction),
      requestUrl: request.url,
    };
    if (interaction.type === 4) {
      if (!command.autocomplete) {
        return autocompleteResponse([]);
      }
      return autocompleteResponse(await command.autocomplete(context));
    }

    const result = await command.execute(context);
    if (typeof result === "string") {
      return interactionResponse(result);
    }

    if (result.backgroundTask) {
      const task = result.backgroundTask
        .then((content) => sendInteractionFollowup(interaction, content))
        .catch((error: unknown) => {
          console.error(
            "Deferred command failed:",
            error instanceof Error ? error.message : String(error),
          );
          return sendInteractionFollowup(
            interaction,
            "Your request could not be completed. Please try again later.",
          );
        });
      executionContext.waitUntil(task);
      return deferredResponse();
    }

    return interactionResponse(result.content, result.ephemeral);
  },
  async scheduled(
    controller: { scheduledTime: number },
    env: Env,
    executionContext: WorkerExecutionContext,
  ): Promise<void> {
    const reminderTask = processDueReminders(env, controller.scheduledTime).catch(
      (error: unknown) => {
        console.error(
          "Scheduled reminder processing failed:",
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    const streamTask = processLiveStreamAlerts(
      env,
      controller.scheduledTime,
    ).catch((error: unknown) => {
      console.error(
        "Scheduled stream alert processing failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
    const eventTask = processDueEvents(env, controller.scheduledTime).catch(
      (error: unknown) => {
        console.error(
          "Scheduled event processing failed:",
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    const pollReminderTask = processDuePollReminders(
      env,
      controller.scheduledTime,
    ).catch((error: unknown) => {
      console.error(
        "Scheduled poll reminder processing failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
    const birthdayTask = processBirthdays(env, controller.scheduledTime).catch(
      (error: unknown) => {
        console.error(
          "Scheduled birthday processing failed:",
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    const giveawayTask = processDueGiveaways(env, controller.scheduledTime)
      .catch((error: unknown) => {
        console.error(
          "Scheduled giveaway processing failed:",
          error instanceof Error ? error.message : String(error),
        );
      });
    executionContext.waitUntil(
      Promise.all([
        reminderTask,
        streamTask,
        eventTask,
        pollReminderTask,
        birthdayTask,
        giveawayTask,
      ]),
    );
  },
};
