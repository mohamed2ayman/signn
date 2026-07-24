import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import RedlinesTab, {
  redlineErrorMessage,
  REDLINE_STATUS_BADGE,
  NEGOTIATION_BADGE,
} from '@/components/contracts/RedlinesTab';
import redlineService, { RedlineRow } from '@/services/api/redlineService';
import type { ContractClause } from '@/types';

// ─────────────────────────────────────────────────────────────────
// Mocks (house conventions: service-level mock — lesson #37; t() → key)
// ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'round' in opts ? `${k}:${opts.round}` : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api/redlineService', () => ({
  default: {
    list: vi.fn(),
    propose: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    counter: vi.fn(),
    withdraw: vi.fn(),
    getNegotiation: vi.fn(),
    agree: vi.fn(),
    readyToSign: vi.fn(),
  },
}));

// DiffView imports types only in our test path; keep it real (it renders
// nothing until the diff modal is opened, which these tests don't do).

const svc = redlineService as unknown as Record<string, ReturnType<typeof vi.fn>>;

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const CLAUSES = [
  {
    id: 'cc-1',
    contract_id: 'c-1',
    clause_id: 'cl-1',
    section_number: '1',
    order_index: 0,
    clause: { id: 'cl-1', title: 'Payment Terms', content: 'Pay within 30 days.' },
  },
] as unknown as ContractClause[];

const baseRow: RedlineRow = {
  id: 'rl-1',
  contract_id: 'c-1',
  contract_clause_id: 'cc-1',
  round: 1,
  parent_redline_id: null,
  status: 'PROPOSED',
  proposed_title: null,
  proposed_content: 'Pay within 45 days.',
  note: null,
  base_content_snapshot: 'Pay within 30 days.',
  decided_at: null,
  decision_note: null,
  resulting_version_id: null,
  resulting_clause_id: null,
  created_at: new Date('2026-07-01T10:00:00Z').toISOString(),
  author_name: 'Cara Counterparty',
  author_role: 'GUEST',
  is_author: false,
  word_level_diff: [
    { value: 'Pay within ' },
    { value: '30', removed: true },
    { value: '45', added: true },
    { value: ' days.' },
  ],
};

function renderTab(opts: { rows?: RedlineRow[]; isHost?: boolean; negotiation?: string } = {}) {
  svc.list.mockResolvedValue(opts.rows ?? []);
  svc.getNegotiation.mockResolvedValue({
    negotiation_status: opts.negotiation ?? 'UNDER_REVIEW',
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RedlinesTab contractId="c-1" clauses={CLAUSES} isHost={opts.isHost ?? true} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
// Container logic
// ─────────────────────────────────────────────────────────────────

describe('RedlinesTab', () => {
  it('renders the empty state when there are no redlines', async () => {
    renderTab({ rows: [] });
    await waitFor(() => {
      expect(screen.getByText('redlines.empty.title')).toBeInTheDocument();
    });
    expect(screen.getByText('redlines.empty.host')).toBeInTheDocument();
  });

  it('HOST on a PROPOSED redline: Accept / Reject / Counter render; Withdraw does NOT (not author)', async () => {
    renderTab({ rows: [baseRow], isHost: true });
    await waitFor(() => {
      expect(screen.getByText('redlines.actions.accept')).toBeInTheDocument();
    });
    expect(screen.getByText('redlines.actions.reject')).toBeInTheDocument();
    expect(screen.getByText('redlines.actions.counter')).toBeInTheDocument();
    expect(screen.queryByText('redlines.actions.withdraw')).not.toBeInTheDocument();
    // Host does not get the counterparty Propose button.
    expect(screen.queryByText('redlines.propose.button')).not.toBeInTheDocument();
    // Host negotiation actions render.
    expect(screen.getByText('redlines.negotiation.markAgreed')).toBeInTheDocument();
  });

  it('COUNTERPARTY (non-host) viewer: Propose renders; host actions do NOT', async () => {
    renderTab({ rows: [baseRow], isHost: false });
    await waitFor(() => {
      expect(screen.getByText('redlines.propose.button')).toBeInTheDocument();
    });
    expect(screen.queryByText('redlines.actions.accept')).not.toBeInTheDocument();
    expect(screen.queryByText('redlines.actions.reject')).not.toBeInTheDocument();
    expect(screen.queryByText('redlines.negotiation.markAgreed')).not.toBeInTheDocument();
  });

  it('the AUTHOR sees Withdraw on their own PROPOSED redline', async () => {
    renderTab({ rows: [{ ...baseRow, is_author: true }], isHost: false });
    await waitFor(() => {
      expect(screen.getByText('redlines.actions.withdraw')).toBeInTheDocument();
    });
  });

  it('decided redlines show NO action buttons (any viewer)', async () => {
    renderTab({
      rows: [{ ...baseRow, status: 'ACCEPTED', is_author: true }],
      isHost: true,
    });
    await waitFor(() => {
      expect(screen.getByText('redlines.status.ACCEPTED')).toBeInTheDocument();
    });
    expect(screen.queryByText('redlines.actions.accept')).not.toBeInTheDocument();
    expect(screen.queryByText('redlines.actions.withdraw')).not.toBeInTheDocument();
  });

  it('status badges map every RedlineStatus + negotiation badge renders', async () => {
    const statuses = Object.keys(REDLINE_STATUS_BADGE) as RedlineRow['status'][];
    renderTab({
      rows: statuses.map((s, i) => ({ ...baseRow, id: `rl-${i}`, status: s })),
      negotiation: 'AGREED',
    });
    for (const s of statuses) {
      await waitFor(() => {
        expect(screen.getByText(`redlines.status.${s}`)).toBeInTheDocument();
      });
    }
    expect(screen.getByText('redlines.negotiation.AGREED')).toBeInTheDocument();
    // STALE hint renders on the stale row.
    expect(screen.getByText('redlines.staleHint')).toBeInTheDocument();
    // Scrubbed author fields render (display name + role chip only).
    expect(screen.getAllByText('Cara Counterparty').length).toBeGreaterThan(0);
    expect(screen.getAllByText('redlines.role.external').length).toBeGreaterThan(0);
  });

  it('groups render the clause label from the live clauses prop', async () => {
    renderTab({ rows: [baseRow] });
    await waitFor(() => {
      expect(screen.getByText(/Payment Terms/)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Error-code mapping (pure — the coded-409 → readable message table)
// ─────────────────────────────────────────────────────────────────

describe('redlineErrorMessage', () => {
  const t = (k: string) => k;
  const err = (error?: string, status = 409) => ({ response: { status, data: { error } } });

  it.each([
    ['STALE_REDLINE', 'redlines.errors.stale'],
    ['CONTRACT_PINNED', 'redlines.errors.pinned'],
    ['OPEN_REDLINES_EXIST', 'redlines.errors.openRedlines'],
    ['REDLINE_NOT_PROPOSED', 'redlines.errors.notProposed'],
    ['INVALID_NEGOTIATION_TRANSITION', 'redlines.errors.invalidTransition'],
  ])('%s → %s', (code, key) => {
    expect(redlineErrorMessage(err(code), t)).toBe(key);
  });

  it('404 → generic not-found (no special-casing, no existence leak)', () => {
    expect(redlineErrorMessage(err(undefined, 404), t)).toBe('redlines.errors.notFound');
  });

  it('unknown error → generic', () => {
    expect(redlineErrorMessage(new Error('boom'), t)).toBe('redlines.errors.generic');
    expect(redlineErrorMessage(err('SOMETHING_ELSE', 500), t)).toBe(
      'redlines.errors.generic',
    );
  });
});

// Badge maps stay total — a new enum value without a badge is a compile+test failure.
describe('badge maps', () => {
  it('covers all redline statuses', () => {
    expect(Object.keys(REDLINE_STATUS_BADGE).sort()).toEqual(
      ['ACCEPTED', 'COUNTERED', 'PROPOSED', 'REJECTED', 'STALE', 'WITHDRAWN'].sort(),
    );
  });
  it('covers all negotiation statuses', () => {
    expect(Object.keys(NEGOTIATION_BADGE).sort()).toEqual(
      ['AGREED', 'DRAFT', 'READY_TO_SIGN', 'SHARED', 'UNDER_REVIEW'].sort(),
    );
  });
});
