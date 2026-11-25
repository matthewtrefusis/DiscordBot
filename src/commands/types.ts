export interface CommandEnvironment {
  DISCORD_BOT_TOKEN?: string;
  FEEDBACK_CONFIG?: KeyValueStore;
  YOUTUBE_API_KEY?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface CommandContext {
  env: CommandEnvironment;
  interaction: Record<string, unknown>;
  username: string;
  requestUrl: string;
}

export interface CommandResponse {
  content: string;
  ephemeral?: boolean;
  backgroundTask?: Promise<string>;
}

export interface AutocompleteChoice {
  name: string;
  value: string;
}

export interface InteractionCallback {
  type: 4 | 7;
  data: Record<string, unknown>;
}

export type CommandResult = string | CommandResponse;

export interface CommandOption {
  type: 3 | 4 | 6 | 7 | 8;
  name: string;
  description: string;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  channel_types?: number[];
  autocomplete?: boolean;
  choices?: { name: string; value: string | number }[];
}

export interface DiscordCommand {
  type?: 1 | 2 | 3;
  name: string;
  description?: string;
  options?: CommandOption[];
  default_member_permissions?: string;
  autocomplete?(context: CommandContext): Promise<AutocompleteChoice[]>;
  component?(context: CommandContext): Promise<InteractionCallback>;
  execute(context: CommandContext): CommandResult | Promise<CommandResult>;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
