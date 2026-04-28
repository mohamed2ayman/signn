import { api } from './api';
import type { JobStatusResponse } from './types';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 60_000;

export class JobTimeoutError extends Error {
  constructor(public jobId: string) {
    super(`Job ${jobId} did not complete within 60s`);
    this.name = 'JobTimeoutError';
  }
}

export class JobFailedError extends Error {
  constructor(public jobId: string, public reason: string) {
    super(`Job ${jobId} failed: ${reason}`);
    this.name = 'JobFailedError';
  }
}

export interface PollOptions {
  onProgress?: (progress: { clause_index: number; total: number }) => void;
  signal?: AbortSignal;
}

/**
 * Poll a SIGN AI job until completion or 60s timeout.
 * Throws JobTimeoutError on timeout; caller should surface a Retry button
 * that calls pollJob again with the same jobId before re-submitting.
 */
export async function pollJob<T = any>(
  jobId: string,
  options: PollOptions = {},
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_MS) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const status = await api<JobStatusResponse>(`/ai/jobs/${jobId}`);

    if (status.status === 'completed') {
      return (status.result?.result ?? status.result) as T;
    }
    if (status.status === 'failed') {
      throw new JobFailedError(jobId, status.error ?? 'unknown error');
    }
    if (status.progress && options.onProgress) {
      options.onProgress(status.progress);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new JobTimeoutError(jobId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
