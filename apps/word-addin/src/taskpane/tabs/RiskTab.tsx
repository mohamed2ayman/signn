import * as React from 'react';
import type { AuthState } from '../lib/auth';
import type {
  ParseDocxClause,
  ParseDocxResult,
  AsyncJobResponse,
  RiskFinding,
  RiskLevel,
  KnowledgeAsset,
  NegotiationEvent,
} from '../lib/types';
import { api } from '../lib/api';
import {
  pollJob,
  JobTimeoutError,
  JobFailedError,
} from '../lib/jobs';
import {
  readDocumentText,
  anchorClauses,
  applyRiskHighlights,
  clearAllSignHighlights,
  replaceClauseText,
  scrollToClause,
} from '../lib/word';
import { RiskLegend } from '../components/RiskLegend';
import { ClauseProgress } from '../components/ClauseProgress';

interface Props {
  auth: AuthState;
  onAuthLost: () => void;
}

interface AnalysisState {
  clauses: ParseDocxClause[];
  findings: RiskFinding[];
  alternatives: Record<string, KnowledgeAsset | null>;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'analyzing'; clauseIndex: number; total: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string; canRetry: boolean; lastJobId?: string };

export function RiskTab({ auth, onAuthLost }: Props) {
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' });
  const [state, setState] = React.useState<AnalysisState | null>(null);
  const [contractId] = React.useState<string>(`addin-${Date.now()}`);

  const handleAuthError = (e: unknown) => {
    if (e instanceof Error && e.name === 'AuthRequiredError') {
      onAuthLost();
      return true;
    }
    return false;
  };

  const runFullAnalysis = async () => {
    setPhase({ kind: 'parsing' });
    try {
      const fullText = await readDocumentText();
      if (!fullText || fullText.trim().length < 30) {
        setPhase({
          kind: 'error',
          message: 'Document appears empty. Open a contract first.',
          canRetry: false,
        });
        return;
      }
      const parseResult = await api<ParseDocxResult>(
        '/contracts/parse-from-docx',
        { method: 'POST', body: { text: fullText } },
      );

      await clearAllSignHighlights();
      await anchorClauses(parseResult.clauses);

      setPhase({
        kind: 'analyzing',
        clauseIndex: 0,
        total: parseResult.clauses.length,
      });

      const job = await api<AsyncJobResponse>('/ai/risk-analysis', {
        method: 'POST',
        body: {
          contract_id: contractId,
          clauses: parseResult.clauses.map((c) => ({
            id: c.id,
            text: c.text,
          })),
        },
      });

      const result = await pollJob<{ risks?: RiskFinding[] } | RiskFinding[]>(
        job.job_id,
        {
          onProgress: ({ clause_index, total }) =>
            setPhase({ kind: 'analyzing', clauseIndex: clause_index, total }),
        },
      );

      const findings = normalizeFindings(result, parseResult.clauses);
      const alternatives = await loadAlternatives(findings, parseResult.clauses);

      await applyRiskHighlights(
        findings.map((f) => ({
          clause_ref: clauseRefFor(f, parseResult.clauses),
          risk_level: f.risk_level,
        })),
      );

      // Log CLAUSE_FLAGGED events for HIGH risks (fire-and-forget)
      findings
        .filter((f) => f.risk_level === 'HIGH')
        .forEach((f) =>
          logEvent({
            contract_id: contractId,
            clause_ref: clauseRefFor(f, parseResult.clauses),
            event_type: 'CLAUSE_FLAGGED',
            original_text:
              parseResult.clauses.find((c) => c.id === f.clause_id)?.text ?? null,
          }).catch(() => {}),
        );

      setState({
        clauses: parseResult.clauses,
        findings,
        alternatives,
      });
      setPhase({ kind: 'done' });
    } catch (e) {
      if (handleAuthError(e)) return;
      if (e instanceof JobTimeoutError) {
        setPhase({
          kind: 'error',
          message:
            'AI analysis is taking longer than 60 seconds. The job may still finish — try Retry.',
          canRetry: true,
          lastJobId: e.jobId,
        });
        return;
      }
      if (e instanceof JobFailedError) {
        setPhase({
          kind: 'error',
          message: `AI job failed: ${e.reason}`,
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

  const reanalyzeOne = async (clause: ParseDocxClause) => {
    try {
      const job = await api<AsyncJobResponse>('/ai/risk-analysis', {
        method: 'POST',
        body: {
          contract_id: contractId,
          clauses: [{ id: clause.id, text: clause.text }],
        },
      });
      const result = await pollJob<{ risks?: RiskFinding[] } | RiskFinding[]>(
        job.job_id,
      );
      const newFindings = normalizeFindings(result, [clause]);
      if (!state) return;
      const merged = state.findings.filter((f) => f.clause_id !== clause.id);
      merged.push(...newFindings);
      setState({ ...state, findings: merged });
      await applyRiskHighlights(
        merged.map((f) => ({
          clause_ref: clauseRefFor(f, state.clauses),
          risk_level: f.risk_level,
        })),
      );
    } catch (e) {
      if (handleAuthError(e)) return;
    }
  };

  const replace = async (
    clause: ParseDocxClause,
    replacement: KnowledgeAsset,
  ) => {
    try {
      const original = await replaceClauseText(
        clause.clause_ref,
        replacement.content ?? replacement.title,
      );
      await logEvent({
        contract_id: contractId,
        clause_ref: clause.clause_ref,
        event_type: 'CLAUSE_REPLACED',
        original_text: original,
        new_text: replacement.content ?? replacement.title,
      });
      // Re-analyze the now-replaced clause to confirm green
      await reanalyzeOne({
        ...clause,
        text: replacement.content ?? replacement.title,
      });
    } catch (e) {
      if (handleAuthError(e)) return;
    }
  };

  return (
    <div>
      {phase.kind === 'idle' && !state && (
        <div className="sign-card">
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Analyze the open document for clause-level risks. Each clause is
            highlighted in the document with a traffic-light color and listed
            here with a suggested standard alternative.
          </div>
          <button className="sign-button" onClick={runFullAnalysis}>
            Analyze risks
          </button>
        </div>
      )}

      {phase.kind === 'parsing' && (
        <div className="sign-progress">Parsing document into clauses…</div>
      )}

      {phase.kind === 'analyzing' && (
        <ClauseProgress
          clauseIndex={phase.clauseIndex}
          total={phase.total}
        />
      )}

      {phase.kind === 'error' && (
        <div className="sign-card">
          <div className="sign-error" style={{ marginBottom: 8 }}>
            {phase.message}
          </div>
          {phase.canRetry && (
            <button className="sign-button" onClick={runFullAnalysis}>
              Retry
            </button>
          )}
        </div>
      )}

      {state && (
        <>
          <RiskLegend
            findings={state.findings}
            onPick={(level) => {
              const first = state.findings.find((f) => f.risk_level === level);
              if (first) {
                const ref = clauseRefFor(first, state.clauses);
                scrollToClause(ref).catch(() => {});
              }
            }}
          />
          <div style={{ marginTop: 6 }}>
            <button
              className="sign-button sign-button--ghost"
              onClick={runFullAnalysis}
              style={{ marginBottom: 8 }}
            >
              Re-analyze document
            </button>
          </div>
          {state.findings.map((f) => {
            const clause = state.clauses.find((c) => c.id === f.clause_id);
            if (!clause) return null;
            const alt = state.alternatives[f.clause_id];
            return (
              <RiskCard
                key={f.clause_id}
                finding={f}
                clause={clause}
                alternative={alt ?? null}
                onJump={() =>
                  scrollToClause(clause.clause_ref).catch(() => {})
                }
                onReplace={
                  alt
                    ? () => {
                        replace(clause, alt);
                      }
                    : undefined
                }
              />
            );
          })}
        </>
      )}
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────── */

function normalizeFindings(
  raw: any,
  clauses: ParseDocxClause[],
): RiskFinding[] {
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.risks ?? []);
  return arr
    .map((r) => ({
      clause_id: String(r.clause_id ?? r.id ?? ''),
      clause_ref:
        r.clause_ref ??
        clauses.find((c) => c.id === (r.clause_id ?? r.id))?.clause_ref,
      risk_level: (r.risk_level ?? r.level ?? 'LOW').toUpperCase() as RiskLevel,
      description: r.description ?? r.summary ?? '',
      recommendation: r.recommendation ?? r.suggestion,
    }))
    .filter((f) => f.clause_id);
}

function clauseRefFor(f: RiskFinding, clauses: ParseDocxClause[]): string {
  if (f.clause_ref) return f.clause_ref;
  return clauses.find((c) => c.id === f.clause_id)?.clause_ref ?? f.clause_id;
}

async function loadAlternatives(
  findings: RiskFinding[],
  clauses: ParseDocxClause[],
): Promise<Record<string, KnowledgeAsset | null>> {
  const out: Record<string, KnowledgeAsset | null> = {};
  for (const f of findings) {
    if (f.risk_level === 'LOW') {
      out[f.clause_id] = null;
      continue;
    }
    const clause = clauses.find((c) => c.id === f.clause_id);
    if (!clause) {
      out[f.clause_id] = null;
      continue;
    }
    try {
      const tag = clause.clause_type ?? '';
      const assets = await api<KnowledgeAsset[]>(
        `/knowledge-assets?asset_type=CONTRACT_TEMPLATE${
          tag ? `&tag=${encodeURIComponent(tag)}` : ''
        }`,
      );
      out[f.clause_id] = assets[0] ?? null;
    } catch {
      out[f.clause_id] = null;
    }
  }
  return out;
}

async function logEvent(payload: {
  contract_id: string;
  clause_ref: string;
  event_type: string;
  original_text?: string | null;
  new_text?: string;
}): Promise<NegotiationEvent | undefined> {
  return api<NegotiationEvent>('/negotiation/events', {
    method: 'POST',
    body: payload,
  });
}

/* ─── RiskCard subcomponent ────────────────────────────── */

interface RiskCardProps {
  finding: RiskFinding;
  clause: ParseDocxClause;
  alternative: KnowledgeAsset | null;
  onJump: () => void;
  onReplace?: () => void;
}

function RiskCard({
  finding,
  clause,
  alternative,
  onJump,
  onReplace,
}: RiskCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="sign-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span className={`sign-risk-pill sign-risk-pill--${finding.risk_level}`}>
          {finding.risk_level}
        </span>
        <button
          className="sign-button sign-button--ghost"
          style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={onJump}
        >
          Find in doc
        </button>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        {clause.title || clause.clause_ref}
      </div>
      <div style={{ fontSize: 11, color: '#444', marginBottom: 6 }}>
        {finding.description}
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          color: '#4f6ef7',
          cursor: 'pointer',
          padding: 0,
          fontSize: 11,
        }}
      >
        {expanded ? 'Hide original text' : 'Show original text'}
      </button>
      {expanded && (
        <div
          style={{
            fontSize: 11,
            background: '#f7f7fa',
            padding: 6,
            borderRadius: 4,
            marginTop: 4,
            whiteSpace: 'pre-wrap',
          }}
        >
          {clause.text}
        </div>
      )}
      {alternative ? (
        <div style={{ marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: '#1d6d1d', marginBottom: 4 }}>
            Suggested standard alternative: <strong>{alternative.title}</strong>
          </div>
          {onReplace && (
            <button
              className="sign-button"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={onReplace}
            >
              Replace in document
            </button>
          )}
        </div>
      ) : (
        finding.risk_level !== 'LOW' && (
          <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
            No standard alternative in your library.
          </div>
        )
      )}
    </div>
  );
}
