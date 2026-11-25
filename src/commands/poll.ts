import { getOption, isRecord } from "./helpers";
import type {
  CommandContext,
  DiscordCommand,
  InteractionCallback,
} from "./types";

interface PollState {
  guildId: string;
  channelId: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
}

function pollKey(pollId: string): string {
  return `poll:${pollId}`;
}

function parseOptions(value: unknown): string[] | null {
  if (typeof value !== "string") {
    return null;
  }
  const options = value.split(",").map((option) => option.trim());
  if (
    options.length < 2 ||
    options.length > 5 ||
    options.some((option) => option.length === 0 || option.length > 80) ||
    new Set(options.map((option) => option.toLowerCase())).size !== options.length
  ) {
    return null;
  }
  return options;
}

function countsFor(poll: PollState): number[] {
  return poll.options.map(
    (_, index) =>
      Object.values(poll.votes).filter((vote) => vote === index).length,
  );
}

function renderPoll(pollId: string, poll: PollState): {
  content: string;
  components: Record<string, unknown>[];
} {
  const counts = countsFor(poll);
  return {
    content: [
      `**Poll:** ${poll.question}`,
      ...poll.options.map(
        (option, index) => `${index + 1}. ${option} — ${counts[index]} vote(s)`,
      ),
      "_Click an option to vote. You can change your vote at any time._",
    ].join("\n"),
    components: [
      {
        type: 1,
        components: poll.options.map((option, index) => ({
          type: 2,
          style: 1,
          label: option,
          custom_id: `poll:${pollId}:${index}`,
        })),
      },
    ],
  };
}

async function publishPoll(
  env: CommandContext["env"],
  guildId: string,
  channelId: string,
  question: string,
  options: string[],
): Promise<string> {
  const botToken = env.DISCORD_BOT_TOKEN;
  const store = env.FEEDBACK_CONFIG;
  if (!botToken || !store) {
    console.error("Poll creation is missing its bot token or KV binding.");
    return "Polls are not configured on this server.";
  }

  const pollId = crypto.randomUUID();
  const poll: PollState = {
    guildId,
    channelId,
    question,
    options,
    votes: {},
  };
  try {
    await store.put(pollKey(pollId), JSON.stringify(poll));
  } catch (error) {
    console.error(
      "Could not save poll state:",
      error instanceof Error ? error.message : String(error),
    );
    return "The poll could not be saved. Please try again later.";
  }

  try {
    const message = renderPoll(pollId, poll);
    const response = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...message,
          allowed_mentions: { parse: [] },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Discord returned HTTP ${response.status}.`);
    }
    return "Your poll has been posted.";
  } catch (error) {
    console.error(
      "Could not post poll:",
      error instanceof Error ? error.message : String(error),
    );
    try {
      await store.delete(pollKey(pollId));
    } catch (deleteError) {
      console.error(
        "Could not remove failed poll state:",
        deleteError instanceof Error ? deleteError.message : String(deleteError),
      );
    }
    return "The poll could not be posted. Check that the bot can send messages in this channel.";
  }
}

function readPollState(value: string): PollState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.guildId !== "string" ||
    !/^\d{17,20}$/.test(parsed.guildId) ||
    typeof parsed.channelId !== "string" ||
    !/^\d{17,20}$/.test(parsed.channelId) ||
    typeof parsed.question !== "string" ||
    parsed.question.length === 0 ||
    parsed.question.length > 500 ||
    !Array.isArray(parsed.options) ||
    parsed.options.length < 2 ||
    parsed.options.length > 5 ||
    !parsed.options.every(
      (option) =>
        typeof option === "string" &&
        option.trim().length > 0 &&
        option.length <= 80,
    ) ||
    new Set(
      parsed.options.map((option) =>
        typeof option === "string" ? option.toLowerCase() : "",
      ),
    ).size !== parsed.options.length ||
    !isRecord(parsed.votes)
  ) {
    return null;
  }
  const votes: Record<string, number> = {};
  for (const [userId, vote] of Object.entries(parsed.votes)) {
    if (
      !/^\d{17,20}$/.test(userId) ||
      typeof vote !== "number" ||
      !Number.isInteger(vote) ||
      vote < 0 ||
      vote >= parsed.options.length
    ) {
      return null;
    }
    votes[userId] = vote;
  }
  return {
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    question: parsed.question,
    options: parsed.options,
    votes,
  };
}

function componentError(content: string): InteractionCallback {
  return {
    type: 4,
    data: { content, flags: 64, allowed_mentions: { parse: [] } },
  };
}

async function voteOnPoll({
  env,
  interaction,
}: CommandContext): Promise<InteractionCallback> {
  const data = interaction.data;
  const customId = isRecord(data) ? data.custom_id : undefined;
  const match = typeof customId === "string"
    ? /^poll:([0-9a-f-]{36}):([0-4])$/.exec(customId)
    : null;
  const userContainer = isRecord(interaction.member)
    ? interaction.member.user
    : interaction.user;
  const userId = isRecord(userContainer) ? userContainer.id : undefined;
  if (
    !match ||
    typeof userId !== "string" ||
    !/^\d{17,20}$/.test(userId) ||
    !env.FEEDBACK_CONFIG
  ) {
    return componentError("This poll is unavailable.");
  }

  try {
    const rawPoll = await env.FEEDBACK_CONFIG.get(pollKey(match[1]));
    const poll = rawPoll ? readPollState(rawPoll) : null;
    if (!poll) {
      return componentError("This poll has expired or is no longer available.");
    }
    if (
      interaction.guild_id !== poll.guildId ||
      interaction.channel_id !== poll.channelId
    ) {
      return componentError("This poll is unavailable in this channel.");
    }

    const optionIndex = Number(match[2]);
    if (optionIndex >= poll.options.length) {
      return componentError("That poll option is no longer available.");
    }
    poll.votes[userId] = optionIndex;
    await env.FEEDBACK_CONFIG.put(
      pollKey(match[1]),
      JSON.stringify(poll),
    );
    return {
      type: 7,
      data: {
        ...renderPoll(match[1], poll),
        allowed_mentions: { parse: [] },
      },
    };
  } catch (error) {
    console.error(
      "Could not record poll vote:",
      error instanceof Error ? error.message : String(error),
    );
    return componentError("Your vote could not be recorded. Please try again.");
  }
}

const pollCommand = {
  name: "poll",
  description: "Create a poll with 2-5 choices.",
  options: [
    {
      type: 3,
      name: "question",
      description: "The question to ask.",
      required: true,
      min_length: 1,
      max_length: 500,
    },
    {
      type: 3,
      name: "options",
      description: "Comma-separated choices (2-5, up to 80 characters each).",
      required: true,
      min_length: 3,
      max_length: 500,
    },
  ],
  component: voteOnPoll,
  execute: ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;
    const questionValue = getOption(interaction, "question");
    const question = typeof questionValue === "string"
      ? questionValue.trim()
      : "";
    const options = parseOptions(getOption(interaction, "options"));
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof channelId !== "string" ||
      !/^\d{17,20}$/.test(channelId)
    ) {
      return {
        content: "Polls can only be created in a server text channel.",
        ephemeral: true,
      };
    }
    if (question.length === 0 || question.length > 500 || !options) {
      return {
        content: "Provide a question and 2–5 unique choices of at most 80 characters each.",
        ephemeral: true,
      };
    }

    return {
      content: "Creating your poll…",
      ephemeral: true,
      backgroundTask: publishPoll(
        env,
        guildId,
        channelId,
        question,
        options,
      ),
    };
  },
} satisfies DiscordCommand;

export default pollCommand;
