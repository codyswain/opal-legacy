import { execFile } from 'child_process';
import { createHash } from 'crypto';
import type * as fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import type { AutoGrantSend } from '@/types/auto';

/*
 * Allowing one of Auto's sends from this Mac. The yes is a signature made by
 * a key in this Mac's Secure Enclave, after Touch ID, over the same lines his
 * phone signs. The bytes are built here, from the grant the card showed, and
 * never come from the page.
 */

/** The name this Mac's key goes by on the service, beside the phone's. */
export const DEVICE = 'macbook-pro';

/** Where the helper keeps the key's handle; a file only this Mac's Secure Enclave can use. */
export const keyFile = (home = os.homedir()): string => path.join(home, 'Library/Application Support/Opal/auto-send-key.blob');

const sha256hex = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');

/**
 * What is signed, byte for byte the service's grants.grant_text: this grant,
 * this thread, this channel, exactly these places, until this second, and
 * the hash of the words when he is shown them first.
 */
export function grantBytes(send: AutoGrantSend): Buffer {
  let text = `auto-grant-v1\n${send.id}\n${send.threadId}\n${send.channel}\n${send.to.map((place) => place.id).join(',')}\n${Math.trunc(send.expires)}\n`;
  if (send.text) text += `${sha256hex(send.text)}\n`;
  return Buffer.from(text, 'utf8');
}

const CHANNEL_WORDS: Record<string, string> = { slack: 'one Slack message', email: 'one email', text: 'one text' };

/** What Touch ID says he is allowing: "Let Auto send one Slack message to Jack Newsom". */
export function grantReason(send: AutoGrantSend): string {
  const names = send.to.map((place) => place.name.trim() || place.id);
  const shown = names.length <= 3 ? names : [...names.slice(0, 2), `${names.length - 2} others`];
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  const reason = `Let Auto send ${CHANNEL_WORDS[send.channel] ?? 'one message'} to ${list}`;
  return reason.length > 200 ? `${reason.slice(0, 199)}…` : reason;
}

/** A key's short code, worked out as the service and pair-phone.sh do: the first 12 hex digits of the SHA-256 of the line and a newline. */
export const keyCode = (line: string): string => sha256hex(`${line.trim()}\n`).slice(0, 12);

/** A public key line: the 65-byte point, uncompressed, in base64. */
export const validKeyLine = (line: string): boolean => {
  if (!/^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$/.test(line)) return false;
  const point = Buffer.from(line, 'base64');
  return point.length === 65 && point[0] === 0x04;
};

export class SignerError extends Error {
  constructor(message: string, readonly cancelled = false) {
    super(message);
  }
}

export interface SendSigner {
  /** Whether a key has been made on this Mac. */
  hasKey: () => Promise<boolean>;
  /** The public key line, making the key if there is none. Asks for no fingerprint. */
  publicKey: () => Promise<string>;
  /** A base64 DER signature over `bytes`, after Touch ID with `reason`. Throws SignerError. */
  sign: (bytes: Buffer, reason: string) => Promise<string>;
}

type ExecFile = (
  file: string,
  args: string[],
  options: { timeout: number },
  input: Buffer | null,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const run: ExecFile = (file, args, options, input) =>
  new Promise((resolve) => {
    const child = execFile(file, args, { timeout: options.timeout, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.end(input ?? undefined);
  });

/**
 * The helper in native/opal-signer, at build/native under the app's folder. The packaged app copies
 * the whole folder (asar is off, and package.json's forge config takes no extra resources), so the
 * same path holds packaged and from a checkout.
 */
export function signerPath(_packaged: boolean, _resources: string, appPath: string): string {
  return path.join(appPath, 'build', 'native', 'opal-signer');
}

const firstLine = (text: string): string => text.trim().split('\n')[0]?.slice(0, 300) ?? '';

export function helperSigner(deps: { helper: string; fs: Pick<typeof fsPromises, 'access'>; home?: string; exec?: ExecFile }): SendSigner {
  const exec = deps.exec ?? run;
  const missing = () => new SignerError('Opal has no signer for sends. Rebuild it with npm run build:signer.');
  return {
    hasKey: () => deps.fs.access(keyFile(deps.home)).then(() => true, () => false),
    publicKey: async () => {
      if (!(await deps.fs.access(deps.helper).then(() => true, () => false))) throw missing();
      const out = await exec(deps.helper, ['pubkey'], { timeout: 20_000 }, null);
      const line = out.stdout.trim();
      if (out.code !== 0 || !validKeyLine(line)) throw new SignerError(firstLine(out.stderr) || 'This Mac could not make its key.');
      return line;
    },
    sign: async (bytes, reason) => {
      if (!(await deps.fs.access(deps.helper).then(() => true, () => false))) throw missing();
      // Touch ID waits for him; a minute is long enough to reach the key.
      const out = await exec(deps.helper, ['sign', '--reason', reason], { timeout: 90_000 }, bytes);
      const signature = out.stdout.trim();
      if (out.code === 2) throw new SignerError(firstLine(out.stderr) || 'Not confirmed. Nothing was sent.', true);
      if (out.code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 400) {
        throw new SignerError(firstLine(out.stderr) || 'This Mac could not sign the send. Nothing was sent.');
      }
      return signature;
    },
  };
}
