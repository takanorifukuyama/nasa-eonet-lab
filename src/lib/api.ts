import { invoke, isTauri } from '@tauri-apps/api/core';
import { API_URL } from './eonet';
import type { EonetResponse, Status } from './eonet';

export const MAX_EVENTS = 700;
const REQUEST_TIMEOUT_MS = 30_000;
export type FetchEventsOptions = { days: number; status: Status; limit?: number };
export type FetchEventsErrorReason = 'network' | 'timeout' | 'invalid-response' | 'invalid-request';
const messages: Record<FetchEventsErrorReason, string> = {
  network: 'データを取得できませんでした。接続を確認して、もう一度お試しください。',
  timeout: 'データの取得に時間がかかっています。時間をおいて、もう一度お試しください。',
  'invalid-response': 'データを読み込めませんでした。時間をおいて、もう一度お試しください。',
  'invalid-request': '取得条件を確認して、もう一度お試しください。',
};

export class FetchEventsError extends Error {
  readonly reason: FetchEventsErrorReason;
  constructor(reason: FetchEventsErrorReason) {
    super(messages[reason]);
    this.name = 'FetchEventsError';
    this.reason = reason;
  }
}

function validateResponse(value: unknown): EonetResponse {
  if (!value || typeof value !== 'object' || !('events' in value) || !Array.isArray(value.events)) {
    throw new FetchEventsError('invalid-response');
  }
  return value as EonetResponse;
}

/** Desktop uses the Rust bridge; the browser requests the same fixed public feed. */
export async function fetchEvents(
  { days, status, limit = MAX_EVENTS }: FetchEventsOptions,
  signal?: AbortSignal,
): Promise<EonetResponse> {
  if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS ||
    !['all', 'open', 'closed'].includes(status)) throw new FetchEventsError('invalid-request');
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');

  const controller = new AbortController();
  let timedOut = false;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  // Native commands cannot be physically cancelled. The race lets the UI move
  // on safely and ignores their eventual result after abort or timeout.
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    controller.abort();
    rejectAbort?.(new DOMException('Request cancelled', 'AbortError'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    cancel();
  }, REQUEST_TIMEOUT_MS);

  try {
    const request = isTauri()
      ? invoke<unknown>('fetch_eonet', { days, status, limit })
      : (async () => {
        const url = new URL(API_URL);
        url.searchParams.set('days', String(days));
        url.searchParams.set('status', status);
        url.searchParams.set('limit', String(limit));
        const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new FetchEventsError('network');
        try {
          return await response.json() as unknown;
        } catch {
          if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
          throw new FetchEventsError('invalid-response');
        }
      })();
    return validateResponse(await Promise.race([request, aborted]));
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (timedOut) throw new FetchEventsError('timeout');
    if (error instanceof FetchEventsError) throw error;
    throw new FetchEventsError('network');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
