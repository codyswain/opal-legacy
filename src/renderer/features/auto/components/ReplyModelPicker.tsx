import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import type { AutoModeChoice, AutoModelChoice } from '@/types/auto';
import { replyChoice } from '@/common/autoReplyModel';
import { Button, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/renderer/shared/ui';
import { modelChoices, useAutoStore } from '../store/autoStore';

interface Props {
  choice?: AutoModelChoice;
  lastModel?: string;
  onChange: (choice: AutoModelChoice) => Promise<void> | void;
  /** The thread's mode, or the one a new thread starts with. Drawn only when the service names modes. */
  mode?: AutoModeChoice;
  onMode?: (mode: AutoModeChoice) => Promise<void> | void;
  field: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
}

type Option = [string, string];
type Kind = 'Model' | 'Effort' | 'Speed' | 'Mode' | 'Agents';

/**
 * The pickers in the box's foot: the model, with its effort and speed when
 * the model has them; then the mode (Solo or Orchestrate), and under
 * Orchestrate the default model for the agents the thread starts. Each is
 * one quiet button with a menu. The choice applies to the next turn.
 */
export function ReplyModelPicker({ choice, lastModel, onChange, mode, onMode, field, disabled }: Props) {
  const status = useAutoStore((state) => state.status);
  const [saving, setSaving] = React.useState(false);
  const model = choice?.model;
  const options = model !== undefined ? status?.modelOptions?.[model] : undefined;
  const modes = status?.modes;

  function picker(kind: Kind, value: string | undefined, choices: Option[], fallback = 'Thread model', prefix = '') {
    const label = prefix + (choices.find(([key]) => key === value)?.[1] ?? value ?? fallback);
    const select = async (key: string) => {
      if (key === value) return;
      let next: AutoModelChoice | AutoModeChoice | null;
      if (kind === 'Model') next = { model: key };
      else if (kind === 'Mode') next = { mode: key, agentsModel: mode?.agentsModel ?? '' };
      else if (kind === 'Agents') next = { mode: mode?.mode ?? '', agentsModel: key };
      else next = replyChoice({ ...choice, [kind === 'Effort' ? 'effort' : 'speed']: key || undefined });
      if (!next) return;
      setSaving(true);
      try {
        if ('mode' in next) await onMode?.(next);
        else await onChange(next);
      } finally {
        setSaving(false);
      }
    };
    return (
      <Menu>
        <MenuTrigger asChild>
          <Button size="compact" variant="ghost" aria-label={`${kind}: ${label}`} data-testid={`auto-${kind.toLowerCase()}`}
            disabled={disabled || saving} className="gap-1 rounded-full px-2 font-normal text-foreground-tertiary">
            {label}<ChevronDown aria-hidden className="h-3 w-3" />
          </Button>
        </MenuTrigger>
        <MenuContent align="start" onCloseAutoFocus={(event) => {
          event.preventDefault();
          field.current?.focus({ preventScroll: true });
        }}>
          {kind === 'Model' && lastModel && <p className="px-2 py-1 text-control text-foreground-tertiary">Last reply used {lastModel}</p>}
          <MenuRadioGroup value={value} onValueChange={(key) => void select(key)}>
            {choices.map(([key, name]) => <MenuRadioItem key={key} value={key}>{name}</MenuRadioItem>)}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    );
  }

  return <>
    {picker('Model', model, modelChoices(status))}
    {options && options.efforts.length > 0 && picker('Effort', choice?.effort ?? '', [
      ['', 'Default effort'], ...options.efforts.map((e): Option => [e, e === 'xhigh' ? 'Extra high' : e[0].toUpperCase() + e.slice(1)]),
    ])}
    {options && Object.keys(options.speeds).length > 0 && picker('Speed', choice?.speed ?? '', [
      ['', 'Standard'], ...Object.entries(options.speeds),
    ])}
    {mode && onMode && modes && Object.keys(modes).length > 1 && picker('Mode', mode.mode, Object.entries(modes), 'Solo')}
    {mode && onMode && modes && mode.mode === 'orchestrate' && picker('Agents', mode.agentsModel, [
      // '' leaves the choice of model to the thread, agent by agent.
      ['', 'Any model'], ...modelChoices(status).filter(([key]) => key !== ''),
    ], 'Any model', 'Agents: ')}
  </>;
}
