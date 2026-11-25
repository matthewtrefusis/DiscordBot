import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import {
  type Giveaway,
  giveawayKey,
  parseGiveaway,
  renderGiveaway,
} from "../giveaways";
import { deleteScheduledItem, saveScheduledItem } from "../scheduler";
import type { CommandContext, DiscordCommand, InteractionCallback } from "./types";

const MAX_GIVEAWAY_MINUTES = 356 * 24 * 60;
const GIVEAWAY_TTL_SECONDS = (MAX_GIVEAWAY_MINUTES + 24 * 60) * 60;

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

async function toggleGiveawayEntry(
  context: CommandContext,
): Promise<InteractionCallback> {
  const { env, interaction } = context;
  const data = interaction.data;
  const customId = isRecord(data) ? data.custom_id : undefined;
  const match = typeof customId === "string"
    ? /^giveaway:([0-9a-f-]{36}):toggle$/.exec(customId)
    : null;
  const member = interaction.member;
  const userContainer = isRecord(member) ? member.user : interaction.user;
  const userId = isRecord(userContainer) ? userContainer.id : undefined;
  const guildId = interaction.guild_id;
  if (!match || !isSnowflake(userId) || !isSnowflake(guildId) ||
      !env.FEEDBACK_CONFIG) {
    return {
      type: 4,
      data: {
        content: "This giveaway is unavailable.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    };
  }

  try {
    const key = giveawayKey(match[1]);
    const rawGiveaway = await env.FEEDBACK_CONFIG.get(key);
    const giveaway = rawGiveaway ? parseGiveaway(rawGiveaway) : null;
    if (
      !giveaway ||
      giveaway.guildId !== guildId ||
      giveaway.channelId !== interaction.channel_id
    ) {
      return {
        type: 4,
        data: {
          content: "This giveaway is unavailable.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      };
    }
    if (giveaway.closed || giveaway.endsAt <= Date.now()) {
      return {
        type: 4,
        data: {
          content: "This giveaway has ended.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      };
    }
    const entries = new Set(giveaway.entries);
    if (entries.has(userId)) {
      entries.delete(userId);
    } else {
      entries.add(userId);
    }
    const updated = { ...giveaway, entries: [...entries] };
    await env.FEEDBACK_CONFIG.put(key, JSON.stringify(updated), {
      expirationTtl: GIVEAWAY_TTL_SECONDS,
    });
    return {
      type: 7,
      data: {
        ...renderGiveaway(updated),
        allowed_mentions: { parse: [] },
      },
    };
  } catch (error) {
    console.error(
      "Could not update giveaway entry:",
      error instanceof Error ? error.message : String(error),
    );
    return {
      type: 4,
      data: {
        content: "Your giveaway entry could not be updated. Please try again.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    };
  }
}

async function postGiveaway(
  context: CommandContext,
  giveaway: Giveaway,
): Promise<string> {
  const store = context.env.FEEDBACK_CONFIG;
  const botToken = context.env.DISCORD_BOT_TOKEN;
  if (!store || !botToken) {
    throw new Error("Giveaway is missing its KV binding or bot token.");
  }
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(giveaway.channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...renderGiveaway(giveaway),
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}.`);
  }
  const message: unknown = await response.json();
  if (!isRecord(message) || !isSnowflake(message.id)) {
    throw new Error("Discord returned an invalid giveaway message.");
  }
  try {
    await store.put(
      giveawayKey(giveaway.id),
      JSON.stringify({ ...giveaway, messageId: message.id }),
      { expirationTtl: GIVEAWAY_TTL_SECONDS },
    );
  } catch (error) {
    console.error(
      "Giveaway was posted but its message ID could not be saved:",
      error instanceof Error ? error.message : String(error),
    );
    return `Started **${giveaway.prize}**, but the original post may not be editable when the giveaway ends.`;
  }
  return `Started **${giveaway.prize}**. Members can join or leave using the button.`;
}

const giveawayCommand = {
  name: "giveaway",
  description: "Start a timed giveaway with a one-entry-per-member button.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "prize",
      description: "What is being given away?",
      required: true,
      min_length: 1,
      max_length: 200,
    },
    {
      type: 4,
      name: "minutes",
      description: "How long the giveaway lasts (1-512640).",
      required: true,
      min_value: 1,
      max_value: MAX_GIVEAWAY_MINUTES,
    },
  ],
  component: toggleGiveawayEntry,
  execute: async (context) => {
    const { env, interaction } = context;
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;
    const prizeValue = getOption(interaction, "prize");
    const prize = typeof prizeValue === "string" ? prizeValue.trim() : "";
    const minutes = getOption(interaction, "minutes");
    if (!isSnowflake(guildId) || !isSnowflake(channelId)) {
      return {
        content: "Giveaways can only be started in a server text channel.",
        ephemeral: true,
      };
    }
    if (!canManageServer(interaction)) {
      return {
        content: "You need Manage Server permission to start a giveaway.",
        ephemeral: true,
      };
    }
    if (
      !prize ||
      prize.length > 200 ||
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_GIVEAWAY_MINUTES
    ) {
      return {
        content: "Provide a prize and a duration between 1 minute and 356 days.",
        ephemeral: true,
      };
    }
    const store = env.FEEDBACK_CONFIG;
    const database = env.DB;
    if (!store || !database || !env.DISCORD_BOT_TOKEN) {
      console.error("Giveaways are missing their KV/D1 binding or bot token.");
      return {
        content: "Giveaways are temporarily unavailable.",
        ephemeral: true,
      };
    }
    const giveaway = {
      id: crypto.randomUUID(),
      guildId,
      channelId,
      prize,
      endsAt: Date.now() + minutes * 60_000,
      entries: [],
      attempts: 0,
    };
    try {
      await store.put(
        giveawayKey(giveaway.id),
        JSON.stringify(giveaway),
        { expirationTtl: GIVEAWAY_TTL_SECONDS },
      );
      await saveScheduledItem(database, "giveaway", {
        itemKey: giveaway.id,
        dueAt: giveaway.endsAt,
        lookupKey: null,
        referenceKey: null,
        payload: null,
      });
    } catch (error) {
      try {
        await deleteScheduledItem(database, "giveaway", giveaway.id);
      } catch (deleteError) {
        console.error(
          `Could not remove incomplete giveaway schedule ${giveaway.id}:`,
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
        );
      }
      for (const key of [giveawayKey(giveaway.id)]) {
        try {
          await store.delete(key);
        } catch (deleteError) {
          console.error(
            `Could not remove incomplete giveaway state ${key}:`,
            deleteError instanceof Error
              ? deleteError.message
              : String(deleteError),
          );
        }
      }
      console.error(
        "Could not save giveaway:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "The giveaway could not be scheduled. Please try again later.",
        ephemeral: true,
      };
    }
    return {
      content: "Creating the giveaway…",
      ephemeral: true,
      backgroundTask: postGiveaway(
        context,
        giveaway,
      ).catch((error: unknown) => {
        const cleanup = (async () => {
          try {
            await deleteScheduledItem(database, "giveaway", giveaway.id);
          } catch (deleteError) {
            console.error(
              `Could not remove failed giveaway schedule ${giveaway.id}:`,
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError),
            );
          }
          try {
            await store.delete(giveawayKey(giveaway.id));
          } catch (deleteError) {
            console.error(
              `Could not remove failed giveaway state ${giveawayKey(giveaway.id)}:`,
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError),
            );
          }
        })();
        return cleanup.then(() => {
          console.error(
            "Could not post giveaway:",
            error instanceof Error ? error.message : String(error),
          );
          return "The giveaway could not be posted. Its scheduled state was removed.";
        });
      }),
    };
  },
} satisfies DiscordCommand;

export default giveawayCommand;
