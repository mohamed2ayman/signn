import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import toast from 'react-hot-toast';

import ContractDetailPage from '@/pages/app/ContractDetailPage';
import { contractService } from '@/services/api/contractService';
import { contractSharingService } from '@/services/api/contractSharingService';
import { exportService } from '@/services/api/exportService';
import { projectService } from '@/services/api/projectService';
import { partyService } from '@/services/api/partyService';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { riskAnalysisService } from '@/services/api/riskAnalysisService';

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE — the error surface added for the 13 silent mutations + handleExport.
//
// This is a NEW file. ContractDetailPage.test.tsx belongs to 7.31 and is not
// touched: five of its tests deliberately assert the OLD silent behaviour and
// are EXPECTED to go red against this change. Inverting them is their owner's
// call, so nothing here duplicates or replaces them.
//
// WHAT IS ASSERTED — invariants, not counts. A test that pins "13 handlers call
// toast" would pass while showing the user a hardcoded English string, and
// would need editing every time a handler is added. These assert the three
// properties that actually matter:
//
//   1. a failed write SURFACES something (the user can tell failure from
//      a click that never registered — the original defect),
//   2. what surfaces is an i18n KEY, not a literal,
//   3. the guards hold (share cannot double-post, removal needs confirming,
//      a failed export is distinguishable from a successful one).
//
// HOW (2) IS PROVEN. The `t` mock below echoes its key, so `t('contract.errors.
// generic')` renders the literal string 'contract.errors.generic'. Asserting
// that the toasted string starts with 'contract.errors.' therefore proves the
// message travelled through i18n — a hardcoded "Something went wrong" could not
// produce it. This is the same key-echoing mock 7.31 uses, applied to a new
// purpose. `assertI18nKey` below is the single place that check lives.
//
// MOCKING RULE (lesson #37): service-level vi.mock ONLY, NEVER axios —
// axios.ts side-effect-loads the Redux store.
// ─────────────────────────────────────────────────────────────────────────────

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

vi.mock('react-redux', () => ({
  useSelector: (sel: (s: unknown) => unknown) =>
    sel({
      auth: {
        user: {
          id: 'u-1',
          email: 'lead@acme.test',
          first_name: 'Lea',
          last_name: 'Dev',
          role: 'OWNER_ADMIN',
        },
      },
    }),
  useDispatch: () => vi.fn(),
}));

// Key-echoing t(): the rendered/toasted text IS the i18n key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0
        ? `${k}:${Object.values(opts).join(',')}`
        : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The error surface itself. Mocked so the toast call is observable — the real
// <Toaster/> lives in main.tsx and is not mounted by this render tree.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/services/api/contractService', () => ({
  contractService: {
    getById: vi.fn(),
    getClauses: vi.fn(),
    getComments: vi.fn(),
    getApprovers: vi.fn(),
    getVersions: vi.fn(),
    getMilestoneVersions: vi.fn(),
    getVersion: vi.fn(),
    getResponses: vi.fn(),
    getSignatureStatus: vi.fn(),
    getSigningUrl: vi.fn(),
    initiateSignature: vi.fn(),
    markAsSigned: vi.fn(),
    updateStatus: vi.fn(),
    update: vi.fn(),
    updateParties: vi.fn(),
    addClause: vi.fn(),
    removeClause: vi.fn(),
    reorderClauses: vi.fn(),
    updateContractClause: vi.fn(),
    addComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    resolveComment: vi.fn(),
    requestApproval: vi.fn(),
    reviewApproval: vi.fn(),
    compareVersions: vi.fn(),
    saveNewVersion: vi.fn(),
    getPendingApprovals: vi.fn(),
    getRelationshipTypes: vi.fn(),
    getAll: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/services/api/contractSharingService', () => ({
  contractSharingService: {
    getSharesByContract: vi.fn(),
    createShare: vi.fn(),
    revokeShare: vi.fn(),
    searchOrgMembers: vi.fn(),
  },
}));

vi.mock('@/services/api/riskAnalysisService', () => ({
  riskAnalysisService: {
    getByContract: vi.fn(),
    getByClause: vi.fn(),
    getRiskSummary: vi.fn(),
    getCompleteness: vi.fn(),
    getVisibility: vi.fn(),
    setVisibility: vi.fn(),
    annotate: vi.fn(),
    updateStatus: vi.fn(),
    startRephrase: vi.fn(),
    pollRephrase: vi.fn(),
    editProposal: vi.fn(),
    applyRephrase: vi.fn(),
    getCategories: vi.fn(),
    getRules: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
  },
}));

vi.mock('@/services/api/documentProcessingService', () => ({
  documentProcessingService: {
    getDocuments: vi.fn(),
    getDocumentStatus: vi.fn(),
    reprocess: vi.fn(),
    uploadDocument: vi.fn(),
    updateExtractedText: vi.fn(),
    getProposedClauses: vi.fn(),
    compareProposedVersion: vi.fn(),
    applyProposedVersion: vi.fn(),
  },
}));

vi.mock('@/services/api/clauseService', () => ({
  clauseService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    getClauseTypes: vi.fn(),
    getVersionHistory: vi.fn(),
    create: vi.fn(),
    createNewVersion: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/services/api/exportService', () => ({
  exportService: {
    downloadContractPdf: vi.fn(),
    downloadRiskReport: vi.fn(),
    downloadSummary: vi.fn(),
  },
}));

vi.mock('@/services/api/projectService', () => ({
  projectService: { getMembers: vi.fn(), getById: vi.fn(), getAll: vi.fn() },
}));

vi.mock('@/services/api/partyService', () => ({
  partyService: {
    getRoles: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/services/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getSocket: vi.fn(() => null),
    joinContract: vi.fn(),
    leaveContract: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/components/chat/ChatPanel', () => ({ default: () => null }));
vi.mock('@/components/contracts/GuestProposedVersionsPanel', () => ({
  default: () => null,
}));
vi.mock('@/components/contracts/DocumentsNeedingReview', () => ({
  default: () => null,
  docNeedsReview: () => false,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT = {
  id: 'c-1',
  project_id: 'p-1',
  name: 'Metro Line 4 — Main Construction Agreement',
  contract_type: 'FIDIC_RED_BOOK_2017',
  status: 'APPROVED',
  current_version: 3,
  signature_status: null,
  docusign_envelope_id: null,
  pinned_at: null,
  pinned_version_id: null,
  executed_at: null,
  party_first_name: 'National Tunnels Authority',
  party_second_name: 'Delta Contracting Co.',
  created_by: 'u-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  contract_clauses: [],
};

const ORG_MEMBER = { id: 'u-9', name: 'Nadia Farouk', email: 'nadia@acme.test' };

const ACTIVE_SHARE = {
  id: 'sh-1',
  contract_id: 'c-1',
  shared_with_email: 'nadia@acme.test',
  permission: 'view',
  expires_at: null,
  is_active: true,
  created_at: '2026-02-01T00:00:00.000Z',
};

/** The JUNCTION id (`cc-1`) is what the remove path sends — deliberately
 *  different from `clause_id` so a test can tell which one travelled. */
const ATTACHED_CLAUSE = {
  id: 'cc-1',
  contract_id: 'c-1',
  clause_id: 'cl-1',
  section_number: '14.7',
  order_index: 0,
  customizations: null,
  clause: {
    id: 'cl-1',
    title: 'Payment Terms',
    clause_type: 'PAYMENT',
    content: 'The Employer shall pay the Contractor within 56 days.',
  },
};

/** An axios-shaped rejection. The production helper reads `err.response`, and a
 *  bare `new Error()` would be classified as OFFLINE — a different key — so
 *  tests that mean "the server said no" must carry a response. */
const httpError = (status: number, code?: string) => ({
  response: { status, data: code ? { error: code } : {} },
});

function renderContractDetail(overrides: Partial<typeof CONTRACT> = {}) {
  const first = { ...CONTRACT, ...overrides };
  vi.mocked(contractService.getById).mockResolvedValue(first as never);

  return render(
    <MemoryRouter initialEntries={['/app/contracts/c-1']}>
      <Routes>
        <Route path="/app/contracts/:id" element={<ContractDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const waitForPageReady = () =>
  screen.findByRole('heading', { level: 1, name: CONTRACT.name });

async function openShareModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() =>
    expect(contractSharingService.getSharesByContract).toHaveBeenCalledWith('c-1'),
  );
  return screen.getByPlaceholderText('colleague@company.com');
}

/** `paste` not `type` — handleShareEmailChange's debounce is ineffective (its
 *  timer is stored on a function object re-created every render), so N
 *  keystrokes schedule N live searches. One paste = one timer = deterministic.
 *  This mirrors 7.31's pasteRecipient and the reason for it. */
async function pasteRecipient(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  email: string,
) {
  await user.click(input);
  await user.paste(email);
}

/**
 * THE CENTRAL ASSERTION of this file.
 *
 * Proves BOTH invariants at once: that something was surfaced at all, and that
 * what was surfaced came from i18n. Under the key-echoing `t` mock the toasted
 * value IS the key, so a hardcoded English string cannot satisfy this.
 */
function assertI18nKeyToasted(prefix = 'contract.errors.') {
  expect(toast.error).toHaveBeenCalled();
  const arg = vi.mocked(toast.error).mock.calls.at(-1)?.[0];
  expect(typeof arg).toBe('string');
  expect(arg as string).toMatch(/^contract\.errors\./);
  expect(arg as string).toMatch(new RegExp(`^${prefix.replace('.', '\\.')}`));
  // Nothing raw from the server, and no bare English sentence, ever reaches
  // the user: a key has no spaces.
  expect(arg as string).not.toMatch(/\s/);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Mount-time reads. The page calls partyService.getRoles(...).then(...) in an
  // effect, so a bare vi.fn() returning undefined throws before any test body
  // runs. Every mount-time dependency is defaulted HERE, once.
  vi.mocked(partyService.getRoles).mockResolvedValue([] as never);
  vi.mocked(documentProcessingService.getDocuments).mockResolvedValue([] as never);
  vi.mocked(contractService.getClauses).mockResolvedValue([] as never);
  vi.mocked(contractService.getComments).mockResolvedValue([] as never);
  vi.mocked(contractService.getApprovers).mockResolvedValue([] as never);
  // Part of loadContract's Promise.all — an unmocked vi.fn() returns undefined
  // and the page's `.catch(() => [])` fallback then throws on undefined.
  vi.mocked(riskAnalysisService.getByContract).mockResolvedValue([] as never);
  vi.mocked(contractSharingService.getSharesByContract).mockResolvedValue([] as never);
  vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([] as never);
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. A FAILED WRITE SURFACES AN i18n KEY
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — failed writes surface an i18n error', () => {
  it('share: a rejected createShare toasts an i18n key and does NOT show the success banner', async () => {
    const user = userEvent.setup();
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([
      ORG_MEMBER,
    ] as never);
    vi.mocked(contractSharingService.createShare).mockRejectedValue(httpError(500));
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, ORG_MEMBER.email);
    await user.click(
      await screen.findByRole('button', { name: new RegExp(ORG_MEMBER.name) }),
    );

    const grant = screen.getByRole('button', { name: 'Grant Access' });
    await waitFor(() => expect(grant).toBeEnabled());
    await user.click(grant);

    await waitFor(() => expect(contractSharingService.createShare).toHaveBeenCalled());
    await waitFor(() => assertI18nKeyToasted('contract.errors.shareFailed'));
    // The success banner must NOT appear — failure and success are distinct.
    expect(screen.queryByText(/Access granted to/)).not.toBeInTheDocument();
  });

  it('revoke: a rejected revokeShare toasts an i18n key and the share row SURVIVES', async () => {
    const user = userEvent.setup();
    vi.mocked(contractSharingService.getSharesByContract).mockResolvedValue([
      ACTIVE_SHARE,
    ] as never);
    // The real 404 an org member who is not the original sharer receives
    // (contract-sharing.service.ts scopes the lookup to `shared_by: userId`).
    vi.mocked(contractSharingService.revokeShare).mockRejectedValue(httpError(404));
    renderContractDetail();
    await waitForPageReady();
    await openShareModal(user);

    expect(await screen.findByText(ACTIVE_SHARE.shared_with_email)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke access' }));

    await waitFor(() => expect(contractSharingService.revokeShare).toHaveBeenCalledWith('sh-1'));
    await waitFor(() => assertI18nKeyToasted('contract.errors.revokeFailed'));
    // Access is still live, so the row must still be there. Removing it would
    // assert the very lie this change exists to stop.
    expect(screen.getByText(ACTIVE_SHARE.shared_with_email)).toBeInTheDocument();
  });

  it('approval: a rejected requestApproval toasts an i18n key', async () => {
    const user = userEvent.setup();
    vi.mocked(projectService.getMembers).mockResolvedValue([
      {
        id: 'pm-1',
        user_id: 'u-7',
        project_id: 'p-1',
        permission_level: 'APPROVER',
        user: { id: 'u-7', first_name: 'Omar', last_name: 'Saleh', email: 'omar@acme.test' },
      },
    ] as never);
    vi.mocked(contractService.requestApproval).mockRejectedValue(httpError(500));
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: 'Request Approval' }));
    await screen.findByRole('heading', { name: 'Request Approval' });
    await user.click(await screen.findByRole('checkbox', { name: /Omar Saleh/ }));

    const submit = screen.getByRole('button', { name: /^Send for Review/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(contractService.requestApproval).toHaveBeenCalled());
    await waitFor(() => assertI18nKeyToasted());
  });

  it('a 409 CONTRACT_PINNED is discriminated to the "locked" key, not the generic one', async () => {
    // Keying on the machine-readable CODE, not the message (lesson #220). This
    // is the one branch where the user's next step genuinely differs: retrying
    // will never work, because the contract is signed.
    const user = userEvent.setup();
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([
      ORG_MEMBER,
    ] as never);
    vi.mocked(contractSharingService.createShare).mockRejectedValue(
      httpError(409, 'CONTRACT_PINNED'),
    );
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, ORG_MEMBER.email);
    await user.click(
      await screen.findByRole('button', { name: new RegExp(ORG_MEMBER.name) }),
    );
    const grant = screen.getByRole('button', { name: 'Grant Access' });
    await waitFor(() => expect(grant).toBeEnabled());
    await user.click(grant);

    await waitFor(() => assertI18nKeyToasted('contract.errors.locked'));
  });

  it('a 403 is discriminated to the "permission" key', async () => {
    const user = userEvent.setup();
    vi.mocked(contractSharingService.getSharesByContract).mockResolvedValue([
      ACTIVE_SHARE,
    ] as never);
    vi.mocked(contractSharingService.revokeShare).mockRejectedValue(httpError(403));
    renderContractDetail();
    await waitForPageReady();
    await openShareModal(user);

    await user.click(await screen.findByRole('button', { name: 'Revoke access' }));
    await waitFor(() => assertI18nKeyToasted('contract.errors.permission'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. SHARE CANNOT DOUBLE-POST
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — share in-flight guard', () => {
  it('two synchronous clicks produce exactly ONE createShare call', async () => {
    // A useState flag could not pass this: `shareEmail` is cleared only AFTER
    // the await, so no re-render disables the button in between, and a state
    // update would not have committed before the second click. Only the
    // synchronous ref closes it.
    const user = userEvent.setup();
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([
      ORG_MEMBER,
    ] as never);
    vi.mocked(contractSharingService.createShare).mockReturnValue(
      new Promise(() => {}) as never, // never resolves — stays in flight
    );
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, ORG_MEMBER.email);
    await user.click(
      await screen.findByRole('button', { name: new RegExp(ORG_MEMBER.name) }),
    );

    const grant = screen.getByRole('button', { name: 'Grant Access' });
    await waitFor(() => expect(grant).toBeEnabled());

    // TWO NATIVE CLICKS IN ONE TICK — deliberately NOT `await user.click()`
    // twice. userEvent awaits between clicks, which lets React commit the
    // disabled attribute, so an awaited pair passes even with a plain useState
    // flag and proves nothing. Dispatching both synchronously is what a real
    // double-click does and is the only thing that discriminates the
    // synchronous ref from a state flag. (Verified by mutation: swapping the
    // ref for `useState` turns THIS assertion red; with awaited clicks it
    // stayed green.)
    grant.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    grant.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await waitFor(() => expect(contractSharingService.createShare).toHaveBeenCalled());
    expect(contractSharingService.createShare).toHaveBeenCalledTimes(1);
  });

  it('releases the guard on failure, so a deliberate retry genuinely re-posts', async () => {
    // The other half of lesson #238: a guard that acquires but never releases
    // silently swallows every future send. Acquire-only tests stay green while
    // the feature is dead, so the release is asserted explicitly.
    const user = userEvent.setup();
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([
      ORG_MEMBER,
    ] as never);
    vi.mocked(contractSharingService.createShare).mockRejectedValue(httpError(500));
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, ORG_MEMBER.email);
    await user.click(
      await screen.findByRole('button', { name: new RegExp(ORG_MEMBER.name) }),
    );

    const grant = screen.getByRole('button', { name: 'Grant Access' });
    await waitFor(() => expect(grant).toBeEnabled());

    await user.click(grant);
    await waitFor(() => expect(contractSharingService.createShare).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(grant).toBeEnabled());
    await user.click(grant);
    await waitFor(() => expect(contractSharingService.createShare).toHaveBeenCalledTimes(2));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. CLAUSE REMOVAL REQUIRES CONFIRMATION
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — clause removal confirmation', () => {
  it('clicking Remove opens a confirm dialog and does NOT call the service', async () => {
    // Removal hard-deletes the junction row server-side with only a post-hoc
    // snapshot, so it cannot be undone from the UI. The service NOT having been
    // called is the whole assertion — previously the call landed on click.
    const user = userEvent.setup();
    vi.mocked(contractService.getClauses).mockResolvedValue([ATTACHED_CLAUSE] as never);
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();
    expect(await screen.findByRole('heading', { name: 'Payment Terms' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove clause' }));

    expect(
      await screen.findByRole('heading', { name: 'contract.removeClauseConfirm.title' }),
    ).toBeInTheDocument();
    expect(contractService.removeClause).not.toHaveBeenCalled();
    // The clause is still on screen — nothing was destroyed by the click.
    expect(screen.getByRole('heading', { name: 'Payment Terms' })).toBeInTheDocument();
  });

  it('confirming removes the clause by its JUNCTION id', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getClauses).mockResolvedValue([ATTACHED_CLAUSE] as never);
    vi.mocked(contractService.removeClause).mockResolvedValue({} as never);
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await user.click(await screen.findByRole('button', { name: 'Remove clause' }));
    await user.click(
      await screen.findByRole('button', { name: 'contract.removeClauseConfirm.cta' }),
    );

    // 'cc-1' is the junction id; 'cl-1' is the library clause. Sending the
    // wrong one would delete nothing (or the wrong thing).
    await waitFor(() =>
      expect(contractService.removeClause).toHaveBeenCalledWith('c-1', 'cc-1'),
    );
    expect(contractService.removeClause).not.toHaveBeenCalledWith('c-1', 'cl-1');
  });

  it('cancelling closes the dialog and never calls the service', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getClauses).mockResolvedValue([ATTACHED_CLAUSE] as never);
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await user.click(await screen.findByRole('button', { name: 'Remove clause' }));
    await user.click(await screen.findByRole('button', { name: 'common.cancel' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'contract.removeClauseConfirm.title' }),
      ).not.toBeInTheDocument(),
    );
    expect(contractService.removeClause).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Payment Terms' })).toBeInTheDocument();
  });

  it('a failed removal toasts an i18n key and KEEPS the clause on screen', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getClauses).mockResolvedValue([ATTACHED_CLAUSE] as never);
    vi.mocked(contractService.removeClause).mockRejectedValue(httpError(500));
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await user.click(await screen.findByRole('button', { name: 'Remove clause' }));
    await user.click(
      await screen.findByRole('button', { name: 'contract.removeClauseConfirm.cta' }),
    );

    await waitFor(() => expect(contractService.removeClause).toHaveBeenCalled());
    await waitFor(() => assertI18nKeyToasted());
    // Still attached — the optimistic filter must not run on failure.
    expect(screen.getByRole('heading', { name: 'Payment Terms' })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. A FAILED EXPORT IS DISTINGUISHABLE FROM A SUCCESSFUL ONE
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — export failure is distinguishable', () => {
  it('a failed export toasts an i18n key AND leaves the menu open', async () => {
    // The original defect: setShowExportMenu(false) sat in `finally`, so the
    // menu closed on success and failure alike and the only cue was that no
    // file arrived. Both halves are asserted — the toast, and the menu.
    const user = userEvent.setup();
    vi.mocked(exportService.downloadContractPdf).mockRejectedValue(httpError(500));
    renderContractDetail();
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: /Export/ }));
    await user.click(await screen.findByRole('button', { name: 'Contract PDF' }));

    await waitFor(() => expect(exportService.downloadContractPdf).toHaveBeenCalledWith('c-1'));
    await waitFor(() => assertI18nKeyToasted('contract.errors.exportFailed'));
    expect(screen.getByRole('button', { name: 'Contract PDF' })).toBeInTheDocument();
  });

  it('a successful export closes the menu and toasts nothing', async () => {
    // The discriminating counterpart. Without this, a fix that simply never
    // closed the menu would pass the failure test above.
    const user = userEvent.setup();
    vi.mocked(exportService.downloadContractPdf).mockResolvedValue(undefined as never);
    renderContractDetail();
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: /Export/ }));
    await user.click(await screen.findByRole('button', { name: 'Contract PDF' }));

    await waitFor(() => expect(exportService.downloadContractPdf).toHaveBeenCalledWith('c-1'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Contract PDF' })).not.toBeInTheDocument(),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
