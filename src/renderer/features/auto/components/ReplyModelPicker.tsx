import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import type { AutoModelChoice } from '@/types/auto';
import { replyChoice } from '@/common/autoReplyModel';
import { Button, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/renderer/shared/ui';
import { modelChoices, useAutoStore } from '../store/autoStore';

interface Props {
  choice?: AutoModelChoice;
  lastModel?: string;
  onChange: (choice: AutoModelChoice) => Promise<void> | void;
  field: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
}

type Option = [string, string];

export function ReplyModelPicker({ choice, lastModel, onChange, field, disabled }: Props) {
  const status = useAutoStore((state) => state.status);
  const [saving, setSaving] = React.useState(false);
  const model = choice?.model;
  const options = model !== undefined ? status?.modelOptions?.[model] : undefined;

  function picker(kind: 'Model' | 'Effort' | 'Speed', value: string | undefined, choices: Option[]) {
    const label = choices.find(([key]) => key === value)?.[1] ?? value ?? 'Thread model';
    const select = async (key: string) => {
      if (key === value) return;
      const next = kind === 'Model' ? { model: key }
        : replyChoice({ ...choice, [kind === 'Effort' ? 'effort' : 'speed']: key || undefined });
      if (!next) return;
      setSaving(true);
      try {
        await onChange(next);
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
  </>;
}
