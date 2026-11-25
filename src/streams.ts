import { isRecord } from "./commands/helpers";
import {
  parseStreamSettings,
  STREAM_SETTINGS_PREFIX,
  streamSettingsKey,
} from "./commands/stream-settings";
import type {
  ParsedStreamUrl,
  StreamSettings,
  StreamSource,
} from "./commands/stream-settings";
import type { CommandEnvironment, KeyValueStore } from "./commands/types";

const STREAM_POLL_INTERVAL_MS = 5 * 60 * 1000;
const TWITCH_TOKEN_PREFIX = "stream-twitch-token:";

interface LiveStream {
  id: string;
  title: string;
  url: string;
}

interface StreamVideo extends LiveStream {
  createdAt?: number;
  isLive: boolean;
  isLiveArchive: boolean;
  streamId?: string;
}

interface StreamActivity {
  liveStream: LiveStream | null;
  videos: StreamVideo[];
}

async function readJsonResponse(
  response: Response,
  description: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    throw new Error(`${description} returned an invalid response.`);
  }
  return body;
}

async function getTwitchAccessToken(
  env: CommandEnvironment,
  store: KeyValueStore,
): Promise<string> {
  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Twitch client ID and client secret are not configured.");
  }

  const cacheKey = `${TWITCH_TOKEN_PREFIX}${clientId}`;
  const cachedValue = await store.get(cacheKey);
  if (cachedValue) {
    let cached: unknown;
    try {
      cached = JSON.parse(cachedValue);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      console.error("Discarding malformed cached Twitch access token.");
      await store.delete(cacheKey);
    }
    if (
      isRecord(cached) &&
      typeof cached.accessToken === "string" &&
      typeof cached.expiresAt === "number" &&
      cached.expiresAt > Date.now() + 60_000
    ) {
      return cached.accessToken;
    }
  }

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const tokenData = await readJsonResponse(response, "Twitch token request");
  if (
    typeof tokenData.access_token !== "string" ||
    typeof tokenData.expires_in !== "number" ||
    !Number.isFinite(tokenData.expires_in) ||
    tokenData.expires_in <= 0
  ) {
    throw new Error("Twitch returned an invalid app access token.");
  }

  const expiresAt = Date.now() + tokenData.expires_in * 1000;
  const expirationTtl = Math.max(60, Math.floor(tokenData.expires_in) - 60);
  await store.put(
    cacheKey,
    JSON.stringify({ accessToken: tokenData.access_token, expiresAt }),
    { expirationTtl },
  );
  return tokenData.access_token;
}

async function resolveYouTubeSource(
  apiKey: string,
  parsedUrl: Extract<ParsedStreamUrl, { platform: "youtube" }>,
): Promise<StreamSource> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("key", apiKey);
  url.searchParams.set(
    parsedUrl.lookup.kind === "id"
      ? "id"
      : parsedUrl.lookup.kind === "handle"
        ? "forHandle"
        : "forUsername",
    parsedUrl.lookup.value,
  );
  const channelData = await readJsonResponse(
    await fetch(url),
    "YouTube channel lookup",
  );
  const channels = channelData.items;
  const channel = Array.isArray(channels) ? channels[0] : undefined;
  const snippet = isRecord(channel) ? channel.snippet : undefined;
  const contentDetails = isRecord(channel) ? channel.contentDetails : undefined;
  const relatedPlaylists = isRecord(contentDetails)
    ? contentDetails.relatedPlaylists
    : undefined;
  const channelId = isRecord(channel) ? channel.id : undefined;
  const displayName = isRecord(snippet) ? snippet.title : undefined;
  const uploadsPlaylistId = isRecord(relatedPlaylists)
    ? relatedPlaylists.uploads
    : undefined;

  if (
    typeof channelId !== "string" ||
    !/^UC[A-Za-z0-9_-]{22}$/.test(channelId) ||
    typeof displayName !== "string" ||
    typeof uploadsPlaylistId !== "string" ||
    uploadsPlaylistId.length === 0
  ) {
    throw new Error("YouTube could not find a channel for that URL.");
  }

  return {
    platform: "youtube",
    url: parsedUrl.canonicalUrl,
    channelId,
    displayName,
    uploadsPlaylistId,
  };
}

async function resolveTwitchSource(
  env: CommandEnvironment,
  store: KeyValueStore,
  parsedUrl: Extract<ParsedStreamUrl, { platform: "twitch" }>,
): Promise<StreamSource> {
  const clientId = env.TWITCH_CLIENT_ID;
  if (!clientId) {
    throw new Error("Twitch client ID is not configured.");
  }
  const accessToken = await getTwitchAccessToken(env, store);
  const url = new URL("https://api.twitch.tv/helix/users");
  url.searchParams.set("login", parsedUrl.login);
  const userData = await readJsonResponse(
    await fetch(url, {
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    }),
    "Twitch channel lookup",
  );
  const users = userData.data;
  const user = Array.isArray(users) ? users[0] : undefined;
  if (
    !isRecord(user) ||
    typeof user.id !== "string" ||
    !/^\d+$/.test(user.id) ||
    typeof user.display_name !== "string" ||
    typeof user.login !== "string"
  ) {
    throw new Error("Twitch could not find a channel for that URL.");
  }

  return {
    platform: "twitch",
    url: parsedUrl.canonicalUrl,
    channelId: user.id,
    displayName: user.display_name,
    channelLogin: user.login,
  };
}

export async function resolveStreamSource(
  env: CommandEnvironment,
  parsedUrl: ParsedStreamUrl,
): Promise<StreamSource> {
  const store = env.FEEDBACK_CONFIG;
  if (!store) {
    throw new Error("FEEDBACK_CONFIG KV binding is not configured.");
  }
  if (parsedUrl.platform === "youtube") {
    if (!env.YOUTUBE_API_KEY) {
      throw new Error("YouTube Data API key is not configured.");
    }
    return resolveYouTubeSource(env.YOUTUBE_API_KEY, parsedUrl);
  }
  return resolveTwitchSource(env, store, parsedUrl);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

async function getCurrentYouTubeActivity(
  apiKey: string,
  source: StreamSource,
): Promise<StreamActivity> {
  const uploadsPlaylistId = source.uploadsPlaylistId;
  if (!uploadsPlaylistId) {
    throw new Error("YouTube uploads playlist is missing from stream settings.");
  }
  const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  playlistUrl.searchParams.set("part", "contentDetails");
  playlistUrl.searchParams.set("playlistId", uploadsPlaylistId);
  playlistUrl.searchParams.set("maxResults", "50");
  playlistUrl.searchParams.set("key", apiKey);
  const playlistData = await readJsonResponse(
    await fetch(playlistUrl),
    "YouTube upload lookup",
  );
  const playlistItems = Array.isArray(playlistData.items)
    ? playlistData.items.flatMap((item) => {
      const contentDetails = isRecord(item) ? item.contentDetails : undefined;
      if (!isRecord(contentDetails) || typeof contentDetails.videoId !== "string") {
        return [];
      }
      return [{
        id: contentDetails.videoId,
        createdAt: parseTimestamp(contentDetails.videoPublishedAt),
      }];
    })
      .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    : [];
  const videoIds = playlistItems.map((item) => item.id);
  if (videoIds.length === 0) {
    return { liveStream: null, videos: [] };
  }

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "snippet,liveStreamingDetails");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);
  const videosData = await readJsonResponse(
    await fetch(videosUrl),
    "YouTube live status lookup",
  );
  if (!Array.isArray(videosData.items)) {
    return { liveStream: null, videos: [] };
  }

  const metadataById = new Map<string, Record<string, unknown>>();
  for (const item of videosData.items) {
    if (isRecord(item) && typeof item.id === "string") {
      metadataById.set(item.id, item);
    }
  }

  const videos: StreamVideo[] = [];
  for (const playlistItem of playlistItems) {
    const item = metadataById.get(playlistItem.id);
    if (!item) {
      continue;
    }
    const snippet = isRecord(item) ? item.snippet : undefined;
    if (!isRecord(snippet) || typeof snippet.title !== "string") {
      continue;
    }
    videos.push({
      id: playlistItem.id,
      title: snippet.title,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(playlistItem.id)}`,
      ...(playlistItem.createdAt === undefined
        ? {}
        : { createdAt: playlistItem.createdAt }),
      isLive: snippet.liveBroadcastContent === "live",
      isLiveArchive: isRecord(item.liveStreamingDetails),
    });
  }

  const liveVideo = videos.find((video) => video.isLive);
  return {
    liveStream: liveVideo
      ? {
          id: liveVideo.id,
          title: liveVideo.title,
          url: liveVideo.url,
        }
      : null,
    videos,
  };
}

async function getCurrentTwitchActivity(
  env: CommandEnvironment,
  store: KeyValueStore,
  source: StreamSource,
): Promise<StreamActivity> {
  const clientId = env.TWITCH_CLIENT_ID;
  if (!clientId || !source.channelLogin) {
    throw new Error("Twitch client ID or configured channel login is missing.");
  }
  const accessToken = await getTwitchAccessToken(env, store);
  const headers = {
    "Client-Id": clientId,
    Authorization: `Bearer ${accessToken}`,
  };
  const streamsUrl = new URL("https://api.twitch.tv/helix/streams");
  streamsUrl.searchParams.set("user_id", source.channelId);
  const videosUrl = new URL("https://api.twitch.tv/helix/videos");
  videosUrl.searchParams.set("user_id", source.channelId);
  videosUrl.searchParams.set("type", "archive");
  videosUrl.searchParams.set("sort", "time");
  videosUrl.searchParams.set("first", "50");

  const [streamsResponse, videosResponse] = await Promise.all([
    fetch(streamsUrl, { headers }),
    fetch(videosUrl, { headers }),
  ]);
  const [streamsData, videosData] = await Promise.all([
    readJsonResponse(streamsResponse, "Twitch stream lookup"),
    readJsonResponse(videosResponse, "Twitch VOD lookup"),
  ]);

  const stream = Array.isArray(streamsData.data)
    ? streamsData.data[0]
    : undefined;
  let liveStream: LiveStream | null = null;
  if (stream !== undefined) {
    if (
      !isRecord(stream) ||
      typeof stream.id !== "string" ||
      typeof stream.title !== "string"
    ) {
      throw new Error("Twitch returned an invalid stream.");
    }
    liveStream = {
      id: stream.id,
      title: stream.title,
      url: `https://www.twitch.tv/${encodeURIComponent(source.channelLogin)}`,
    };
  }

  const videos: StreamVideo[] = [];
  if (Array.isArray(videosData.data)) {
    for (const video of videosData.data) {
      if (
        !isRecord(video) ||
        typeof video.id !== "string" ||
        typeof video.title !== "string" ||
        typeof video.url !== "string"
      ) {
        throw new Error("Twitch returned an invalid VOD.");
      }
      const createdAt = parseTimestamp(video.published_at) ??
        parseTimestamp(video.created_at);
      videos.push({
        id: video.id,
        title: video.title,
        url: video.url,
        ...(createdAt === undefined ? {} : { createdAt }),
        isLive: false,
        isLiveArchive: true,
        ...(typeof video.stream_id === "string"
          ? { streamId: video.stream_id }
          : {}),
      });
    }
  }

  return { liveStream, videos };
}

async function getCurrentActivity(
  env: CommandEnvironment,
  store: KeyValueStore,
  source: StreamSource,
): Promise<StreamActivity> {
  if (source.platform === "youtube") {
    if (!env.YOUTUBE_API_KEY) {
      throw new Error("YouTube Data API key is not configured.");
    }
    return getCurrentYouTubeActivity(env.YOUTUBE_API_KEY, source);
  }
  return getCurrentTwitchActivity(env, store, source);
}

function getNewVideos(
  videos: StreamVideo[],
  source: StreamSource,
): StreamVideo[] {
  if (videos.length === 0) {
    return [];
  }

  if (source.lastObservedVideoId) {
    const lastVideoIndex = videos.findIndex(
      (video) => video.id === source.lastObservedVideoId,
    );
    if (lastVideoIndex >= 0) {
      return videos.slice(0, lastVideoIndex).reverse();
    }
    const lastObservedVideoAt = source.lastObservedVideoAt;
    if (typeof lastObservedVideoAt !== "number") {
      return [];
    }
    return videos
      .filter(
        (video) =>
          typeof video.createdAt === "number" &&
          video.createdAt > lastObservedVideoAt,
      )
      .reverse();
  }

  if (typeof source.addedAt !== "number") {
    return [];
  }
  const addedAt = source.addedAt;
  return videos
    .filter(
      (video) =>
        typeof video.createdAt === "number" &&
        video.createdAt >= addedAt,
    )
    .reverse();
}

function recordObservedVideo(source: StreamSource, video: StreamVideo): void {
  source.lastObservedVideoId = video.id;
  if (typeof video.createdAt === "number") {
    source.lastObservedVideoAt = video.createdAt;
  }
}

function twitchLiveAlertKey(
  guildId: string,
  source: StreamSource,
  streamId: string,
): string {
  return `stream-live-alerted:${guildId}:${source.channelId}:${streamId}`;
}

async function markTwitchLiveAlerted(
  store: KeyValueStore,
  guildId: string,
  source: StreamSource,
  streamId: string,
  alertedLiveStreams: Set<string>,
): Promise<void> {
  const key = twitchLiveAlertKey(guildId, source, streamId);
  alertedLiveStreams.add(key);
  await store.put(
    key,
    "1",
    { expirationTtl: 60 * 24 * 60 * 60 },
  );
}

async function wasTwitchLiveAlerted(
  store: KeyValueStore,
  guildId: string,
  source: StreamSource,
  streamId: string,
  alertedLiveStreams: Set<string>,
): Promise<boolean> {
  const key = twitchLiveAlertKey(guildId, source, streamId);
  return alertedLiveStreams.has(key) || (await store.get(key)) !== null;
}

async function sendVideoAnnouncement(
  botToken: string,
  channelId: string,
  source: StreamSource,
  video: StreamVideo,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `🎬 **New video from ${source.displayName}: ${video.title}**\n${video.url}`,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord video announcement failed with HTTP ${response.status}.`);
  }
}

async function sendLiveAnnouncement(
  botToken: string,
  channelId: string,
  source: StreamSource,
  liveStream: LiveStream,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `🔴 **${source.displayName} is live${liveStream.title ? `: ${liveStream.title}` : ""}**\n${liveStream.url}`,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord announcement failed with HTTP ${response.status}.`);
  }
}

async function listStreamSettingsKeys(store: KeyValueStore): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: STREAM_SETTINGS_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    keys.push(...page.keys.map((key) => key.name));
    if (page.list_complete) {
      break;
    }
    if (!page.cursor) {
      throw new Error("Cloudflare KV did not return a cursor for more stream settings.");
    }
    cursor = page.cursor;
  } while (true);
  return keys;
}

async function storeStreamSettings(
  store: KeyValueStore,
  key: string,
  settings: StreamSettings,
): Promise<void> {
  await store.put(key, JSON.stringify(settings));
}

export async function processLiveStreamAlerts(
  env: CommandEnvironment,
  now: number,
): Promise<void> {
  const store = env.FEEDBACK_CONFIG;
  if (!store) {
    throw new Error("Stream alerts are missing the FEEDBACK_CONFIG KV binding.");
  }

  const alertedLiveStreams = new Set<string>();
  const settingsKeys = await listStreamSettingsKeys(store);
  for (const key of settingsKeys) {
    try {
      const guildId = key.slice(STREAM_SETTINGS_PREFIX.length);
      const rawSettings = await store.get(key);
      if (rawSettings === null) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawSettings);
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throw error;
        }
        console.error(`Stream settings ${key} are invalid JSON.`);
        continue;
      }
      const settings = parseStreamSettings(parsed);
      if (!settings) {
        console.error(`Stream settings ${key} have an invalid format.`);
        continue;
      }

      for (const source of settings.sources) {
        if (source.paused) {
          continue;
        }
        if (
          typeof source.lastCheckedAt === "number" &&
          now - source.lastCheckedAt < STREAM_POLL_INTERVAL_MS
        ) {
          continue;
        }

        source.lastCheckedAt = now;
        try {
          const activity = await getCurrentActivity(env, store, source);
          const liveStream = activity.liveStream;
          if (source.resumePending) {
            source.activeStreamId = liveStream?.id ?? null;
            source.activeStreamAlerted = false;
            source.resumePending = false;
            for (const video of activity.videos) {
              recordObservedVideo(source, video);
            }
            await storeStreamSettings(store, key, settings);
            continue;
          }
          if (
            source.platform === "twitch" &&
            source.activeStreamId &&
            (source.activeStreamAlerted ?? true) &&
            (!liveStream || liveStream.id !== source.activeStreamId)
          ) {
            await markTwitchLiveAlerted(
              store,
              guildId,
              source,
              source.activeStreamId,
              alertedLiveStreams,
            );
          }
          if (!liveStream) {
            source.activeStreamId = null;
            source.activeStreamAlerted = false;
          } else {
            if (source.activeStreamId !== liveStream.id) {
              if (!env.DISCORD_BOT_TOKEN) {
                throw new Error("DISCORD_BOT_TOKEN is not configured.");
              }
              await sendLiveAnnouncement(
                env.DISCORD_BOT_TOKEN,
                settings.channelId,
                source,
                liveStream,
              );
              source.activeStreamId = liveStream.id;
              source.activeStreamAlerted = true;
            } else if (source.activeStreamAlerted === undefined) {
              source.activeStreamAlerted = true;
            }
            if (
              source.platform === "twitch" &&
              source.activeStreamAlerted
            ) {
              await markTwitchLiveAlerted(
                store,
                guildId,
                source,
                liveStream.id,
                alertedLiveStreams,
              );
            }
          }

          const newVideos = getNewVideos(activity.videos, source);
          for (const video of newVideos) {
            if (source.platform === "youtube" && (video.isLive || video.isLiveArchive)) {
              recordObservedVideo(source, video);
              continue;
            }
            if (
              source.platform === "twitch" &&
              video.streamId &&
              await wasTwitchLiveAlerted(
                store,
                guildId,
                source,
                video.streamId,
                alertedLiveStreams,
              )
            ) {
              recordObservedVideo(source, video);
              continue;
            }
            if (!env.DISCORD_BOT_TOKEN) {
              throw new Error("DISCORD_BOT_TOKEN is not configured.");
            }
            await sendVideoAnnouncement(
              env.DISCORD_BOT_TOKEN,
              settings.channelId,
              source,
              video,
            );
            recordObservedVideo(source, video);
          }
          const latestVideo = activity.videos[0];
          if (latestVideo) {
            recordObservedVideo(source, latestVideo);
          }
          await storeStreamSettings(store, key, settings);
        } catch (error) {
          console.error(
            `Could not check stream source ${source.url} for server ${guildId}:`,
            error instanceof Error ? error.message : String(error),
          );
          try {
            await storeStreamSettings(store, key, settings);
          } catch (storeError) {
            console.error(
              `Could not save stream polling state for server ${guildId}:`,
              storeError instanceof Error ? storeError.message : String(storeError),
            );
          }
        }
      }
    } catch (error) {
      console.error(
        `Could not process stream settings ${key}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
