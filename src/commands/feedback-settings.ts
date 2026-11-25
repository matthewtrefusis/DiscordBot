import { isRecord } from "./helpers";
import type { CommandEnvironment } from "./types";

export interface FeedbackSettings {
  channelId: string;
  categories: string[];
}

export function feedbackSettingsKey(guildId: string): string {
  return `feedback-settings:${guildId}`;
}

export async function readFeedbackSettings(
  env: CommandEnvironment,
  guildId: string,
): Promise<FeedbackSettings | null> {
  if (!env.FEEDBACK_CONFIG) {
    throw new Error("FEEDBACK_CONFIG KV binding is not configured.");
  }

  const rawSettings = await env.FEEDBACK_CONFIG.get(
    feedbackSettingsKey(guildId),
  );
  if (rawSettings) {
    let settings: unknown;
    try {
      settings = JSON.parse(rawSettings);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error(`Feedback settings for server ${guildId} are invalid JSON.`);
        return null;
      }
      throw error;
    }

    if (!isRecord(settings)) {
      console.error(`Feedback settings for server ${guildId} have an invalid format.`);
      return null;
    }

    const channelId = settings.channelId;
    const categories = settings.categories;
    if (
      typeof channelId === "string" &&
      /^\d{17,20}$/.test(channelId) &&
      Array.isArray(categories) &&
      categories.length > 0 &&
      categories.length <= 25 &&
      categories.every(
        (category): category is string =>
          typeof category === "string" &&
          category.trim().length > 0 &&
          category.length <= 100,
      ) &&
      new Set(categories.map((category) => category.toLowerCase())).size ===
        categories.length
    ) {
      return {
        channelId,
        categories,
      };
    }

    console.error(`Feedback settings for server ${guildId} have an invalid format.`);
    return null;
  }

  const legacyChannelId = await env.FEEDBACK_CONFIG.get(
    `feedback-channel:${guildId}`,
  );
  if (legacyChannelId && /^\d{17,20}$/.test(legacyChannelId)) {
    return { channelId: legacyChannelId, categories: [] };
  }
  return null;
}
