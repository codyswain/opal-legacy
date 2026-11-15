import type { AutoStreamMessage } from '@/types/auto';
import { useAutoStore } from './autoStore';
import { useDigestStore } from './digestStore';
import { useThreadStore } from './threadStore';

/** Every stream message from the main process, handed to each store; each takes what is its own. */
export function dispatchStream(message: AutoStreamMessage): void {
  useAutoStore.getState().handle(message);
  useThreadStore.getState().handle(message);
  useDigestStore.getState().handle(message);
}
