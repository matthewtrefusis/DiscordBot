import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import type { DiscordCommand, KeyValueStore } from "./types";

interface FAQ {
  id: string;
  question: string;
  answer: string;
}

function faqPrefix(guildId: string): string {
  return `faq:${guildId}:`;
}

async function listFAQs(
  store: KeyValueStore,
  guildId: string,
): Promise<{ key: string; faq: FAQ }[]> {
  const entries: { key: string; faq: FAQ }[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: faqPrefix(guildId),
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const { name } of page.keys) {
      const raw = await store.get(name);
      if (!raw) continue;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        console.error(`Ignoring malformed FAQ ${name}.`);
        continue;
      }
      if (
        isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.question === "string" &&
        typeof value.answer === "string"
      ) {
        entries.push({
          key: name,
          faq: { id: value.id, question: value.question, answer: value.answer },
        });
      } else {
        console.error(`Ignoring malformed FAQ ${name}.`);
      }
    }
    if (page.list_complete) break;
    if (!page.cursor) throw new Error("Cloudflare KV did not return an FAQ cursor.");
    cursor = page.cursor;
  } while (true);
  return entries;
}

const faqCommand = {
  name: "faq",
  description: "Search the server's frequently asked questions.",
  options: [{
    type: 3,
    name: "query",
    description: "A word or phrase to search for.",
    required: false,
    max_length: 100,
  }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const queryValue = getOption(interaction, "query");
    const query = typeof queryValue === "string" ? queryValue.trim().toLowerCase() : "";
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return { content: "FAQs can only be used in a server.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return { content: "FAQs are temporarily unavailable.", ephemeral: true };
    }
    try {
      const matches = (await listFAQs(env.FEEDBACK_CONFIG, guildId))
        .filter(({ faq }) =>
          !query || faq.question.toLowerCase().includes(query) ||
          faq.answer.toLowerCase().includes(query)
        )
        .slice(0, 10);
      if (!matches.length) {
        return {
          content: query ? "No FAQs matched your search." : "No FAQs have been added yet.",
          ephemeral: true,
        };
      }
      let content = "";
      for (const { faq } of matches) {
        const entry = `**${faq.question}**\n${faq.answer}`;
        if (content.length + entry.length + (content ? 2 : 0) > 1800) break;
        content += `${content ? "\n\n" : ""}${entry}`;
      }
      return {
        content,
        ephemeral: true,
      };
    } catch (error) {
      console.error("Could not load FAQs:", error instanceof Error ? error.message : String(error));
      return { content: "FAQs could not be loaded. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const faqAddCommand = {
  name: "faq-add",
  description: "Add a question and answer to the server FAQ.",
  default_member_permissions: "32",
  options: [
    { type: 3, name: "question", description: "The question.", required: true, min_length: 1, max_length: 100 },
    { type: 3, name: "answer", description: "The answer.", required: true, min_length: 1, max_length: 1500 },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const questionValue = getOption(interaction, "question");
    const answerValue = getOption(interaction, "answer");
    const question = typeof questionValue === "string" ? questionValue.trim() : "";
    const answer = typeof answerValue === "string" ? answerValue.trim() : "";
    if (!canManageServer(interaction)) {
      return { content: "You need Manage Server permission to add FAQs.", ephemeral: true };
    }
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) ||
        !question || question.length > 100 || !answer || answer.length > 1500) {
      return { content: "Provide a question and answer within the length limits.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return { content: "FAQ settings are temporarily unavailable.", ephemeral: true };
    }
    try {
      const existing = await listFAQs(env.FEEDBACK_CONFIG, guildId);
      if (existing.some(({ faq }) => faq.question.toLowerCase() === question.toLowerCase())) {
        return { content: "An FAQ with that question already exists.", ephemeral: true };
      }
      const id = crypto.randomUUID();
      await env.FEEDBACK_CONFIG.put(
        `${faqPrefix(guildId)}${id}`,
        JSON.stringify({ id, question, answer }),
      );
      return { content: `Added FAQ: **${question}**`, ephemeral: true };
    } catch (error) {
      console.error("Could not save FAQ:", error instanceof Error ? error.message : String(error));
      return { content: "The FAQ could not be saved. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const faqRemoveCommand = {
  name: "faq-remove",
  description: "Remove a question from the server FAQ.",
  default_member_permissions: "32",
  options: [{
    type: 3,
    name: "question",
    description: "The exact question to remove.",
    required: true,
    max_length: 100,
  }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const questionValue = getOption(interaction, "question");
    const question = typeof questionValue === "string" ? questionValue.trim() : "";
    if (!canManageServer(interaction)) {
      return { content: "You need Manage Server permission to remove FAQs.", ephemeral: true };
    }
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId) || !question) {
      return { content: "Choose an FAQ question to remove.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return { content: "FAQ settings are temporarily unavailable.", ephemeral: true };
    }
    try {
      const found = (await listFAQs(env.FEEDBACK_CONFIG, guildId))
        .find(({ faq }) => faq.question.toLowerCase() === question.toLowerCase());
      if (!found) return { content: "That FAQ was not found.", ephemeral: true };
      await env.FEEDBACK_CONFIG.delete(found.key);
      return { content: `Removed FAQ: **${found.faq.question}**`, ephemeral: true };
    } catch (error) {
      console.error("Could not remove FAQ:", error instanceof Error ? error.message : String(error));
      return { content: "The FAQ could not be removed. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

export { faqCommand, faqAddCommand, faqRemoveCommand };
