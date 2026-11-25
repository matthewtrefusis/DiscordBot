import { getOption, getUser, isRecord } from "./helpers";
import {
  eventKey,
  eventScheduleItemKey,
  parseScheduledEvent,
  renderEventAnnouncement,
  type ScheduledEvent,
} from "../events";
import { canManageServer } from "./permissions";
import { parseLocalDateTime, readUserTimeZone } from "../time-utils";
import { deleteScheduledItem, saveScheduledItem } from "../scheduler";
import type {
  CommandContext,
  DiscordCommand,
  InteractionCallback,
} from "./types";

const MAX_EVENT_DELAY_MS = 356 * 24 * 60 * 60 * 1000;
const EVENT_TTL_SECONDS = 400 * 24 * 60 * 60;

async function postEventAnnouncement(
  botToken: string,
  eventId: string,
  scheduledEvent: ScheduledEvent,
): Promise<string> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(scheduledEvent.channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...renderEventAnnouncement(eventId, scheduledEvent),
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}.`);
  }
  return `Created **${scheduledEvent.title}**. Members can RSVP using the buttons in <#${scheduledEvent.channelId}>.`;
}

async function updateEventRsvp(
  context: CommandContext,
): Promise<InteractionCallback> {
  const { env, interaction } = context;
  const data = interaction.data;
  const customId = isRecord(data) ? data.custom_id : undefined;
  const match = typeof customId === "string"
    ? /^event:([0-9a-f-]{36}):(join|leave)$/.exec(customId)
    : null;
  const member = interaction.member;
  const userContainer = isRecord(member) ? member.user : interaction.user;
  const userId = isRecord(userContainer) ? userContainer.id : undefined;
  const guildId = interaction.guild_id;
  if (
    !match ||
    typeof userId !== "string" ||
    !/^\d{17,20}$/.test(userId) ||
    typeof guildId !== "string" ||
    !/^\d{17,20}$/.test(guildId) ||
    !env.FEEDBACK_CONFIG ||
    !env.DB
  ) {
    return {
      type: 4,
      data: {
        content: "This event RSVP is unavailable.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    };
  }
  try {
    const key = eventKey(guildId, match[1]);
    const rawEvent = await env.FEEDBACK_CONFIG.get(key);
    const scheduledEvent = rawEvent ? parseScheduledEvent(rawEvent) : null;
    if (
      !scheduledEvent ||
      scheduledEvent.guildId !== guildId ||
      scheduledEvent.channelId !== interaction.channel_id
    ) {
      return {
        type: 4,
        data: {
          content: "This event is unavailable.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      };
    }
    if (scheduledEvent.startsAt <= Date.now()) {
      return {
        type: 4,
        data: {
          content: "RSVPs are closed because this event has started.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      };
    }
    const participants = new Set(scheduledEvent.participants);
    if (match[2] === "join") {
      participants.add(userId);
    } else {
      participants.delete(userId);
    }
    const updatedEvent = {
      ...scheduledEvent,
      participants: [...participants],
    };
    await env.FEEDBACK_CONFIG.put(
      key,
      JSON.stringify(updatedEvent),
      { expirationTtl: EVENT_TTL_SECONDS },
    );
    return {
      type: 7,
      data: {
        ...renderEventAnnouncement(match[1], updatedEvent),
        allowed_mentions: { parse: [] },
      },
    };
  } catch (error) {
    console.error(
      "Could not update event RSVP:",
      error instanceof Error ? error.message : String(error),
    );
    return {
      type: 4,
      data: {
        content: "Your RSVP could not be saved. Please try again.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    };
  }
}

const eventCommand = {
  name: "event",
  description: "Schedule an announcement in this channel.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "title",
      description: "What is happening?",
      required: true,
      min_length: 1,
      max_length: 150,
    },
    {
      type: 3,
      name: "local_time",
      description: "Local date and time, YYYY-MM-DD HH:mm (24-hour clock).",
      required: true,
      min_length: 16,
      max_length: 16,
    },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;
    const user = getUser(interaction);
    const userId = user?.id;
    const titleValue = getOption(interaction, "title");
    const title = typeof titleValue === "string" ? titleValue.trim() : "";
    const localTime = getOption(interaction, "local_time");
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof channelId !== "string" ||
      !/^\d{17,20}$/.test(channelId)
    ) {
      return {
        content: "Events can only be scheduled in a server text channel.",
        ephemeral: true,
      };
    }
    if (!canManageServer(interaction)) {
      return {
        content: "You need Manage Server permission to schedule events.",
        ephemeral: true,
      };
    }
    if (
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId) ||
      title.length === 0 ||
      title.length > 150 ||
      typeof localTime !== "string"
    ) {
      return {
        content: "Provide an event title and a valid local date and time.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG || !env.DB) {
      console.error("Event scheduling is missing its KV or D1 binding.");
      return {
        content: "Event scheduling is temporarily unavailable.",
        ephemeral: true,
      };
    }

    let timeZone: string | null;
    try {
      timeZone = await readUserTimeZone(env.FEEDBACK_CONFIG, userId);
    } catch (error) {
      console.error(
        "Could not read event creator timezone:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Your timezone could not be loaded. Please try again later.",
        ephemeral: true,
      };
    }
    if (!timeZone) {
      return {
        content: "Set your timezone first with `/timezone timezone:Europe/London`.",
        ephemeral: true,
      };
    }

    const result = parseLocalDateTime(localTime, timeZone);
    if (result.status === "ambiguous") {
      return {
        content: "That local time occurs twice because of a daylight-saving change. Choose a different time.",
        ephemeral: true,
      };
    }
    if (result.status !== "valid") {
      return {
        content: "Use a real date and time in `YYYY-MM-DD HH:mm` format. Times skipped by daylight-saving changes are not valid.",
        ephemeral: true,
      };
    }
    const now = Date.now();
    if (
      result.timestamp < now + 60_000 ||
      result.timestamp > now + MAX_EVENT_DELAY_MS
    ) {
      return {
        content: "Choose a time at least one minute from now and no more than 356 days away.",
        ephemeral: true,
      };
    }

    if (!env.DISCORD_BOT_TOKEN) {
      console.error("DISCORD_BOT_TOKEN is not configured.");
      return {
        content: "Event announcements are temporarily unavailable.",
        ephemeral: true,
      };
    }

    const eventId = crypto.randomUUID();
    const scheduledEvent = {
      guildId,
      channelId,
      title,
      startsAt: result.timestamp,
      createdBy: userId,
      attempts: 0,
      participants: [],
    };
    try {
      await env.FEEDBACK_CONFIG.put(
        eventKey(guildId, eventId),
        JSON.stringify(scheduledEvent),
        { expirationTtl: EVENT_TTL_SECONDS },
      );
      await saveScheduledItem(env.DB, "event", {
        itemKey: eventScheduleItemKey(guildId, eventId),
        dueAt: result.timestamp,
        lookupKey: null,
        referenceKey: null,
        payload: null,
      });
    } catch (error) {
      try {
        if (env.DB) {
          await deleteScheduledItem(
            env.DB,
            "event",
            eventScheduleItemKey(guildId, eventId),
          );
        }
      } catch (deleteError) {
        console.error(
          "Could not remove incomplete event schedule:",
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
        );
      }
      for (const incompleteKey of [eventKey(guildId, eventId)]) {
        try {
          await env.FEEDBACK_CONFIG.delete(incompleteKey);
        } catch (deleteError) {
          console.error(
            `Could not remove incomplete scheduled event state ${incompleteKey}:`,
            deleteError instanceof Error
              ? deleteError.message
              : String(deleteError),
          );
        }
      }
      console.error(
        "Could not save scheduled event:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "The event could not be scheduled. Please try again later.",
        ephemeral: true,
      };
    }
    return {
      content: "Creating the event post…",
      ephemeral: true,
      backgroundTask: postEventAnnouncement(
        env.DISCORD_BOT_TOKEN,
        eventId,
        scheduledEvent,
      ).catch((error: unknown) => {
        console.error(
          "Event was scheduled but its RSVP post could not be created:",
          error instanceof Error ? error.message : String(error),
        );
        return `Scheduled **${title}**, but the RSVP post could not be created.`;
      }),
    };
  },
  component: updateEventRsvp,
} satisfies DiscordCommand;

export default eventCommand;
