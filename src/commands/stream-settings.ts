import { isRecord } from "./helpers";
import type { KeyValueStore } from "./types";

export const STREAM_SETTINGS_PREFIX = "stream-settings:";
export const MAX_STREAM_SOURCES = 10;

export interface StreamSource {
  platform: "youtube" | "twitch";
  url: string;
  channelId: string;
  displayName: string;
  uploadsPlaylistId?: string;
  channelLogin?: string;
  activeStreamId?: string | null;
  addedAt?: number;
  lastObservedVideoId?: string | null;
  lastObservedVideoAt?: number;
  lastCheckedAt?: number;
}

export interface StreamSettings {
  channelId: string;
  sources: StreamSource[];
}

export type ParsedStreamUrl =
  | {
      platform: "youtube";
      canonicalUrl: string;
      lookup: { kind: "id" | "handle" | "username"; value: string };
    }
  | {
      platform: "twitch";
      canonicalUrl: string;
      login: string;
    };

export function streamSettingsKey(guildId: string): string {
  return `${STREAM_SETTINGS_PREFIX}${guildId}`;
}

export function parseStreamUrl(value: unknown): ParsedStreamUrl | null {
  if (typeof value !== "string" || value.length > 200) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const channelPath = path.replace(
    /\/(about|community|featured|live|shorts|streams|videos)$/i,
    "",
  );
  const youtubeHost = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
  ].includes(host);
  if (youtubeHost) {
    const channelMatch = channelPath.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/);
    if (channelMatch) {
      const channelId = channelMatch[1];
      return {
        platform: "youtube",
        canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
        lookup: { kind: "id", value: channelId },
      };
    }

    const handleMatch = channelPath.match(/^\/@([A-Za-z0-9._-]{3,30})$/);
    if (handleMatch) {
      const handle = handleMatch[1];
      return {
        platform: "youtube",
        canonicalUrl: `https://www.youtube.com/@${handle.toLowerCase()}`,
        lookup: { kind: "handle", value: handle },
      };
    }

    const usernameMatch = channelPath.match(/^\/user\/([A-Za-z0-9._-]{1,100})$/);
    if (usernameMatch) {
      const username = usernameMatch[1];
      return {
        platform: "youtube",
        canonicalUrl: `https://www.youtube.com/user/${username}`,
        lookup: { kind: "username", value: username },
      };
    }
    return null;
  }

  if (host === "twitch.tv" || host === "www.twitch.tv") {
    const login = path.slice(1);
    if (
      /^[a-zA-Z0-9_]{1,25}$/.test(login) &&
      !["directory", "downloads", "jobs", "p", "settings", "videos"].includes(
        login.toLowerCase(),
      )
    ) {
      const normalizedLogin = login.toLowerCase();
      return {
        platform: "twitch",
        canonicalUrl: `https://www.twitch.tv/${normalizedLogin}`,
        login: normalizedLogin,
      };
    }
  }

  return null;
}

function isStreamSource(value: unknown): value is StreamSource {
  if (
    !isRecord(value) ||
    (value.platform !== "youtube" && value.platform !== "twitch") ||
    typeof value.url !== "string" ||
    typeof value.channelId !== "string" ||
    typeof value.displayName !== "string" ||
    value.displayName.length === 0 ||
    value.displayName.length > 100 ||
    (value.activeStreamId !== undefined &&
      value.activeStreamId !== null &&
      typeof value.activeStreamId !== "string") ||
    (value.addedAt !== undefined &&
      (typeof value.addedAt !== "number" || !Number.isFinite(value.addedAt))) ||
    (value.lastObservedVideoId !== undefined &&
      value.lastObservedVideoId !== null &&
      typeof value.lastObservedVideoId !== "string") ||
    (value.lastObservedVideoAt !== undefined &&
      (typeof value.lastObservedVideoAt !== "number" ||
        !Number.isFinite(value.lastObservedVideoAt))) ||
    (value.lastCheckedAt !== undefined &&
      (typeof value.lastCheckedAt !== "number" ||
        !Number.isFinite(value.lastCheckedAt)))
  ) {
    return false;
  }

  if (value.platform === "youtube") {
    return (
      /^UC[A-Za-z0-9_-]{22}$/.test(value.channelId) &&
      typeof value.uploadsPlaylistId === "string" &&
      value.uploadsPlaylistId.length > 0
    );
  }

  return (
    /^\d+$/.test(value.channelId) &&
    typeof value.channelLogin === "string" &&
    /^[a-zA-Z0-9_]{1,25}$/.test(value.channelLogin)
  );
}

export function parseStreamSettings(value: unknown): StreamSettings | null {
  if (
    !isRecord(value) ||
    typeof value.channelId !== "string" ||
    !/^\d{17,20}$/.test(value.channelId) ||
    !Array.isArray(value.sources) ||
    value.sources.length > MAX_STREAM_SOURCES ||
    !value.sources.every(isStreamSource)
  ) {
    return null;
  }

  return {
    channelId: value.channelId,
    sources: value.sources,
  };
}

export async function readStreamSettings(
  store: KeyValueStore,
  guildId: string,
): Promise<StreamSettings | null> {
  const rawSettings = await store.get(streamSettingsKey(guildId));
  if (rawSettings === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSettings);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Stream settings for server ${guildId} are invalid JSON.`);
      throw new Error("Stored stream settings are invalid.");
    }
    throw error;
  }

  const settings = parseStreamSettings(parsed);
  if (!settings) {
    console.error(`Stream settings for server ${guildId} have an invalid format.`);
    throw new Error("Stored stream settings are invalid.");
  }
  return settings;
}
