import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import type { CommandContext, DiscordCommand, InteractionCallback } from "./types";

interface Suggestion {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  authorId: string;
  text: string;
  status: "pending" | "accepted" | "declined";
  votes: Record<string, "up" | "down">;
  createdAt: number;
}

const SUGGESTION_TTL = 365 * 24 * 60 * 60;

function suggestionKey(guildId: string, id: string): string {
  return `suggestion:${guildId}:${id}`;
}

function suggestionPrefix(guildId: string): string {
  return `suggestion:${guildId}:`;
}

function parseSuggestion(value: string): Suggestion | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.id !== "string" ||
    !/^[0-9a-f-]{36}$/.test(parsed.id) ||
    typeof parsed.guildId !== "string" ||
    !/^\d{17,20}$/.test(parsed.guildId) ||
    typeof parsed.channelId !== "string" ||
    !/^\d{17,20}$/.test(parsed.channelId) ||
    typeof parsed.authorId !== "string" ||
    !/^\d{17,20}$/.test(parsed.authorId) ||
    typeof parsed.text !== "string" ||
    parsed.text.length === 0 ||
    parsed.text.length > 1500 ||
    (parsed.status !== "pending" && parsed.status !== "accepted" &&
      parsed.status !== "declined") ||
    !isRecord(parsed.votes) ||
    typeof parsed.createdAt !== "number" ||
    !Number.isFinite(parsed.createdAt) ||
    (parsed.messageId !== undefined &&
      (typeof parsed.messageId !== "string" || !/^\d{17,20}$/.test(parsed.messageId)))
  ) return null;
  const votes: Record<string, "up" | "down"> = {};
  for (const [userId, vote] of Object.entries(parsed.votes)) {
    if (!/^\d{17,20}$/.test(userId) || (vote !== "up" && vote !== "down")) return null;
    votes[userId] = vote;
  }
  return {
    id: parsed.id,
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    ...(typeof parsed.messageId === "string" ? { messageId: parsed.messageId } : {}),
    authorId: parsed.authorId,
    text: parsed.text,
    status: parsed.status,
    votes,
    createdAt: parsed.createdAt,
  };
}

function renderSuggestion(suggestion: Suggestion): {
  content: string;
  components: Record<string, unknown>[];
} {
  const up = Object.values(suggestion.votes).filter((vote) => vote === "up").length;
  const down = Object.values(suggestion.votes).filter((vote) => vote === "down").length;
  return {
    content: [
      `**Suggestion #${suggestion.id.slice(0, 8)}**`,
      suggestion.text,
      `Status: **${suggestion.status}** · 👍 ${up} · 👎 ${down}`,
    ].join("\n\n"),
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: `👍 ${up}`, custom_id: `suggest:${suggestion.id}:up`, disabled: suggestion.status !== "pending" },
        { type: 2, style: 4, label: `👎 ${down}`, custom_id: `suggest:${suggestion.id}:down`, disabled: suggestion.status !== "pending" },
      ],
    }],
  };
}

async function updateVote(context: CommandContext): Promise<InteractionCallback> {
  const { env, interaction } = context;
  const data = interaction.data;
  const customId = isRecord(data) ? data.custom_id : undefined;
  const match = typeof customId === "string"
    ? /^suggest:([0-9a-f-]{36}):(up|down)$/.exec(customId)
    : null;
  const member = isRecord(interaction.member) ? interaction.member : undefined;
  const user = member && isRecord(member.user) ? member.user : interaction.user;
  const userId = isRecord(user) ? user.id : undefined;
  const guildId = interaction.guild_id;
  if (!match || typeof userId !== "string" || !/^\d{17,20}$/.test(userId) ||
      typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
      !env.FEEDBACK_CONFIG) {
    return { type: 4, data: { content: "This suggestion is unavailable.", flags: 64, allowed_mentions: { parse: [] } } };
  }
  try {
    const key = suggestionKey(guildId, match[1]);
    const raw = await env.FEEDBACK_CONFIG.get(key);
    const suggestion = raw ? parseSuggestion(raw) : null;
    if (!suggestion || suggestion.guildId !== guildId ||
        suggestion.channelId !== interaction.channel_id) {
      return { type: 4, data: { content: "This suggestion is unavailable.", flags: 64, allowed_mentions: { parse: [] } } };
    }
    if (suggestion.status !== "pending") {
      return { type: 4, data: { content: "Voting has closed for this suggestion.", flags: 64, allowed_mentions: { parse: [] } } };
    }
    const votes = { ...suggestion.votes };
    if (votes[userId] === match[2]) delete votes[userId];
    else votes[userId] = match[2] as "up" | "down";
    const updated = { ...suggestion, votes };
    await env.FEEDBACK_CONFIG.put(key, JSON.stringify(updated), { expirationTtl: SUGGESTION_TTL });
    return { type: 7, data: { ...renderSuggestion(updated), allowed_mentions: { parse: [] } } };
  } catch (error) {
    console.error("Could not save suggestion vote:", error instanceof Error ? error.message : String(error));
    return { type: 4, data: { content: "Your vote could not be saved.", flags: 64, allowed_mentions: { parse: [] } } };
  }
}

const setupSuggestionsCommand = {
  name: "setup-suggestions",
  description: "Choose the channel for community suggestions.",
  default_member_permissions: "32",
  options: [{ type: 7, name: "channel", description: "Suggestion board channel.", required: true, channel_types: [0, 5] }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const channelId = getOption(interaction, "channel");
    if (!canManageServer(interaction)) return { content: "You need Manage Server permission to configure suggestions.", ephemeral: true };
    const data = interaction.data;
    const resolved = isRecord(data) ? data.resolved : undefined;
    const channels = isRecord(resolved) ? resolved.channels : undefined;
    const channel = typeof channelId === "string" && isRecord(channels) ? channels[channelId] : undefined;
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
        typeof channelId !== "string" || !/^\d{17,20}$/.test(channelId) ||
          !isRecord(channel) || (channel.type !== 0 && channel.type !== 5) ||
          (typeof channel.guild_id === "string" && channel.guild_id !== guildId)) {
      return { content: "Choose a text or announcement channel in this server.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return { content: "Suggestion settings are temporarily unavailable.", ephemeral: true };
    }
    try {
      await env.FEEDBACK_CONFIG.put(`suggestion-settings:${guildId}`, channelId);
      return { content: `Suggestions will be posted to <#${channelId}>.`, ephemeral: true };
    } catch (error) {
      console.error("Could not save suggestion channel:", error instanceof Error ? error.message : String(error));
      return { content: "Could not save the suggestion channel.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const suggestCommand = {
  name: "suggest",
  description: "Submit an idea for the community to vote on.",
  options: [{ type: 3, name: "idea", description: "Your suggestion.", required: true, min_length: 1, max_length: 1500 }],
  component: updateVote,
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const member = isRecord(interaction.member) ? interaction.member : undefined;
    const user = member && isRecord(member.user) ? member.user : interaction.user;
    const userId = isRecord(user) ? user.id : undefined;
    const textValue = getOption(interaction, "idea");
    const text = typeof textValue === "string" ? textValue.trim() : "";
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
        typeof userId !== "string" || !/^\d{17,20}$/.test(userId) ||
        !text || text.length > 1500) {
      return { content: "Suggestions can only be submitted from a server.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG || !env.DISCORD_BOT_TOKEN) {
      console.error("Suggestions are missing their KV binding or bot token.");
      return { content: "Suggestions are temporarily unavailable.", ephemeral: true };
    }
    const store = env.FEEDBACK_CONFIG;
    const botToken = env.DISCORD_BOT_TOKEN;
    try {
      const channelId = await store.get(`suggestion-settings:${guildId}`);
      if (!channelId || !/^\d{17,20}$/.test(channelId)) {
        return { content: "Suggestions are not configured. Ask an admin to run `/setup-suggestions`.", ephemeral: true };
      }
      const suggestion: Suggestion = {
        id: crypto.randomUUID(),
        guildId,
        channelId,
        authorId: userId,
        text,
        status: "pending",
        votes: {},
        createdAt: Date.now(),
      };
      const key = suggestionKey(guildId, suggestion.id);
      await store.put(key, JSON.stringify(suggestion), { expirationTtl: SUGGESTION_TTL });
      return {
        content: "Posting your suggestion…",
        ephemeral: true,
        backgroundTask: (async () => {
          let posted = false;
          try {
            const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
              method: "POST",
              headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ ...renderSuggestion(suggestion), allowed_mentions: { parse: [] } }),
            });
            if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}.`);
            posted = true;
            const message: unknown = await response.json();
            if (!isRecord(message) || typeof message.id !== "string" || !/^\d{17,20}$/.test(message.id)) {
              throw new Error("Discord returned an invalid suggestion message.");
            }
            try {
              await store.put(key, JSON.stringify({ ...suggestion, messageId: message.id }), { expirationTtl: SUGGESTION_TTL });
            } catch (error) {
              console.error("Suggestion posted but its message ID could not be saved:", error instanceof Error ? error.message : String(error));
              return "Your suggestion was posted, but its voting state could not be saved.";
            }
            return "Your suggestion has been posted.";
          } catch (error) {
            console.error("Could not post suggestion:", error instanceof Error ? error.message : String(error));
            if (!posted) {
              try {
                await store.delete(key);
              } catch (deleteError) {
                console.error("Could not remove failed suggestion:", deleteError instanceof Error ? deleteError.message : String(deleteError));
              }
            }
            return "Your suggestion could not be posted. Please try again later.";
          }
        })(),
      };
    } catch (error) {
      console.error("Could not submit suggestion:", error instanceof Error ? error.message : String(error));
      return { content: "Your suggestion could not be submitted. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const suggestionStatusCommand = {
  name: "suggestion-status",
  description: "Accept or decline a community suggestion.",
  default_member_permissions: "32",
  options: [
    { type: 3, name: "id", description: "The eight-character suggestion ID.", required: true, min_length: 8, max_length: 8 },
    { type: 3, name: "status", description: "The new status.", required: true, choices: [{ name: "Accepted", value: "accepted" }, { name: "Declined", value: "declined" }] },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const idValue = getOption(interaction, "id");
    const status = getOption(interaction, "status");
    if (!canManageServer(interaction)) return { content: "You need Manage Server permission to change suggestion status.", ephemeral: true };
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
        typeof idValue !== "string" || !/^[0-9a-f]{8}$/.test(idValue) ||
        !env.FEEDBACK_CONFIG) {
      return { content: "Choose a valid suggestion ID and status.", ephemeral: true };
    }
    if (status !== "accepted" && status !== "declined") {
      return { content: "Choose accepted or declined.", ephemeral: true };
    }
    try {
      let cursor: string | undefined;
      let entry: { name: string } | undefined;
      do {
        const page = await env.FEEDBACK_CONFIG.list({
          prefix: suggestionPrefix(guildId),
          limit: 1000,
          ...(cursor ? { cursor } : {}),
        });
        for (const candidate of page.keys) {
          const value = await env.FEEDBACK_CONFIG.get(candidate.name);
          const suggestion = value ? parseSuggestion(value) : null;
          if (suggestion?.id.startsWith(idValue)) {
            entry = candidate;
            break;
          }
        }
        if (entry || page.list_complete) break;
        if (!page.cursor) throw new Error("Cloudflare KV did not return a suggestion cursor.");
        cursor = page.cursor;
      } while (true);
      if (!entry) return { content: "That suggestion was not found.", ephemeral: true };
      const raw = await env.FEEDBACK_CONFIG.get(entry.name);
      const suggestion = raw ? parseSuggestion(raw) : null;
      if (!suggestion) return { content: "That suggestion is no longer available.", ephemeral: true };
      const newStatus: "accepted" | "declined" = status;
      const updated = { ...suggestion, status: newStatus };
      await env.FEEDBACK_CONFIG.put(entry.name, JSON.stringify(updated), { expirationTtl: SUGGESTION_TTL });
      if (suggestion.messageId && env.DISCORD_BOT_TOKEN) {
        const response = await fetch(`https://discord.com/api/v10/channels/${suggestion.channelId}/messages/${suggestion.messageId}`, {
          method: "PATCH",
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...renderSuggestion(updated), allowed_mentions: { parse: [] } }),
        });
        if (!response.ok) {
          console.error(`Could not update suggestion post (HTTP ${response.status}).`);
          return { content: `Saved the status, but the public suggestion post could not be updated (HTTP ${response.status}).`, ephemeral: true };
        }
      }
      return { content: `Suggestion #${idValue} is now **${status}**.`, ephemeral: true };
    } catch (error) {
      console.error("Could not update suggestion status:", error instanceof Error ? error.message : String(error));
      return { content: "The suggestion status could not be updated.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

export { setupSuggestionsCommand, suggestCommand, suggestionStatusCommand };
