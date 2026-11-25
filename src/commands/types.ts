export interface CommandEnvironment {
  DISCORD_BOT_TOKEN?: string;
  FEEDBACK_CONFIG?: KeyValueStore;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface CommandContext {
  env: CommandEnvironment;
  interaction: Record<string, unknown>;
  username: string;
}

export interface CommandResponse {
  content: string;
  ephemeral?: boolean;
  backgroundTask?: Promise<string>;
}

export type CommandResult = string | CommandResponse;

export interface CommandOption {
  type: 3 | 4 | 6 | 7;
  name: string;
  description: string;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  channel_types?: number[];
}

export interface DiscordCommand {
  name: string;
  description: string;
  options?: CommandOption[];
  default_member_permissions?: string;
  execute(context: CommandContext): CommandResult | Promise<CommandResult>;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
