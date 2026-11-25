import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import type { CommandContext, DiscordCommand, InteractionCallback } from "./types";

const TICKET_TTL = 30 * 24 * 60 * 60;
const VIEW_CHANNEL = 1024n;
const SEND_MESSAGES = 2048n;
const READ_HISTORY = 65536n;
const BOT_ACCESS = (VIEW_CHANNEL | SEND_MESSAGES | READ_HISTORY | 16n).toString();
const OWNER_ACCESS = (VIEW_CHANNEL | SEND_MESSAGES | READ_HISTORY).toString();

interface Ticket {
  guildId: string;
  channelId: string;
  ownerId: string;
  closed: boolean;
}

interface TicketOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

function ticketKey(guildId: string, channelId: string): string {
  return `ticket:${guildId}:${channelId}`;
}

function parseTicket(value: string): Ticket | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(parsed) ||
      typeof parsed.guildId !== "string" || !/^\d{17,20}$/.test(parsed.guildId) ||
      typeof parsed.channelId !== "string" || !/^\d{17,20}$/.test(parsed.channelId) ||
      typeof parsed.ownerId !== "string" || !/^\d{17,20}$/.test(parsed.ownerId) ||
      typeof parsed.closed !== "boolean") return null;
  return {
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    ownerId: parsed.ownerId,
    closed: parsed.closed,
  };
}

function getTicketOverwrites(value: unknown): TicketOverwrite[] | null {
  if (!Array.isArray(value)) return null;
  const overwrites: TicketOverwrite[] = [];
  for (const overwrite of value) {
    if (
      !isRecord(overwrite) ||
      typeof overwrite.id !== "string" ||
      !/^\d{17,20}$/.test(overwrite.id) ||
      (overwrite.type !== 0 && overwrite.type !== 1) ||
      typeof overwrite.allow !== "string" ||
      !/^\d+$/.test(overwrite.allow) ||
      typeof overwrite.deny !== "string" ||
      !/^\d+$/.test(overwrite.deny)
    ) return null;
    overwrites.push({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow,
      deny: overwrite.deny,
    });
  }
  return overwrites;
}

async function findOpenTicket(
  store: NonNullable<CommandContext["env"]["FEEDBACK_CONFIG"]>,
  guildId: string,
  ownerId: string,
): Promise<Ticket | null> {
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: `ticket:${guildId}:`,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const { name } of page.keys) {
      const raw = await store.get(name);
      const ticket = raw ? parseTicket(raw) : null;
      if (ticket?.ownerId === ownerId && !ticket.closed) return ticket;
      if (raw && !ticket) console.error(`Ignoring malformed ticket record ${name}.`);
    }
    if (page.list_complete) return null;
    if (!page.cursor) throw new Error("Cloudflare KV did not return a ticket cursor.");
    cursor = page.cursor;
  } while (true);
}

async function closeTicket(context: CommandContext): Promise<InteractionCallback> {
  const { env, interaction } = context;
  const data = interaction.data;
  const customId = isRecord(data) ? data.custom_id : undefined;
  const match = typeof customId === "string"
    ? /^ticket:(\d{17,20}):(\d{17,20}):close$/.exec(customId)
    : null;
  const member = isRecord(interaction.member) ? interaction.member : undefined;
  const user = member && isRecord(member.user) ? member.user : interaction.user;
  const userId = isRecord(user) ? user.id : undefined;
  if (!match || typeof userId !== "string" || !/^\d{17,20}$/.test(userId) ||
      interaction.guild_id !== match[1] || interaction.channel_id !== match[2] ||
      !env.FEEDBACK_CONFIG || !env.DISCORD_BOT_TOKEN) {
    return { type: 4, data: { content: "This ticket is unavailable.", flags: 64, allowed_mentions: { parse: [] } } };
  }
  try {
    const key = ticketKey(match[1], match[2]);
    const raw = await env.FEEDBACK_CONFIG.get(key);
    const ticket = raw ? parseTicket(raw) : null;
    if (!ticket || ticket.closed) {
      return { type: 4, data: { content: "This ticket is already closed or unavailable.", flags: 64, allowed_mentions: { parse: [] } } };
    }
    if (ticket.ownerId !== userId && !canManageServer(interaction)) {
      return { type: 4, data: { content: "Only the ticket creator or a server manager can close it.", flags: 64, allowed_mentions: { parse: [] } } };
    }
    const response = await fetch(
      `https://discord.com/api/v10/channels/${match[2]}/permissions/${ticket.ownerId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: 1, allow: (VIEW_CHANNEL | READ_HISTORY).toString(), deny: SEND_MESSAGES.toString() }),
      },
    );
    if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}.`);
    await env.FEEDBACK_CONFIG.put(key, JSON.stringify({ ...ticket, closed: true }), { expirationTtl: TICKET_TTL });
    return {
      type: 7,
      data: {
        content: "🔒 This ticket is closed. The creator can still view the conversation.",
        components: [{ type: 1, components: [{ type: 2, style: 2, label: "Closed", custom_id: `ticket:${match[1]}:${match[2]}:close`, disabled: true }] }],
        allowed_mentions: { parse: [] },
      },
    };
  } catch (error) {
    console.error("Could not close ticket:", error instanceof Error ? error.message : String(error));
    return { type: 4, data: { content: "The ticket could not be closed. Please try again.", flags: 64, allowed_mentions: { parse: [] } } };
  }
}

const setupTicketsCommand = {
  name: "setup-tickets",
  description: "Choose the category for private support tickets.",
  default_member_permissions: "32",
  options: [{ type: 7, name: "category", description: "The category new tickets will be created in.", required: true, channel_types: [4] }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const categoryId = getOption(interaction, "category");
    if (!canManageServer(interaction)) return { content: "You need Manage Server permission to configure tickets.", ephemeral: true };
    const data = interaction.data;
    const resolved = isRecord(data) ? data.resolved : undefined;
    const channels = isRecord(resolved) ? resolved.channels : undefined;
    const category = typeof categoryId === "string" && isRecord(channels) ? channels[categoryId] : undefined;
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
        typeof categoryId !== "string" || !/^\d{17,20}$/.test(categoryId) ||
        !isRecord(category) || category.type !== 4 ||
        (typeof category.guild_id === "string" && category.guild_id !== guildId)) {
      return { content: "Choose a category in this server.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return { content: "Ticket settings are temporarily unavailable.", ephemeral: true };
    }
    try {
      await env.FEEDBACK_CONFIG.put(`ticket-settings:${guildId}`, categoryId);
      return { content: "Support tickets will be created in that category.", ephemeral: true };
    } catch (error) {
      console.error("Could not save ticket category:", error instanceof Error ? error.message : String(error));
      return { content: "The ticket category could not be saved.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const ticketCommand = {
  name: "ticket",
  description: "Create a private support ticket.",
  component: closeTicket,
  execute: async ({ env, interaction, username }) => {
    const guildId = interaction.guild_id;
    const member = isRecord(interaction.member) ? interaction.member : undefined;
    const user = member && isRecord(member.user) ? member.user : interaction.user;
    const userId = isRecord(user) ? user.id : undefined;
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
        typeof userId !== "string" || !/^\d{17,20}$/.test(userId)) {
      return { content: "Tickets can only be opened in a server.", ephemeral: true };
    }
    const store = env.FEEDBACK_CONFIG;
    const botToken = env.DISCORD_BOT_TOKEN;
    if (!store || !botToken) {
      console.error("Tickets are missing their KV binding or bot token.");
      return { content: "Tickets are temporarily unavailable.", ephemeral: true };
    }
    try {
      const categoryId = await store.get(`ticket-settings:${guildId}`);
      if (!categoryId || !/^\d{17,20}$/.test(categoryId)) {
        return { content: "Tickets are not configured. Ask an admin to run `/setup-tickets`.", ephemeral: true };
      }
      const existing = await findOpenTicket(store, guildId, userId);
      if (existing) {
        return { content: `You already have an open ticket: <#${existing.channelId}>`, ephemeral: true };
      }
      const botResponse = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (!botResponse.ok) throw new Error(`Discord bot lookup returned HTTP ${botResponse.status}.`);
      const botUser: unknown = await botResponse.json();
      if (!isRecord(botUser) || typeof botUser.id !== "string" || !/^\d{17,20}$/.test(botUser.id)) {
        throw new Error("Discord returned an invalid bot user.");
      }
      const categoryResponse = await fetch(`https://discord.com/api/v10/channels/${categoryId}`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (!categoryResponse.ok) {
        throw new Error(`Ticket category lookup returned HTTP ${categoryResponse.status}.`);
      }
      const category: unknown = await categoryResponse.json();
      if (!isRecord(category)) {
        throw new Error("Discord returned invalid ticket category permissions.");
      }
      const categoryOverwrites = getTicketOverwrites(category.permission_overwrites);
      if (!categoryOverwrites ||
        (typeof category.guild_id === "string" && category.guild_id !== guildId)) {
        throw new Error("Discord returned invalid ticket category permissions.");
      }
      const everyone = categoryOverwrites.find(
        (overwrite) => overwrite.id === guildId && overwrite.type === 0,
      );
      const everyoneAllow = everyone ? BigInt(everyone.allow) : 0n;
      const everyoneDeny = everyone ? BigInt(everyone.deny) : 0n;
      const ticketOverwrites: TicketOverwrite[] = [
        ...categoryOverwrites.filter(
          (overwrite) =>
            !(overwrite.id === guildId && overwrite.type === 0) &&
            overwrite.id !== userId &&
            overwrite.id !== botUser.id,
        ),
        {
          id: guildId,
          type: 0,
          allow: (everyoneAllow & ~VIEW_CHANNEL).toString(),
          deny: (everyoneDeny | VIEW_CHANNEL).toString(),
        },
        { id: userId, type: 1, allow: OWNER_ACCESS, deny: "0" },
        { id: botUser.id, type: 1, allow: BOT_ACCESS, deny: "0" },
      ];
      if (ticketOverwrites.length > 100) {
        return {
          content: "The ticket category has too many permission overrides to create private tickets.",
          ephemeral: true,
        };
      }
      const safeName = username.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "member";
      const createResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
        method: "POST",
        headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `ticket-${safeName}`,
          type: 0,
          parent_id: categoryId,
          permission_overwrites: ticketOverwrites,
        }),
      });
      if (!createResponse.ok) throw new Error(`Discord channel creation returned HTTP ${createResponse.status}.`);
      const created: unknown = await createResponse.json();
      if (!isRecord(created) || typeof created.id !== "string" || !/^\d{17,20}$/.test(created.id)) {
        throw new Error("Discord returned an invalid ticket channel.");
      }
      const ticket: Ticket = { guildId, channelId: created.id, ownerId: userId, closed: false };
      const key = ticketKey(guildId, created.id);
      try {
        await store.put(key, JSON.stringify(ticket), { expirationTtl: TICKET_TTL });
      } catch (error) {
        console.error("Could not save ticket metadata:", error instanceof Error ? error.message : String(error));
        const deleteResponse = await fetch(`https://discord.com/api/v10/channels/${created.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bot ${botToken}` },
        });
        if (!deleteResponse.ok) {
          console.error(`Could not remove ticket channel without metadata (HTTP ${deleteResponse.status}).`);
          return { content: `Created <#${created.id}>, but ticket tracking failed and it may need to be removed manually.`, ephemeral: true };
        }
        return { content: "Ticket tracking could not be saved, so the empty private channel was removed.", ephemeral: true };
      }
      const messageResponse = await fetch(`https://discord.com/api/v10/channels/${created.id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `<@${userId}> opened a support ticket. Describe the issue here; a moderator will reply when available.`,
          components: [{ type: 1, components: [{ type: 2, style: 4, label: "Close ticket", custom_id: `ticket:${guildId}:${created.id}:close` }] }],
          allowed_mentions: { parse: [], users: [userId] },
        }),
      });
      if (!messageResponse.ok) {
        console.error(`Ticket channel created but its welcome message failed (HTTP ${messageResponse.status}).`);
        return { content: `Created <#${created.id}>, but the opening message could not be posted.`, ephemeral: true };
      }
      return { content: `Created your private ticket: <#${created.id}>`, ephemeral: true };
    } catch (error) {
      console.error("Could not create ticket:", error instanceof Error ? error.message : String(error));
      return { content: "The ticket could not be created. Check the bot's Manage Channels permission.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

export { setupTicketsCommand, ticketCommand };
