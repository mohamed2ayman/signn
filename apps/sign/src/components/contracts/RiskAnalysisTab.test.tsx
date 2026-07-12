import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import RiskAnalysisTab from '@/components/contracts/RiskAnalysisTab';
import { riskAnalysisService } from '@/services/api/riskAnalysisService';
import type { RiskAnalysis } from '@/types';

// react-i18next: t() returns the key (codebase test convention).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? String(opts.defaultValue) : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Mock at the service level so axios.ts (which imports the Redux store as a
// side effect) is never loaded (lesson #37).
vi.mock('@/services/api/riskAnalysisService', () => ({
  riskAnalysisService: {
    startRephrase: vi.fn(),
    pollRephrase: vi.fn(),
    applyRephrase: vi.fn(),
    editProposal: vi.fn(),
    getVisibility: vi.fn(),
    setVisibility: vi.fn(),
  },
}));

// Stub RiskCard — this suite tests RiskAnalysisTab's grouping + the
// RecommendationBlock, not RiskCard internals (and avoids its transitive
// ClauseReviewCard import).
vi.mock('@/components/contracts/RiskCard', () => ({
  default: ({ risk }: { risk: RiskAnalysis }) => (
    <div data-testid="risk-card">{risk.risk_level}</div>
  ),
}));

const svc = riskAnalysisService as unknown as {
  startRephrase: ReturnType<typeof vi.fn>;
  pollRephrase: ReturnType<typeof vi.fn>;
  applyRephrase: ReturnType<typeof vi.fn>;
  editProposal: ReturnType<typeof vi.fn>;
  getVisibility: ReturnType<typeof vi.fn>;
  setVisibility: ReturnType<typeof vi.fn>;
};

function mkRisk(over: Partial<RiskAnalysis> & { id: string }): RiskAnalysis {
  return {
    contract_id: 'c1',
    contract_clause_id: 'cc-' + over.id,
    risk_category: 'Payment Terms',
    risk_level: 'HIGH',
    description: 'desc ' + over.id,
    recommendation: 'rec ' + over.id,
    citation_source: null,
    citation_excerpt: null,
    status: 'OPEN',
    handled_by: null,
    handled_at: null,
    created_at: '2026-01-01',
    ...over,
  } as RiskAnalysis;
}

// A risk in a given document + clause (grouping inputs).
function withClause(
  r: RiskAnalysis,
  docId: string,
  docLabel: string,
  clauseTitle: string,
): RiskAnalysis {
  return {
    ...r,
    contract_clause: {
      id: r.contract_clause_id!,
      contract_id: 'c1',
      clause_id: 'cl-' + r.id,
      section_number: '7',
      order_index: 0,
      customizations: null,
      created_at: '2026-01-01',
      clause: {
        id: 'cl-' + r.id,
        organization_id: null,
        title: clauseTitle,
        content: 'clause body ' + r.id,
        clause_type: null,
        version: 1,
        parent_clause_id: null,
        is_active: true,
        created_by: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        source_document: {
          id: docId,
          contract_id: 'c1',
          organization_id: 'o1',
          file_name: docLabel,
          document_priority: 1,
          document_label: docLabel,
          processing_job_id: null,
        } as any,
      },
    } as any,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Overrides load on mount; default to "no overrides" + a resolving persist.
  svc.getVisibility.mockResolvedValue({});
  svc.setVisibility.mockResolvedValue({});
});

describe('RiskAnalysisTab — grouping + order', () => {
  it('groups risks by document; first section expanded, second collapsed', () => {
    const risks = [
      withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1'),
      withClause(mkRisk({ id: 'b' }), 'docB', 'Conditions', 'Clause B1'),
    ];
    render(
      <RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />,
    );
    // Both document section headers render.
    expect(screen.getByText('Agreement')).toBeInTheDocument();
    expect(screen.getByText('Conditions')).toBeInTheDocument();
    // First doc expanded → its clause is visible; second collapsed → hidden.
    expect(screen.getByText('Clause A1')).toBeInTheDocument();
    expect(screen.queryByText('Clause B1')).not.toBeInTheDocument();
    // Expanding the second reveals its clause.
    fireEvent.click(screen.getByText('Conditions'));
    expect(screen.getByText('Clause B1')).toBeInTheDocument();
  });
});

describe('RiskAnalysisTab — recommendation states', () => {
  it('EDITING: Edit → textarea → Apply opens a confirm dialog → Confirm saves via onAnnotate (FIX 2)', async () => {
    const onAnnotate = vi.fn().mockResolvedValue(undefined);
    const risks = [withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1')];
    render(
      <RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={onAnnotate} onRephraseApplied={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByPlaceholderText('Recommendation…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'my new advice' } });
    // Apply alone does NOT save — it opens the confirm dialog.
    fireEvent.click(screen.getByText('Apply'));
    expect(screen.getByText('Save changes to this recommendation?')).toBeInTheDocument();
    expect(onAnnotate).not.toHaveBeenCalled();
    // Confirm → saves.
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() =>
      expect(onAnnotate).toHaveBeenCalledWith('a', { recommendation: 'my new advice' }),
    );
  });

  it('CONFIRM DIALOG cancel does NOT save; stays in editing (FIX 2)', async () => {
    const onAnnotate = vi.fn().mockResolvedValue(undefined);
    const risks = [withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1')];
    render(
      <RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={onAnnotate} onRephraseApplied={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByPlaceholderText('Recommendation…'), {
      target: { value: 'discarded edit' },
    });
    fireEvent.click(screen.getByText('Apply'));
    // Two "Cancel" now: the editing one + the dialog's (rendered last).
    const cancels = screen.getAllByText('Cancel');
    fireEvent.click(cancels[cancels.length - 1]);
    // Dialog closed, nothing saved, textarea still there (still editing).
    expect(screen.queryByText('Save changes to this recommendation?')).not.toBeInTheDocument();
    expect(onAnnotate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Recommendation…')).toBeInTheDocument();
  });

  it('MERGED state hydrates from merged_at on load (persists across reload — FIX 1)', () => {
    const base = withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1');
    const risk: RiskAnalysis = { ...base, merged_at: '2026-07-07T00:00:00Z' };
    render(
      <RiskAnalysisTab contractId="c1" risks={[risk]} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />,
    );
    // Collapsed MERGED note is shown; the editable recommendation area is not.
    expect(
      screen.getByText('Clause updated with the re-phrased version.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Re-phrase clause (AI)')).not.toBeInTheDocument();
  });

  it('MERGE happy path: proposal → Merge → Merge & Apply calls applyRephrase(accept) + refresh', async () => {
    svc.applyRephrase.mockResolvedValue({ applied: true, action: 'accept' });
    const onRephraseApplied = vi.fn();
    const base = withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1');
    // Hydrate a pending proposal so the proposed panel renders without polling.
    const risk: RiskAnalysis = {
      ...base,
      proposed_contract_clause_id: 'pcc-a',
      proposed_contract_clause: {
        id: 'pcc-a',
        clause: { title: 'Clause A1', content: 'safer rewritten body' },
      } as any,
    };
    render(
      <RiskAnalysisTab contractId="c1" risks={[risk]} onAnnotate={vi.fn()} onRephraseApplied={onRephraseApplied} />,
    );
    // Proposed replacement panel is visible.
    expect(screen.getByText('safer rewritten body')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Merge'));
    // Merge confirmation modal opens; "mark handled" checkbox is CHECKED by default.
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByText('Merge & Apply'));
    // markHandled=true passed through (TASK 3).
    await waitFor(() =>
      expect(svc.applyRephrase).toHaveBeenCalledWith('a', 'accept', true),
    );
    expect(onRephraseApplied).toHaveBeenCalled();
    // MERGED state note appears.
    await screen.findByText('Clause updated with the re-phrased version.');
  });

  it('TASK 3 — unchecking "mark handled" passes markHandled=false', async () => {
    svc.applyRephrase.mockResolvedValue({ applied: true, action: 'accept' });
    const base = withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1');
    const risk: RiskAnalysis = {
      ...base,
      proposed_contract_clause_id: 'pcc-a',
      proposed_contract_clause: { id: 'pcc-a', clause: { title: 'Clause A1', content: 'body' } } as any,
    };
    render(<RiskAnalysisTab contractId="c1" risks={[risk]} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    fireEvent.click(screen.getByText('Merge'));
    fireEvent.click(screen.getByRole('checkbox')); // uncheck
    fireEvent.click(screen.getByText('Merge & Apply'));
    await waitFor(() =>
      expect(svc.applyRephrase).toHaveBeenCalledWith('a', 'accept', false),
    );
  });

  it('TASK 2 — a persisted proposal hydrates up-front with Merge/Edit/Cancel (no advice Re-phrase)', () => {
    const base = withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1');
    const risk: RiskAnalysis = {
      ...base,
      proposed_contract_clause_id: 'pcc-a',
      proposed_contract_clause: { id: 'pcc-a', clause: { title: 'Clause A1', content: 'persisted proposal body' } } as any,
    };
    render(<RiskAnalysisTab contractId="c1" risks={[risk]} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    // Shown up-front on load — no re-generation needed.
    expect(screen.getByText('persisted proposal body')).toBeInTheDocument();
    expect(screen.getByText('Merge')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    // Proposal-centric: the advice-level "Re-phrase clause (AI)" is not shown.
    expect(screen.queryByText('Re-phrase clause (AI)')).not.toBeInTheDocument();
  });

  it('TASK 2 — Edit on the proposal → confirm → editProposal persists the proposed text', async () => {
    svc.editProposal.mockResolvedValue({
      proposed_contract_clause_id: 'pcc-a', title: 'Clause A1',
      content: 'my edited proposal', original_title: 'Clause A1', original_content: 'orig',
    });
    const base = withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1');
    const risk: RiskAnalysis = {
      ...base,
      proposed_contract_clause_id: 'pcc-a',
      proposed_contract_clause: { id: 'pcc-a', clause: { title: 'Clause A1', content: 'orig proposal' } } as any,
    };
    render(<RiskAnalysisTab contractId="c1" risks={[risk]} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    const ta = screen.getByDisplayValue('orig proposal') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'my edited proposal' } });
    fireEvent.click(screen.getByText('Apply'));
    // Confirm dialog gates the save.
    expect(screen.getByText('Save changes to the proposed clause?')).toBeInTheDocument();
    expect(svc.editProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() =>
      expect(svc.editProposal).toHaveBeenCalledWith('a', { content: 'my edited proposal' }),
    );
  });

  it('TASK 4 — merged state shows "Updated · v{n}" badge + View previous version', () => {
    const base = withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1');
    // merged risk: live clause v2 with a parent clause (previous text).
    const risk: RiskAnalysis = { ...base, merged_at: '2026-07-07T00:00:00Z' };
    (risk.contract_clause!.clause as any).version = 2;
    (risk.contract_clause!.clause as any).parent_clause = { content: 'the previous clause text' };
    render(<RiskAnalysisTab contractId="c1" risks={[risk]} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    // View previous toggles the prior text.
    expect(screen.queryByText('the previous clause text')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('View previous version'));
    expect(screen.getByText('the previous clause text')).toBeInTheDocument();
  });

  it('CANCEL stays in place: discarding a proposal calls applyRephrase(reject); recommendation remains', async () => {
    svc.applyRephrase.mockResolvedValue({ applied: true, action: 'reject' });
    const base = withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1');
    const risk: RiskAnalysis = {
      ...base,
      recommendation: 'keep me visible',
      proposed_contract_clause_id: 'pcc-a',
      proposed_contract_clause: {
        id: 'pcc-a',
        clause: { title: 'Clause A1', content: 'rewritten body' },
      } as any,
    };
    render(
      <RiskAnalysisTab contractId="c1" risks={[risk]} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />,
    );
    // The proposed panel's Cancel button discards the proposal.
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() =>
      expect(svc.applyRephrase).toHaveBeenCalledWith('a', 'reject'),
    );
    // Recommendation stays in place under its clause (unchanged).
    expect(screen.getByText('keep me visible')).toBeInTheDocument();
  });

  it('RE-PHRASE dispatches the AI job via startRephrase', async () => {
    svc.startRephrase.mockResolvedValue({ job_id: 'JOB1', status: 'queued' });
    const risks = [withClause(mkRisk({ id: 'a' }), 'docA', 'Agreement', 'Clause A1')];
    render(
      <RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Re-phrase clause (AI)'));
    await waitFor(() => expect(svc.startRephrase).toHaveBeenCalledWith('a'));
  });
});

// Multiple risks sharing ONE clause (same contract_clause_id) for top-2 tests.
function inOneClause(
  specs: Array<{ id: string; risk_level: string; description?: string }>,
): RiskAnalysis[] {
  return specs.map((s) =>
    withClause(
      mkRisk({
        id: s.id,
        contract_clause_id: 'cc-1',
        risk_level: s.risk_level,
        description: s.description ?? 'desc ' + s.id,
        recommendation: 'rec ' + s.id,
      }),
      'docA',
      'Agreement',
      'Clause A1',
    ),
  );
}

describe('RiskAnalysisTab — top-2 / Show more / swap', () => {
  it('shows only the top-2 (by severity) with a "Show more (N)"; expanding reveals the rest', async () => {
    const risks = inOneClause([
      { id: 'a', risk_level: 'HIGH' },
      { id: 'b', risk_level: 'HIGH' },
      { id: 'c', risk_level: 'MEDIUM' },
      { id: 'd', risk_level: 'LOW' },
    ]);
    render(<RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    // Only the 2 HIGH visible by default.
    expect(screen.getByText('rec a')).toBeInTheDocument();
    expect(screen.getByText('rec b')).toBeInTheDocument();
    expect(screen.queryByText('rec c')).not.toBeInTheDocument();
    expect(screen.queryByText('rec d')).not.toBeInTheDocument();
    // Show more (2) reveals the hidden ones.
    fireEvent.click(screen.getByText('Show more (2)'));
    expect(screen.getByText('rec c')).toBeInTheDocument();
    expect(screen.getByText('rec d')).toBeInTheDocument();
  });

  it('SWAP: "Show in top" on a hidden risk persists via setVisibility, replacing the lower-severity visible', async () => {
    const risks = inOneClause([
      { id: 'a', risk_level: 'HIGH' },
      { id: 'b', risk_level: 'MEDIUM' },
      { id: 'c', risk_level: 'LOW' },
    ]);
    render(<RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    // Visible: a (HIGH) + b (MEDIUM); hidden: c (LOW).
    fireEvent.click(screen.getByText('Show more (1)'));
    fireEvent.click(screen.getByText('Show in top'));
    // Keeps the higher-severity visible (a), replaces the lower (b) with c.
    await waitFor(() =>
      expect(svc.setVisibility).toHaveBeenCalledWith('cc-1', ['a', 'c']),
    );
  });

  it('a persisted swap override hydrates on load (survives reload) — the overridden pair is visible', async () => {
    svc.getVisibility.mockResolvedValue({ 'cc-1': ['a', 'c'] });
    const risks = inOneClause([
      { id: 'a', risk_level: 'HIGH' },
      { id: 'b', risk_level: 'HIGH' },
      { id: 'c', risk_level: 'LOW' },
    ]);
    render(<RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    // Override wins over the default (a,b): visible = a + c; b is now hidden.
    await waitFor(() => expect(screen.getByText('rec c')).toBeInTheDocument());
    expect(screen.getByText('rec a')).toBeInTheDocument();
    expect(screen.queryByText('rec b')).not.toBeInTheDocument();
    expect(screen.getByText('Show more (1)')).toBeInTheDocument();
  });

  it('a single-risk clause shows no "Show more" (nothing hidden)', () => {
    const risks = inOneClause([{ id: 'a', risk_level: 'HIGH' }]);
    render(<RiskAnalysisTab contractId="c1" risks={risks} onAnnotate={vi.fn()} onRephraseApplied={vi.fn()} />);
    expect(screen.getByText('rec a')).toBeInTheDocument();
    expect(screen.queryByText(/Show more/)).not.toBeInTheDocument();
  });
});
