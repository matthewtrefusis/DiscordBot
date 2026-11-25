import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import type { DiscordCommand, KeyValueStore } from "./types";

function selfRolesKey(guildId: string): string {
  return `self-roles:${guildId}`;
}

async function readAllowedRoles(
  store: KeyValueStore,
  guildId: string,
): Promise<string[]> {
  const raw = await store.get(selfRolesKey(guildId));
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Self-role settings for server ${guildId} are invalid JSON.`);
      throw new Error("Self-role settings are invalid.");
    }
    throw error;
  }
  if (!Array.isArray(parsed) || !parsed.every((role) =>
    typeof role === "string" && /^\d{17,20}$/.test(role)
  )) {
    console.error(`Self-role settings for server ${guildId} have an invalid format.`);
    throw new Error("Self-role settings are invalid.");
  }
  return [...new Set(parsed)];
}

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

const RESTRICTED_ROLE_PERMISSIONS = [
  2n,
  4n,
  8n,
  16n,
  32n,
  128n,
  8192n,
  4194304n,
  8388608n,
  16777216n,
  134217728n,
  268435456n,
  536870912n,
  1073741824n,
  8589934592n,
  17179869184n,
  1099511627776n,
].reduce((combined, permission) => combined | permission, 0n);

const selfRoleAddCommand = {
  name: "self-role-add",
  description: "Allow members to assign or remove a role themselves.",
  default_member_permissions: "32",
  options: [{
    type: 8,
    name: "role",
    description: "The role members may toggle.",
    required: true,
  }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const roleId = getOption(interaction, "role");
    if (!canManageServer(interaction)) {
      return { content: "You need Manage Server permission to configure self-roles.", ephemeral: true };
    }
    if (!isSnowflake(guildId) || !isSnowflake(roleId) || roleId === guildId) {
      return { content: "Choose a role in this server.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return { content: "Self-role settings are temporarily unavailable.", ephemeral: true };
    }
    try {
      const data = interaction.data;
      const resolved = isRecord(data) ? data.resolved : undefined;
      const roles = isRecord(resolved) ? resolved.roles : undefined;
      const role = isRecord(roles) ? roles[roleId] : undefined;
      if (!isRecord(role) || role.managed === true ||
          typeof role.permissions !== "string" || !/^\d+$/.test(role.permissions)) {
        return { content: "That role cannot be configured for self-assignment.", ephemeral: true };
      }
      const permissions = BigInt(role.permissions);
      if ((permissions & RESTRICTED_ROLE_PERMISSIONS) !== 0n) {
        return { content: "Roles with administrator, moderation, or management permissions cannot be self-assigned.", ephemeral: true };
      }
      const allowed = await readAllowedRoles(env.FEEDBACK_CONFIG, guildId);
      if (!allowed.includes(roleId)) allowed.push(roleId);
      await env.FEEDBACK_CONFIG.put(selfRolesKey(guildId), JSON.stringify(allowed));
      return { content: `Members can now toggle <@&${roleId}> using \`/self-role\`.`, ephemeral: true };
    } catch (error) {
      console.error("Could not add self-role:", error instanceof Error ? error.message : String(error));
      return { content: "The self-role could not be configured. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const selfRoleRemoveCommand = {
  name: "self-role-remove",
  description: "Remove a role from the self-assignment list.",
  default_member_permissions: "32",
  options: [{
    type: 8,
    name: "role",
    description: "The role members may no longer toggle.",
    required: true,
  }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const roleId = getOption(interaction, "role");
    if (!canManageServer(interaction)) {
      return { content: "You need Manage Server permission to configure self-roles.", ephemeral: true };
    }
    if (!isSnowflake(guildId) || !isSnowflake(roleId) || !env.FEEDBACK_CONFIG) {
      return { content: "Choose a role in a server with configured storage.", ephemeral: true };
    }
    try {
      const allowed = await readAllowedRoles(env.FEEDBACK_CONFIG, guildId);
      await env.FEEDBACK_CONFIG.put(
        selfRolesKey(guildId),
        JSON.stringify(allowed.filter((id) => id !== roleId)),
      );
      return { content: `Removed <@&${roleId}> from the self-assignment list.`, ephemeral: true };
    } catch (error) {
      console.error("Could not remove self-role:", error instanceof Error ? error.message : String(error));
      return { content: "The self-role could not be removed. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

const selfRoleCommand = {
  name: "self-role",
  description: "Toggle one of this server's configured self-assignable roles.",
  options: [{
    type: 8,
    name: "role",
    description: "The role to add or remove.",
    required: true,
  }],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const roleId = getOption(interaction, "role");
    const member = isRecord(interaction.member) ? interaction.member : undefined;
    const user = member && isRecord(member.user) ? member.user : undefined;
    const userId = user?.id;
    if (!isSnowflake(guildId) || !isSnowflake(roleId) || !isSnowflake(userId)) {
      return { content: "Self-roles can only be used in a server.", ephemeral: true };
    }
    if (!env.FEEDBACK_CONFIG || !env.DISCORD_BOT_TOKEN) {
      console.error("Self-roles are missing their KV binding or bot token.");
      return { content: "Self-roles are temporarily unavailable.", ephemeral: true };
    }
    try {
      const allowed = await readAllowedRoles(env.FEEDBACK_CONFIG, guildId);
      if (!allowed.includes(roleId)) {
        return { content: "That role is not available for self-assignment.", ephemeral: true };
      }
      const roles = Array.isArray(member?.roles)
        ? member.roles.filter(isSnowflake)
        : [];
      const hasRole = roles.includes(roleId);
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        {
          method: hasRole ? "DELETE" : "PUT",
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        },
      );
      if (!response.ok) {
        console.error(`Discord self-role change returned HTTP ${response.status}.`);
        return {
          content: response.status === 403
            ? "The bot needs Manage Roles permission and a role higher than this role."
            : "Discord could not update that role. Please try again later.",
          ephemeral: true,
        };
      }
      return { content: `${hasRole ? "Removed" : "Added"} <@&${roleId}>.`, ephemeral: true };
    } catch (error) {
      console.error("Could not toggle self-role:", error instanceof Error ? error.message : String(error));
      return { content: "The role could not be updated. Please try again later.", ephemeral: true };
    }
  },
} satisfies DiscordCommand;

export { selfRoleAddCommand, selfRoleRemoveCommand, selfRoleCommand };
