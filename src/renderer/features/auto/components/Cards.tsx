import * as React from 'react';
import { Check, Fingerprint } from 'lucide-react';
import type { AutoQuestion, AutoQuestionPart } from '@/types/auto';
import { Button } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { Markdown, MarkdownLinksContext } from '../markdown/Markdown';
import { answerAllow, answerDeny, answerNo, answerOption, answerPicks, isPicked, isSingle, keyOptions, pick, picksReady, splitQuestion } from '../model/questionModel';
import type { EntryCard } from '../model/threadModel';
import { autoApi } from '../store/autoStore';
import { useThreadStore } from '../store/threadStore';

/** A card in a thread: the box's light border, with corners one step under its 16px. */
const card = 'rounded-xl border border-border-default p-4';

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
      {/* Its number shows only while the keyboard is in the card, which is when the number picks it. From the box a digit is typed. */}
      {hint ? <span aria-hidden data-testid="auto-option-key" className="invisible shrink-0 pl-2 font-mono text-metadata text-foreground-tertiary group-focus-within/card:visible">{hint}</span> : null}
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
      className={cn(card, 'group/card')}
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

/** The command that trusts this Mac's key, run on the Mini with the code the card shows. */
export const PAIR_COMMAND = 'sudo sh ~/code/vault/.claude/apps/agent/pair-phone.sh --device macbook-pro';

/** A key's code in three groups, to read across to a keyboard, as the phone shows it. */
const grouped = (code: string): string => code.match(/.{1,4}/g)?.join(' ') ?? code;

type KeyState = { state: 'checking' } | { state: 'paired' } | { state: 'unpaired' } | { state: 'pairing' } | { state: 'offered'; code: string };

/** Whether this Mac's key is trusted, checked when the card opens and again on request. Makes no key. */
function useSendKey(): [KeyState, () => void, () => Promise<void>, string | null] {
  const [key, setKey] = React.useState<KeyState>({ state: 'checking' });
  const [problem, setProblem] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => () => {
    alive.current = false;
  }, []);
  const check = React.useCallback(() => {
    void autoApi()?.sendKey().then(
      (result) => {
        if (!alive.current) return;
        // A check that failed leaves Allow in place: the service still decides, and says so.
        setKey({ state: !result.success || result.data.paired ? 'paired' : 'unpaired' });
      },
      () => alive.current && setKey({ state: 'paired' }),
    );
  }, []);
  React.useEffect(check, [check]);
  const pair = React.useCallback(async () => {
    setProblem(null);
    setKey({ state: 'pairing' });
    const result = await autoApi()?.pairMac().catch((): null => null);
    if (!alive.current) return;
    if (result?.success) setKey({ state: 'offered', code: result.data.code });
    else {
      setKey({ state: 'unpaired' });
      setProblem(result?.error.message ?? "Can't reach Auto.");
    }
  }, []);
  return [key, check, pair, problem];
}

/**
 * A send Auto asks him to allow up front, drawn as his phone draws it: the
 * service's question, which names the channel and the people, the exact
 * words when the request carries them, and its detail on the lines the
 * service gave it. Allow asks for Touch ID; the main process signs the
 * grant's own fields with this Mac's key and answers. Until the Mini trusts
 * this Mac, the card offers to pair it instead. Words typed in the box below
 * say no first and then go to the thread as his message.
 */
export function GrantCard({ question }: { question: Extract<AutoQuestion, { kind: 'grant' }> }) {
  const { answer, allowSend } = useThreadStore.getState();
  const [key, check, pair, pairProblem] = useSendKey();
  const [waiting, setWaiting] = React.useState(false);
  const allow = async () => {
    setWaiting(true);
    await allowSend(question);
    setWaiting(false);
  };
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
        {question.send && key.state === 'paired' ? (
          <Button data-testid="auto-grant-allow" disabled={waiting} onClick={() => void allow()}>
            <Fingerprint aria-hidden className="h-3.5 w-3.5" />
            Allow
          </Button>
        ) : null}
        <Button variant="outline" disabled={waiting} onClick={() => void answer(answerNo(question))}>No</Button>
        {question.send && (key.state === 'unpaired' || key.state === 'pairing') ? (
          <Button data-testid="auto-grant-pair" variant="outline" disabled={key.state === 'pairing'} onClick={() => void pair()}>
            Pair this Mac
          </Button>
        ) : null}
        {waiting ? <p className="text-control text-foreground-tertiary">Waiting for Touch ID…</p> : null}
        {!question.send ? <p data-testid="auto-grant-phone" className="text-control text-foreground-tertiary">The yes is on your phone.</p> : null}
      </div>
      {key.state === 'offered' ? (
        <div data-testid="auto-grant-pairing" className="mt-3 text-ui text-foreground-secondary">
          <p>
            This Mac&apos;s code is <span data-testid="auto-grant-code" className="font-mono font-medium text-foreground">{grouped(key.code)}</span>. On the Mini, run this and type the code:
          </p>
          <Markdown text={`\`\`\`\n${PAIR_COMMAND}\n\`\`\``} className="mt-2" />
          <Button className="mt-2" variant="outline" onClick={check}>Check again</Button>
        </div>
      ) : null}
      {pairProblem ? <p role="alert" className="mt-3 text-ui font-medium text-foreground">{pairProblem}</p> : null}
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
    <div data-testid="auto-entry" className="rounded-xl border border-border-subtle bg-surface-sunken p-4">
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
