import { canManageServer } from "./permissions";
import type { DiscordCommand } from "./types";

const CONFIG_KEYS = [
  "feedback-settings:",
  "feedback-channel:",
  "report-settings:",
  "stream-settings:",
  "birthday-settings:",
  "self-roles:",
  "suggestion-settings:",
  "ticket-settings:",
] as const;

const settingsExportCommand = {
  name: "settings-export",
  description: "Create a one-time download of this server's bot settings.",
  default_member_permissions: "32",
  execute: async ({ env, interaction, requestUrl }) => {
    const guildId = interaction.guild_id;
    if (!canManageServer(interaction)) {
      return { content: "You need Manage Server permission to export settings.", ephemeral: true };
    }
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return { content: "Settings can only be exported from a server.", ephemeral: true };
    }
    const store = env.FEEDBACK_CONFIG;
    if (!store) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return { content: "Settings export is temporarily unavailable.", ephemeral: true };
    }
    try {
      const settings: Record<string, unknown> = {};
      for (const prefix of CONFIG_KEYS) {
        const key = `${prefix}${guildId}`;
        const value = await store.get(key);
        if (value !== null) settings[key] = value;
      }
      for (const prefix of [`faq:${guildId}:`, `channel-lock:${guildId}:`]) {
        let cursor: string | undefined;
        do {
          const page = await store.list({
            prefix,
            limit: 1000,
            ...(cursor ? { cursor } : {}),
          });
          for (const { name } of page.keys) {
            const value = await store.get(name);
            if (value !== null) settings[name] = value;
          }
          if (page.list_complete) break;
          if (!page.cursor) throw new Error("Cloudflare KV did not return a settings cursor.");
          cursor = page.cursor;
        } while (true);
      }

      const token = crypto.randomUUID();
      await store.put(
        `settings-export:${token}`,
        JSON.stringify({ guildId, exportedAt: new Date().toISOString(), settings }),
        { expirationTtl: 60 },
      );
      const url = new URL(`/exports/${token}`, requestUrl);
      return {
        content: `Download the server settings export within 60 seconds: ${url.toString()}`,
        ephemeral: true,
      };
    } catch (error) {
      console.error("Could not export server settings:", error instanceof Error ? error.message : String(error));
      return { content: "The settings export could not be created.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

export default settingsExportCommand;
