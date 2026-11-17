import type { AutoModelChoice, AutoModelOptions } from '@/types/auto';

export const validModel = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{0,32}$/.test(value);

export const visibleModel = (key: string): boolean =>
  !/^codex-gpt-5--6(?:-|$)/.test(key) && !['codex-gpt-6-astra', 'codex-gpt-6-sol'].includes(key);

const validOption = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(value);

/** Read only selection fields, including from a whole thread or a stored preference. */
export function replyChoice(input: { model?: unknown; effort?: unknown; speed?: unknown }): AutoModelChoice | null {
  if (!validModel(input.model)) return null;
  const choice: AutoModelChoice = { model: input.model };
  for (const key of ['effort', 'speed'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!validOption(value)) return null;
    choice[key] = value;
  }
  return choice;
}

export function readModelOptions(value: unknown): AutoModelOptions {
  const options = value as Partial<AutoModelOptions> | null;
  const efforts = Array.isArray(options?.efforts) ? options.efforts.slice(0, 16).filter(validOption) : [];
  const speeds: Record<string, string> = {};
  for (const [key, name] of Object.entries(options?.speeds ?? {}).slice(0, 16)) {
    if (validOption(key) && typeof name === 'string' && name) speeds[key] = name.slice(0, 32);
  }
  return { efforts, speeds };
}
