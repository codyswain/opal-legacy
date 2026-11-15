import type { AutoAnswer, AutoQuestion, AutoQuestionPart } from '@/types/auto';

/** A question's first sentence, and whatever follows it. */
export interface QuestionText {
  ask: string;
  rest: string;
}

/**
 * The first sentence is the first line up to its first question mark; what
 * follows on that line and below is the rest. A first line with no question
 * mark stays whole.
 */
export function splitQuestion(text: string): QuestionText {
  const [first = '', ...below] = text.split('\n');
  const mark = first.indexOf('?');
  if (mark === -1) return { ask: text.trim(), rest: '' };
  return {
    ask: first.slice(0, mark + 1).trim(),
    rest: [first.slice(mark + 1).trim(), ...below].join('\n').trim(),
  };
}

/** What he has picked so far, by question text. */
export type Picks = Record<string, string | string[]>;

type Ask = Extract<AutoQuestion, { kind: 'ask' }>;

/** One question with one choice: a click on an option answers it at once. */
export const isSingle = (question: Ask): boolean => question.questions.length === 1 && !question.questions[0].multiSelect;

/** A click on an option of a question with several parts or several choices. */
export function pick(picks: Picks, part: AutoQuestionPart, label: string): Picks {
  if (!part.multiSelect) return { ...picks, [part.question]: label };
  const chosen = new Set(Array.isArray(picks[part.question]) ? (picks[part.question] as string[]) : []);
  if (chosen.has(label)) chosen.delete(label);
  else chosen.add(label);
  return { ...picks, [part.question]: [...chosen] };
}

export function isPicked(picks: Picks, part: AutoQuestionPart, label: string): boolean {
  const picked = picks[part.question];
  return Array.isArray(picked) ? picked.includes(label) : picked === label;
}

/** Whether every part has a pick, so the picks can be sent. */
export function picksReady(question: Ask, picks: Picks): boolean {
  return question.questions.every((part) => {
    const picked = picks[part.question];
    return Array.isArray(picked) ? picked.length > 0 : typeof picked === 'string' && picked !== '';
  });
}

/** An option of a single-choice question, clicked. */
export function answerOption(question: Ask, part: AutoQuestionPart, label: string): AutoAnswer {
  return { id: question.id, answers: { [part.question]: label } };
}

/** The picks of a question with several parts, sent together. */
export function answerPicks(question: Ask, picks: Picks): AutoAnswer {
  const answers: Record<string, string | string[]> = {};
  for (const part of question.questions) answers[part.question] = picks[part.question];
  return { id: question.id, answers };
}

/**
 * His own words. They answer every part that has no pick; for a permission
 * request and for a send he is asked to allow they are a "no" with a reason.
 */
export function answerTyped(question: AutoQuestion, text: string, picks: Picks = {}): AutoAnswer {
  if (question.kind === 'permission' || question.kind === 'grant') return { id: question.id, allow: false, message: text };
  const answers: Record<string, string | string[]> = {};
  for (const part of question.questions) {
    const picked = picks[part.question];
    const has = Array.isArray(picked) ? picked.length > 0 : !!picked;
    answers[part.question] = question.questions.length > 1 && has ? picked : text;
  }
  return { id: question.id, answers };
}

/** Allow, for a permission request. A send to allow has no yes here: its yes is signed on his phone. */
export const answerAllow = (question: Extract<AutoQuestion, { kind: 'permission' }>): AutoAnswer => ({ id: question.id, allow: true });

/**
 * The last check before an answer is posted. A send he is asked to allow
 * takes only a "no" from here, whatever built the answer: anything else is
 * dropped, so no click, key or typed word in this app can allow a send.
 */
export function mayAnswer(question: AutoQuestion | null, answer: AutoAnswer): boolean {
  if (question?.kind !== 'grant') return true;
  return answer.id === question.id && answer.allow === false && answer.answers === undefined;
}

/** A question with one part and one choice, whose options the keys 1 to 3 pick: its labels, else none. */
export function keyOptions(question: AutoQuestion | null): string[] {
  if (question?.kind !== 'ask' || !isSingle(question)) return [];
  return question.questions[0].options.slice(0, 3).map((option) => option.label);
}

export function answerDeny(question: AutoQuestion, message: string): AutoAnswer {
  const said = message.trim();
  return said ? { id: question.id, allow: false, message: said } : { id: question.id, allow: false };
}
