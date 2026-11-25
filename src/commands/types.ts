export interface CommandContext {
  interaction: Record<string, unknown>;
  username: string;
}

export interface CommandOption {
  type: 3 | 4 | 6;
  name: string;
  description: string;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
}

export interface DiscordCommand {
  name: string;
  description: string;
  options?: CommandOption[];
  execute(context: CommandContext): string;
}
