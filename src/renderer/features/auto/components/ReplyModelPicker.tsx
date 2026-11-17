import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/renderer/shared/ui';
import { modelChoices, useAutoStore } from '../store/autoStore';

interface Props {
  model: string | undefined;
  onChange: (model: string) => void;
  field: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
}

export function ReplyModelPicker({ model, onChange, field, disabled }: Props) {
  const status = useAutoStore((state) => state.status);
  const models = modelChoices(status);
  const label = models.find(([key]) => key === model)?.[1] ?? model ?? 'Thread model';
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="compact" variant="ghost" aria-label={`Model: ${label}`} data-testid="auto-model" disabled={disabled} className="gap-1 rounded-full px-2.5 font-normal text-foreground-tertiary">
          {label}
          <ChevronDown aria-hidden className="h-3 w-3" />
        </Button>
      </MenuTrigger>
      <MenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          field.current?.focus({ preventScroll: true });
        }}
      >
        <MenuRadioGroup value={model} onValueChange={onChange}>
          {models.map(([key, name]) => (
            <MenuRadioItem key={key} value={key}>{name}</MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
