import type { KeyValueStore } from "./types";

export function reportSettingsKey(guildId: string): string {
  return `report-settings:${guildId}`;
}

export async function readReportChannel(
  store: KeyValueStore,
  guildId: string,
): Promise<string | null> {
  const channelId = await store.get(reportSettingsKey(guildId));
  if (channelId === null) {
    return null;
  }
  if (!/^\d{17,20}$/.test(channelId)) {
    console.error(`Report channel for server ${guildId} is invalid.`);
    throw new Error("Stored report channel is invalid.");
  }
  return channelId;
}
