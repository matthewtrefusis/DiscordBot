import { isRecord } from "./helpers";

export interface GuildInfo {
  id: string;
  name: string;
  description?: string;
  approximateMemberCount?: number;
  approximatePresenceCount?: number;
  ownerId?: string;
  preferredLocale?: string;
  verificationLevel?: number;
  boostLevel?: number;
}

export async function fetchGuildInfo(
  botToken: string,
  guildId: string,
): Promise<GuildInfo> {
  const response = await fetch(
    `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}?with_counts=true`,
    {
      headers: { Authorization: `Bot ${botToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Could not read server details (HTTP ${response.status}).`);
  }

  const payload: unknown = await response.json();
  if (
    !isRecord(payload) ||
    payload.id !== guildId ||
    typeof payload.name !== "string"
  ) {
    throw new Error("Discord returned invalid server details.");
  }

  return {
    id: payload.id,
    name: payload.name,
    ...(typeof payload.description === "string"
      ? { description: payload.description }
      : {}),
    ...(typeof payload.approximate_member_count === "number"
      ? { approximateMemberCount: payload.approximate_member_count }
      : {}),
    ...(typeof payload.approximate_presence_count === "number"
      ? { approximatePresenceCount: payload.approximate_presence_count }
      : {}),
    ...(typeof payload.owner_id === "string"
      ? { ownerId: payload.owner_id }
      : {}),
    ...(typeof payload.preferred_locale === "string"
      ? { preferredLocale: payload.preferred_locale }
      : {}),
    ...(typeof payload.verification_level === "number"
      ? { verificationLevel: payload.verification_level }
      : {}),
    ...(typeof payload.premium_tier === "number"
      ? { boostLevel: payload.premium_tier }
      : {}),
  };
}
