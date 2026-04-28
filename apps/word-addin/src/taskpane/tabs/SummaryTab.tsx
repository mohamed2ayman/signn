import * as React from 'react';
import type { AuthState } from '../lib/auth';
import { api } from '../lib/api';
import {
  pollJob,
  JobTimeoutError,
  JobFailedError,
} from '../lib/jobs';
import { readDocumentText } from '../lib/word';
import type { AsyncJobResponse } from '../lib/types';

interface Props {
  auth: AuthState;
  onAuthLost: () => void;
}

interface SummaryResult {
  summary?: string;
  highlights?: string[];
  parties?: string[];
  key_dates?: string[];
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; result: SummaryResult }
  | { kind: 'error'; message: string; canRetry: boolean };

export function SummaryTab({ onAuthLost }: Props) {
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' });

  const summarize = async () => {
    setPhase({ kind: 'busy' });
    try {
      const fullText = await readDocumentText();
      if (!fullText || fullText.trim().length < 30) {
        setPhase({
          kind: 'error',
          message: 'Document appears empty.',
          canRetry: false,
        });
        return;
      }
      const job = await api<AsyncJobResponse>('/ai/summarize', {
        method: 'POST',
        body: {
          contract_id: `addin-${Date.now()}`,
          full_text: fullText,
        },
      });
      const result = await pollJob<SummaryResult>(job.job_id);
      setPhase({ kind: 'done', result });
    } catch (e) {
      if (e instanceof Error && e.name === 'AuthRequiredError') {
        onAuthLost();
        return;
      }
      if (e instanceof JobTimeoutError) {
        setPhase({
          kind: 'error',
          message: 'Summary did not complete within 60s.',
          canRetry: true,
        });
        return;
      }
      if (e instanceof JobFailedError) {
        setPhase({
          kind: 'error',
          message: `AI failed: ${e.reason}`,
          canRetry: true,
        });
        return;
      }
      setPhase({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Unknown error',
        canRetry: true,
      });
    }
  };

  return (
    <div>
      {phase.kind === 'idle' && (
        <div className="sign-card">
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Generate an AI summary of the open document — key terms, parties,
            and dates.
          </div>
          <button className="sign-button" onClick={summarize}>
            Summarize document
          </button>
        </div>
      )}
      {phase.kind === 'busy' && (
        <div className="sign-progress">Generating summary…</div>
      )}
      {phase.kind === 'error' && (
        <div className="sign-card">
          <div className="sign-error" style={{ marginBottom: 8 }}>
            {phase.message}
          </div>
          {phase.canRetry && (
            <button className="sign-button" onClick={summarize}>
              Retry
            </button>
          )}
        </div>
      )}
      {phase.kind === 'done' && (
        <>
          <div className="sign-card">
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Summary
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {phase.result.summary ?? 'No summary returned.'}
            </div>
          </div>
          {phase.result.highlights && phase.result.highlights.length > 0 && (
            <div className="sign-card">
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Key highlights
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                {phase.result.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            className="sign-button sign-button--ghost"
            onClick={summarize}
          >
            Re-summarize
          </button>
        </>
      )}
    </div>
  );
}
