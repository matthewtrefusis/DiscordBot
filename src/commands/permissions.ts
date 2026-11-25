import { isRecord } from "./helpers";

const MANAGE_GUILD = 32n;
const ADMINISTRATOR = 8n;

export function canManageServer(interaction: Record<string, unknown>): boolean {
  const member = interaction.member;
  if (!isRecord(member)) {
    return false;
  }

  const permissions = member.permissions;
  if (typeof permissions !== "string" || !/^\d+$/.test(permissions)) {
    return false;
  }

  const value = BigInt(permissions);
  return (value & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n;
}
