import type { KeyValueStore } from "./commands/types";

export type LocalDateTimeResult =
  | { status: "valid"; timestamp: number }
  | { status: "invalid" | "ambiguous" };

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
}

export function isValidIanaTimeZone(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    isValidTimeZone(value);
}

export async function readUserTimeZone(
  store: KeyValueStore,
  userId: string,
): Promise<string | null> {
  const value = await store.get(`timezone:${userId}`);
  return value && isValidTimeZone(value) ? value : null;
}

function partsAt(
  timestamp: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function utcFromParts(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date.getTime();
}

function sameParts(
  left: ReturnType<typeof partsAt>,
  right: ReturnType<typeof partsAt>,
): boolean {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute;
}

export function parseLocalDateTime(
  value: unknown,
  timeZone: string,
): LocalDateTimeResult {
  if (typeof value !== "string") {
    return { status: "invalid" };
  }
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) {
    return { status: "invalid" };
  }
  const requested = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (
    requested.year < 1970 ||
    requested.month < 1 ||
    requested.month > 12 ||
    requested.day < 1 ||
    requested.day > 31 ||
    requested.hour > 23 ||
    requested.minute > 59
  ) {
    return { status: "invalid" };
  }
  const targetUtc = utcFromParts(requested);
  const normalized = new Date(targetUtc);
  if (
    normalized.getUTCFullYear() !== requested.year ||
    normalized.getUTCMonth() + 1 !== requested.month ||
    normalized.getUTCDate() !== requested.day
  ) {
    return { status: "invalid" };
  }

  const offsets = new Set<number>();
  const hourMs = 60 * 60 * 1000;
  for (let offset = -48; offset <= 48; offset += 6) {
    const sample = targetUtc + offset * hourMs;
    const localAsUtc = utcFromParts(partsAt(sample, timeZone));
    offsets.add(localAsUtc - sample);
  }

  const candidates = [...offsets]
    .map((offset) => targetUtc - offset)
    .filter((timestamp) =>
      sameParts(partsAt(timestamp, timeZone), requested)
    );
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0) {
    return { status: "invalid" };
  }
  if (uniqueCandidates.length > 1) {
    return { status: "ambiguous" };
  }
  return { status: "valid", timestamp: uniqueCandidates[0] };
}

