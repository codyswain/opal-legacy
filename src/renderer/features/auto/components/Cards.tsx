import * as React from 'react';
import { Check } from 'lucide-react';
import type { AutoQuestion, AutoQuestionPart } from '@/types/auto';
import { Button } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { Markdown, MarkdownLinksContext } from '../markdown/Markdown';
import { answerAllow, answerDeny, answerNo, answerOption, answerPicks, isPicked, isSingle, keyOptions, pick, picksReady, splitQuestion } from '../model/questionModel';
import type { EntryCard } from '../model/threadModel';
import { useThreadStore } from '../store/threadStore';

const card = 'rounded-card border border-border-strong p-4';

/** What the service said to an answer it did not take, such as a question that has closed. */
function CardProblem() {
  const problem = useThreadStore((state) => state.cardProblem);
  return problem ? <p role="alert" className="mt-3 text-ui font-medium text-foreground">{problem}</p> : null;
}

type Ask = Extract<AutoQuestion, { kind: 'ask' }>;

/** One option. None is filled in: a filled button reads as already chosen. `hint` is the key that picks it. */
function OptionButton({ question, part, label, description, hint }: { question: Ask; part: AutoQuestionPart; label: string; description: string; hint: string | null }) {
  const picks = useThreadStore((state) => state.picks);
  const single = isSingle(question);
  const picked = !single && isPicked(picks, part, label);
  return (
    <button
      type="button"
      aria-pressed={single ? undefined : picked}
      aria-keyshortcuts={hint ?? undefined}
      onClick={() => {
        const { answer, setPicks } = useThreadStore.getState();
        if (single) void answer(answerOption(question, part, label));
        else setPicks(pick(picks, part, label));
      }}
      className={cn(
        'flex min-h-control items-center gap-2 rounded-control border px-3 py-1.5 text-left text-ui outline-none transition-hover',
        'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
        'border-border-strong text-foreground hover:bg-surface-hover',
        picked && 'border-foreground bg-surface-selected'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-foreground-tertiary">{description}</span> : null}
      </span>
      {picked ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0" /> : null}
      {hint ? <span aria-hidden className="shrink-0 pl-2 font-mono text-metadata text-foreground-tertiary">{hint}</span> : null}
    </button>
  );
}

/**
 * A question: its first sentence in semibold, the rest in regular weight,
 * and the options as buttons. His own words go in the box below the thread,
 * which is the answer field while a question waits. One question with one
 * choice is answered by a click; with several parts or several choices the
 * clicks pick, and Send posts the picks once every part has one.
 */
export function QuestionCard({ question }: { question: Ask }) {
  const picks = useThreadStore((state) => state.picks);
  const single = isSingle(question);
  const { answer } = useThreadStore.getState();
  // One question with one choice: 1 to 3 pick its options while the keyboard is in the card.
  const keys = keyOptions(question);
  return (
    <div
      data-testid="auto-question"
      className={card}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const label = keys[Number(event.key) - 1];
        if (!label) return;
        event.preventDefault();
        void answer(answerOption(question, question.questions[0], label));
      }}
    >
      <div className="flex flex-col gap-4">
        {question.questions.map((part) => {
          const { ask, rest } = splitQuestion(part.question);
          const stacked = part.options.some((option) => option.description);
          return (
            <div key={part.question}>
              <p className="text-reply font-semibold text-foreground">{ask}</p>
              {rest ? <Markdown text={rest} className="mt-2 text-foreground-secondary" /> : null}
              {part.options.length > 0 ? (
                <div className={cn('mt-3 flex gap-1.5', stacked ? 'flex-col' : 'flex-wrap')}>
                  {part.options.map((option, at) => (
                    <OptionButton key={option.label} question={question} part={part} label={option.label} description={option.description} hint={keys[at] === option.label ? String(at + 1) : null} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {single ? null : (
        <Button className="mt-3" data-testid="auto-send-picks" disabled={!picksReady(question, picks)} onClick={() => void answer(answerPicks(question, picks))}>
          Send
        </Button>
      )}
      <CardProblem />
    </div>
  );
}

/**
 * A tool that needs his yes: its title, its detail, Allow and Deny. Words
 * typed in the box below deny it and go back to Auto as the reason.
 */
export function PermissionCard({ question }: { question: Extract<AutoQuestion, { kind: 'permission' }> }) {
  const { answer } = useThreadStore.getState();
  return (
    <div data-testid="auto-permission" className={card}>
      <p className="text-reply font-semibold text-foreground">{question.title || question.tool || 'Allow this?'}</p>
      {question.detail ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-row bg-surface-sunken px-3 py-2 font-mono text-control text-foreground">{question.detail}</pre>
      ) : null}
      {question.reason ? <p className="mt-2 text-ui text-foreground-secondary">{question.reason}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void answer(answerAllow(question))}>Allow</Button>
        <Button variant="outline" onClick={() => void answer(answerDeny(question, ''))}>Deny</Button>
      </div>
      <CardProblem />
    </div>
  );
}

/**
 * A send Auto asks him to allow up front, drawn as his phone draws it: the
 * service's question, which names the channel and the people, the exact
 * words when the request carries them, and its detail on the lines the
 * service gave it. Here he can only say no. The yes is signed on his phone,
 * and nothing in this card, no key and no typed word allows it. Words typed
 * in the box below say no first and then go to the thread as his message.
 */
export function GrantCard({ question }: { question: Extract<AutoQuestion, { kind: 'grant' }> }) {
  const { answer } = useThreadStore.getState();
  return (
    <div data-testid="auto-grant" className={card}>
      <p className="text-reply font-semibold text-foreground">{question.title || 'Allow a send?'}</p>
      {question.text ? (
        <div className="auto-md-block mt-2" data-paste>
          <pre data-testid="auto-grant-words" className="text-reply text-foreground">{question.text}</pre>
        </div>
      ) : null}
      {question.detail ? <p data-testid="auto-grant-detail" className="mt-2 whitespace-pre-line text-ui text-foreground-secondary">{question.detail}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void answer(answerNo(question))}>No</Button>
        <p data-testid="auto-grant-phone" className="text-control text-foreground-tertiary">The yes is on your phone.</p>
      </div>
      <CardProblem />
    </div>
  );
}

const fileName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.(md|mdo)$/i, '');

/** A digest entry: where it came from, its words, and the file it was taken from. */
export function EntryCardView({ entry, title }: { entry: EntryCard; title: string | null }) {
  const { openVault } = React.useContext(MarkdownLinksContext);
  // The thread is named after its entry, so the title shows only when they differ.
  const named = title !== null && entry.title.toLowerCase().startsWith(title.trim().toLowerCase().replace(/…$/, ''));
  const from = entry.from;
  return (
    <div data-testid="auto-entry" className="rounded-card border border-border-subtle bg-surface-sunken p-4">
      <p className="text-metadata text-foreground-tertiary">Digest, {entry.source}</p>
      {/* The priority is a quiet word before the title, as the queue sets it. */}
      {named && !entry.priority ? null : (
        <p className="mt-1 text-reply font-semibold text-foreground">
          {entry.priority ? <span data-testid="auto-entry-priority" className="font-normal text-foreground-tertiary">{entry.priority} </span> : null}
          {entry.title}
        </p>
      )}
      {entry.body ? <Markdown text={entry.body} className="mt-2 text-foreground" /> : null}
      {from ? (
        <p className="mt-3 text-control text-foreground-tertiary">
          From{' '}
          <button
            type="button"
            title={from}
            onClick={(event) => openVault(from, event.metaKey || event.ctrlKey)}
            className="rounded-sm underline decoration-foreground-tertiary/50 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
          >
            {fileName(from)}
          </button>
        </p>
      ) : null}
    </div>
  );
}
