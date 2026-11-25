type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getOption(
  interaction: JsonRecord,
  name: string,
): unknown {
  const data = interaction.data;
  if (!isRecord(data) || !Array.isArray(data.options)) {
    return undefined;
  }

  const option = data.options.find(
    (value) => isRecord(value) && value.name === name,
  );
  return isRecord(option) ? option.value : undefined;
}

export function getUser(
  interaction: JsonRecord,
  optionName?: string,
): JsonRecord | null {
  if (optionName) {
    const userId = getOption(interaction, optionName);
    const data = interaction.data;
    const resolved = isRecord(data) ? data.resolved : undefined;
    const users = isRecord(resolved) ? resolved.users : undefined;
    const user = typeof userId === "string" && isRecord(users)
      ? users[userId]
      : undefined;
    if (isRecord(user)) {
      return user;
    }
    if (typeof userId === "string") {
      return null;
    }
  }

  const member = interaction.member;
  const memberUser = isRecord(member) ? member.user : undefined;
  if (isRecord(memberUser)) {
    return memberUser;
  }
  return isRecord(interaction.user) ? interaction.user : null;
}

export function getDisplayName(user: JsonRecord): string {
  if (typeof user.global_name === "string" && user.global_name.length > 0) {
    return user.global_name;
  }
  if (typeof user.username === "string" && user.username.length > 0) {
    return user.username;
  }
  return "Unknown user";
}
