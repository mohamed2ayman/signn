import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import ContractDetailPage from '@/pages/app/ContractDetailPage';
import { contractService } from '@/services/api/contractService';
import { contractSharingService } from '@/services/api/contractSharingService';
import { riskAnalysisService } from '@/services/api/riskAnalysisService';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { clauseService } from '@/services/api/clauseService';
import { projectService } from '@/services/api/projectService';

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE (7.31 S2) — three flows on a 2711-line page:
//   1. MARK-SIGNED  (signed-state pinning "door 2" — handleMarkSigned, :836)
//   2. DOCUSIGN     (initiate signature + open the signing window, :793)
//   3. SHARE        (grant internal access — handleShareContract, :740)
//
// SCOPE (7.31 S6, part 2) — three MORE write flows, chosen from the coverage
// report rather than from intuition. Every uncovered function in the file was
// classified READ / WRITE / BLOCKED; these are the top three WRITE flows by
// regression cost in user terms:
//   4. APPROVAL WORKFLOW  (openRequestApprovalModal :617, handleRequestApproval
//      :629, handleApprovalReview :645) — the lifecycle chokepoint. A contract
//      that cannot be approved can never be signed, pinned, or made ACTIVE, so
//      every downstream module is gated behind these three functions.
//   5. COMMENTS           (handleAddComment :569, handleEditComment :586,
//      handleDeleteComment :605) — user-authored content, unrecoverable if
//      dropped, and the only surface here that writes `is_internal_note`, whose
//      wrong value leaks an internal note to an external guest.
//   6. CLAUSE ADD/REMOVE  (loadAvailableClauses :872, handleAddClause :547,
//      handleRemoveClause :559) — mutates the contract's substantive legal
//      content, and remove fires straight into the service with NO confirmation
//      dialog (:1641), so one stray click destroys a clause binding.
// Ranked 4th and left for a later session: EXPORT (handleExport :676) — three
// download branches whose failure is annoying and retryable, with no data loss
// and no wrong persisted state.
//
// Deliberately NOT covered, by cross-track agreement: the tab inventory, the
// Parties tab, the "Who has access" tab, and the Risk / Compliance /
// Obligations / Redlines tabs. Every heavy tab is conditionally mounted
// (`{activeTab === 'x' && <Tab/>}`, :1871-:2014) and the default tab is
// 'clauses' (:289), so none of them mount here — leaving them alone costs
// nothing and keeps this file off another track's churn path.
//
// QUERY HANDLES — the page has ZERO `data-testid`, ZERO `aria-*`, and exactly
// ONE `role` attribute in 2711 lines (`role="alert"`, :2676). Production is
// read-only for this task, so elements are reached by accessible role + name,
// by placeholder, or by visible text. Where a literal is the only handle it is
// marked TEMPORARY-LITERAL and should become a key when that surface is
// localized.
//
// MOCKING RULE (lesson #37): service-level vi.mock ONLY. NEVER mock axios —
// axios.ts side-effect-loads the Redux store. Whole modules are mocked with
// benign defaults so a call added later returns something harmless rather than
// throwing `undefined is not a function` into a swallowing catch.
//
// act() WARNINGS: the duplicate-@testing-library/dom install that caused ~203 of
// them is gone (root pin, PR #218 — one 9.3.4 instance now). The residue is ~2,
// both from the in-flight-guard tests below, which deliberately release a
// pending promise after their assertions have run. That makes the count a
// usable signal: new tests must not raise it. Nothing here wraps act(), stubs
// console, or downgrades to fireEvent.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TIMING BUDGETS — raised for THIS FILE ONLY (vitest isolates the module
// registry per test file, so neither call leaks to another suite).
//
// This is not patience for a flaky assertion; it is headroom for a genuinely
// expensive one. Every test here mounts ContractDetailPage — 2711 lines, ~83
// functions — and there are 30 of them. Uninstrumented that is ~4.5 s for the
// file. Under `npx vitest run --coverage`, with every source file instrumented
// and the workers running in parallel, the same file takes several times longer
// and RTL's default 1000 ms query window and vitest's default 5000 ms test
// window both become marginal: measured failures were "Test timed out in
// 5000ms" and a `user.type` whose keystrokes arrived scrambled, NEVER a wrong
// value. The file already reached for `{ timeout: 3000 }` ad hoc in three share
// queries; this states the budget once instead.
//
// Nothing about discrimination changes — a genuinely wrong value still fails,
// just as loudly and on the same assertion. The mutation checks run for this
// PR all failed on value diffs, not on timeouts, so the raised ceiling cannot
// hide them.
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

// Key-echoing t(): the rendered text IS the i18n key, so chrome that is
// localized can be asserted on the stable key instead of a translatable string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0
        ? `${k}:${Object.values(opts).join(',')}`
        : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
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

// useCollaboration opens a real websocket on mount (useCollaboration.ts:56).
// Mocked at the SERVICE layer so the real hook logic still runs.
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

// Heavy children that mount UNCONDITIONALLY (:1492, :1501, :2703). Stubbed so
// this file never depends on their internals. `docNeedsReview` is a named
// export the page calls directly (:405), so the stub must provide it.
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

/** `status: 'APPROVED'` + no signature_status is the one state that renders
 *  BOTH in-scope signing entry points: DocuSign (:1130) and mark-signed
 *  (:1143, via MARK_SIGNED_ALLOWED_STATUSES at :821). `docusign_envelope_id`
 *  stays null so the signature-status effect (:866) never fires — that keeps
 *  the getById call count meaningful. */
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

/** Authored by 'u-1' — the logged-in user in the react-redux mock — so both the
 *  edit pencil (author-only, :1779) and the trash (author-or-admin, :1792)
 *  render. `updated_at === created_at` keeps the "edited" marker (:1744) off, so
 *  its later appearance is genuine evidence rather than fixture noise. */
const MY_COMMENT = {
  id: 'cm-1',
  contract_id: 'c-1',
  user_id: 'u-1',
  contract_clause_id: null,
  content: 'Clause 14.7 payment window should read 28 days, not 56.',
  is_resolved: false,
  is_internal_note: false,
  created_at: '2026-02-01T09:00:00.000Z',
  updated_at: '2026-02-01T09:00:00.000Z',
  user: { id: 'u-1', first_name: 'Lea', last_name: 'Dev' },
  replies: [],
};

/** A project member the approval modal will offer. `permission_level` MUST be
 *  'APPROVER' — openRequestApprovalModal filters on it (:621) and anything else
 *  is silently dropped, leaving an empty modal. */
const APPROVER_MEMBER = {
  id: 'pm-1',
  user_id: 'u-7',
  project_id: 'p-1',
  permission_level: 'APPROVER',
  user: { id: 'u-7', first_name: 'Omar', last_name: 'Saleh', email: 'omar@acme.test' },
};

/** A clause sitting in the org library, offered by the Add Clause modal. */
const LIBRARY_CLAUSE = {
  id: 'cl-9',
  title: 'Force Majeure',
  clause_type: 'FORCE_MAJEURE',
  content: 'Neither Party shall be liable for any failure caused by an event beyond its control.',
};

/** A clause already attached to the contract. `id` is the JUNCTION id — that is
 *  what handleRemoveClause sends (:562), NOT `clause_id`. The two are kept
 *  deliberately different so a test can tell which one travelled. */
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

/** ONE place holding ALL mount-time setup. When another track adds a
 *  mount-time dependency to this page, it is fixed HERE, once — not in every
 *  test. `reloadedWith` models the SECOND and later getById results, which is
 *  how the success path proves the page re-read the contract. A counter-based
 *  implementation is used instead of mockResolvedValueOnce because
 *  vi.clearAllMocks() does NOT drain a `...Once` queue, so a leftover could
 *  silently shift the sequence into the next test. */
function renderContractDetail(
  overrides: Partial<typeof CONTRACT> = {},
  reloadedWith?: Partial<typeof CONTRACT>,
) {
  const first = { ...CONTRACT, ...overrides };
  const later = reloadedWith ? { ...first, ...reloadedWith } : first;
  let calls = 0;
  vi.mocked(contractService.getById).mockImplementation(async () => {
    calls += 1;
    return (calls === 1 ? first : later) as never;
  });

  return render(
    <MemoryRouter initialEntries={['/app/contracts/c-1']}>
      <Routes>
        <Route path="/app/contracts/:id" element={<ContractDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The contract name renders as the page's only <h1> (:1005). It also appears
 *  in the breadcrumb, so the level-1 heading is what disambiguates. Awaiting it
 *  is the canonical "mounted, primary read resolved" signal. */
const waitForPageReady = () =>
  screen.findByRole('heading', { level: 1, name: CONTRACT.name });

/** Opens the share modal and waits for the existing-shares read to settle. */
async function openShareModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() =>
    expect(contractSharingService.getSharesByContract).toHaveBeenCalledWith('c-1'),
  );
  return screen.getByPlaceholderText('colleague@company.com');
}

/** Types a recipient into the share form.
 *  `paste` — NOT `type` — is deliberate. handleShareEmailChange (:706) stores
 *  its debounce timer on the function object (`(handleShareEmailChange as any)
 *  ._timer`, :715), but that function is re-created on every render, so the
 *  clearTimeout always targets a fresh `undefined` and cancels nothing: every
 *  keystroke schedules its own live 300 ms search. `paste` fires ONE change
 *  event and therefore ONE timer, which is the difference between a
 *  deterministic test and a racy one. (See the report — the ineffective
 *  debounce is a production finding, not fixed here.) */
async function pasteRecipient(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  email: string,
) {
  await user.click(input);
  await user.paste(email);
}

/** Fills a free-text field with ONE paste instead of N keystrokes.
 *
 *  This is a LOAD control, not a style preference. `user.type` re-renders the
 *  whole 2711-line page once per character, and this file drives it many times;
 *  measured under `npx vitest run --coverage`, that cost was enough to starve
 *  the parallel workers and make the PRE-EXISTING DocuSign tests flake — their
 *  `user.type` keystrokes arriving out of order ("Jane Doe" landing as
 *  "eJ.atnees tDoe") and a 5000 ms test timeout. One paste is one change event,
 *  which removes ~200 full re-renders across the tests below. Same reasoning as
 *  `pasteRecipient` above, which already uses paste for the share input.
 *
 *  Safe for every field it is used on here: none of them has an onKeyDown /
 *  onKeyPress handler — they are plain controlled inputs whose only listener is
 *  onChange (:1697, :1811, :2473). */
async function pasteInto(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
) {
  await user.click(field);
  await user.paste(text);
}

beforeEach(() => {
  vi.clearAllMocks();

  // Mount-time reads: loadContract (:379 → :418) and refreshDocStatus (:414).
  vi.mocked(contractService.getClauses).mockResolvedValue([] as never);
  vi.mocked(contractService.getComments).mockResolvedValue([] as never);
  vi.mocked(contractService.getApprovers).mockResolvedValue([] as never);
  vi.mocked(riskAnalysisService.getByContract).mockResolvedValue([] as never);
  vi.mocked(documentProcessingService.getDocuments).mockResolvedValue([] as never);

  // Flow services — resolved by default so a happy path needs no extra setup.
  vi.mocked(contractSharingService.getSharesByContract).mockResolvedValue([] as never);
  vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([] as never);
  vi.mocked(contractService.getSignatureStatus).mockResolvedValue({ signers: [] } as never);
  // 7.31 part 2 flow services. Both are lazy — projectService.getMembers fires
  // only when the approval modal opens (:620) and clauseService.getAll only when
  // the clause library opens (:874) — so these defaults are inert for every test
  // written before this line.
  vi.mocked(projectService.getMembers).mockResolvedValue([] as never);
  vi.mocked(clauseService.getAll).mockResolvedValue([] as never);

  // jsdom has no real window.open; stub it so the DocuSign hand-off is
  // observable. Undone by vi.unstubAllGlobals() in afterEach.
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═════════════════════════════════════════════════════════════════════════════
// Smoke — every other test in this file is meaningless if this one is red.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — signing and share (7.31)', () => {
  it('mounts and renders the contract from the primary read, not the not-found fallback', async () => {
    renderContractDetail();

    expect(await waitForPageReady()).toBeInTheDocument();
    expect(contractService.getById).toHaveBeenCalledWith('c-1');
    // 'Contract not found' is the page's own fallback when the fatal read
    // fails (:892) — its absence proves the mount recipe actually resolved.
    expect(screen.queryByText('Contract not found')).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. MARK-SIGNED — the wet-signature door into signed-state pinning.
//    Fully localized, so every assertion here is BY KEY.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — mark as signed (7.31)', () => {
  it('confirming mark-as-signed posts once and the refetched contract flips the page to the locked state', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.markAsSigned).mockResolvedValue({} as never);
    renderContractDetail(
      {},
      { pinned_at: '2026-08-01T00:00:00.000Z', pinned_version_id: 'v-4' },
    );
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: 'contract.markSigned.button' }));
    expect(
      await screen.findByRole('heading', { name: 'contract.markSigned.confirmTitle' }),
    ).toBeInTheDocument();

    // Regex: LoadingSpinner renders role="status" aria-label="Loading" INSIDE
    // this button while the request is in flight, so the accessible name gains
    // a "Loading " prefix. An exact-string name would miss it mid-request.
    await user.click(
      screen.getByRole('button', { name: /contract\.markSigned\.confirmCta/ }),
    );

    await waitFor(() => expect(contractService.markAsSigned).toHaveBeenCalledWith('c-1'));
    expect(contractService.markAsSigned).toHaveBeenCalledTimes(1);

    // Success re-reads the contract (:844) and the now-pinned payload drives
    // the UI: locked badge in, trigger gone (canMarkSigned requires
    // !isContractLocked, :828-834).
    expect(
      await screen.findByText('contract.markSigned.lockedBadge'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'contract.markSigned.button' }),
    ).not.toBeInTheDocument();
  });

  it('holds both modal buttons disabled while the mark-signed request is in flight, so a follow-up click cannot post twice', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    vi.mocked(contractService.markAsSigned).mockReturnValue(
      new Promise((res) => {
        release = () => res({} as never);
      }) as never,
    );
    renderContractDetail();
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: 'contract.markSigned.button' }));
    const confirm = await screen.findByRole('button', {
      name: /contract\.markSigned\.confirmCta/,
    });
    await user.click(confirm);

    await waitFor(() => expect(confirm).toBeDisabled());
    // t('common.cancel') occurs exactly once in the file (:2686); the other six
    // Cancel buttons are hardcoded literals in modals that are closed here.
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();

    await user.click(confirm);
    expect(contractService.markAsSigned).toHaveBeenCalledTimes(1);

    release();
    // NOTE ON WHAT THIS DOES AND DOES NOT PROVE: the only protection is the
    // React-committed `disabled` attribute (:2683, :2690) — handleMarkSigned
    // has no synchronous useRef re-entry guard. userEvent awaits a commit
    // between clicks, so this covers the realistic case. A genuine same-tick
    // double dispatch is NOT prevented by the production code.
  });

  it('surfaces a 403 as a localized in-modal alert and keeps the dialog open for a retry', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.markAsSigned).mockRejectedValue({
      response: { status: 403 },
    });
    renderContractDetail();
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: 'contract.markSigned.button' }));
    await user.click(
      await screen.findByRole('button', { name: /contract\.markSigned\.confirmCta/ }),
    );

    // Unlike share and DocuSign, this flow genuinely HAS user-facing error
    // handling (:845-859) — role="alert" is the only role attribute in the
    // whole file, so this handle is unambiguous.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'contract.markSigned.errors.noPermission',
    );
    expect(
      screen.getByRole('heading', { name: 'contract.markSigned.confirmTitle' }),
    ).toBeInTheDocument();
    expect(contractService.markAsSigned).toHaveBeenCalledTimes(1);
  });

  it('offers no mark-as-signed trigger on an already-pinned contract, showing the locked badge instead', async () => {
    // Only pinned_version_id is set — proving the OR in isContractLocked
    // (:828) rather than assuming both pin fields always travel together.
    renderContractDetail({ pinned_version_id: 'v-4' });
    await waitForPageReady();

    expect(screen.getByText('contract.markSigned.lockedBadge')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'contract.markSigned.button' }),
    ).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. DOCUSIGN — TEMPORARY-LITERAL assertions throughout: this modal contains
//    zero t() calls, no testid, no aria and no role, so visible text and
//    placeholders are the only handles available without touching production.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — DocuSign signature (7.31)', () => {
  /** The page-header trigger and the modal footer submit share the exact
   *  accessible name "Send for Signature", so getByRole would throw on
   *  multiple matches. The explicit length assertion is load-bearing: without
   *  it, a future change to the trigger's render gate would silently retarget
   *  index [1] at the wrong node. Document order puts the header first. */
  async function openSignModal(user: ReturnType<typeof userEvent.setup>) {
    const triggers = screen.getAllByRole('button', { name: 'Send for Signature' });
    expect(triggers).toHaveLength(1);
    await user.click(triggers[0]);

    const both = await screen.findAllByRole('button', { name: 'Send for Signature' });
    expect(both).toHaveLength(2);
    return both[1];
  }

  it('keeps submit disabled until a signer has both a name and an email', async () => {
    const user = userEvent.setup();
    renderContractDetail();
    await waitForPageReady();

    const submit = await openSignModal(user);
    expect(submit).toBeDisabled();

    // Name alone is not enough — the guard requires BOTH fields (:2603).
    await user.type(screen.getByPlaceholderText('Full name'), 'Jane Doe');
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Email address'), 'jane@acme.test');
    expect(submit).toBeEnabled();
  });

  it('sends the completed signer to the service and opens the returned signing URL in a separate window', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.initiateSignature).mockResolvedValue({
      signingUrl: 'https://demo.docusign.test/sign/abc123',
    } as never);
    renderContractDetail();
    await waitForPageReady();

    const submit = await openSignModal(user);
    await user.type(screen.getByPlaceholderText('Full name'), 'Jane Doe');
    await user.type(screen.getByPlaceholderText('Email address'), 'jane@acme.test');
    await user.click(submit);

    await waitFor(() =>
      expect(contractService.initiateSignature).toHaveBeenCalledWith('c-1', [
        { email: 'jane@acme.test', name: 'Jane Doe' },
      ]),
    );
    expect(window.open).toHaveBeenCalledWith(
      'https://demo.docusign.test/sign/abc123',
      '_blank',
      'width=1000,height=800',
    );
    // Modal closes on success (:801). Asserted via the signer input rather
    // than the heading, whose name collides with the two buttons.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Full name')).not.toBeInTheDocument(),
    );
  });

  it('holds submit disabled while the signature request is in flight, so a follow-up click cannot create a second envelope', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    vi.mocked(contractService.initiateSignature).mockReturnValue(
      new Promise((res) => {
        release = () => res({ signingUrl: '' } as never);
      }) as never,
    );
    renderContractDetail();
    await waitForPageReady();

    const submit = await openSignModal(user);
    await user.type(screen.getByPlaceholderText('Full name'), 'Jane Doe');
    await user.type(screen.getByPlaceholderText('Email address'), 'jane@acme.test');
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    await user.click(submit);
    expect(contractService.initiateSignature).toHaveBeenCalledTimes(1);

    release();
    // Same caveat as mark-signed: signingLoading (:2603) is a React-state
    // disabled attribute, not a synchronous re-entry guard. Two clicks inside
    // one tick would still create two envelopes.
  });

  it('CURRENT BEHAVIOUR — a failed signature request tells the user nothing: the modal stays open with the typed signer intact and no window opens', async () => {
    // ⚠️ DELIBERATE NEGATIVE TEST OF A KNOWN GAP. handleInitiateSignature's
    // catch is console.error-only (:810-812) — there is no error state, no
    // toast, no inline message anywhere in this modal. Asserting that a
    // message appears would be asserting a wish, and would fail. If real error
    // handling is added later this test SHOULD go red: update it, don't delete
    // it. The gap is reported as a finding for a separate session.
    const user = userEvent.setup();
    vi.mocked(contractService.initiateSignature).mockRejectedValue(new Error('boom'));
    renderContractDetail();
    await waitForPageReady();

    const submit = await openSignModal(user);
    await user.type(screen.getByPlaceholderText('Full name'), 'Jane Doe');
    await user.type(screen.getByPlaceholderText('Email address'), 'jane@acme.test');
    await user.click(submit);

    await waitFor(() => expect(contractService.initiateSignature).toHaveBeenCalled());
    // Modal still open with the user's input preserved (setShowSignModal(false)
    // sits inside the try, after the await).
    expect(await screen.findByPlaceholderText('Full name')).toHaveValue('Jane Doe');
    expect(screen.getByPlaceholderText('Email address')).toHaveValue('jane@acme.test');
    // No hand-off happened, and no alert was raised. queryByRole('alert') is a
    // discriminating negative: role="alert" DOES exist elsewhere in this file.
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. SHARE — TEMPORARY-LITERAL assertions: this modal is un-i18n'd. The email
//    label has no htmlFor and does not wrap the input, so getByLabelText
//    genuinely fails and the placeholder is the input's only handle.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — share contract (7.31)', () => {
  it('grants access to an org member and confirms it by name, then refreshes the share list', async () => {
    const user = userEvent.setup();
    // Same result for EVERY query: the ineffective debounce means intermediate
    // values are searched too, and one [] result would latch shareIsInternal
    // false and permanently disable the submit.
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([
      ORG_MEMBER,
    ] as never);
    vi.mocked(contractSharingService.createShare).mockResolvedValue({
      id: 'sh-1',
      shared_with_email: ORG_MEMBER.email,
      isInternal: true,
      recipientName: ORG_MEMBER.name,
    } as never);
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, ORG_MEMBER.email);

    // The suggestion button's accessible name is the concatenation of the
    // member name, the email and the "Internal" pill — hence the regex.
    const suggestion = await screen.findByRole(
      'button',
      { name: new RegExp(ORG_MEMBER.name) },
      { timeout: 3000 },
    );
    await user.click(suggestion);

    const grant = screen.getByRole('button', { name: 'Grant Access' });
    await waitFor(() => expect(grant).toBeEnabled(), { timeout: 3000 });
    await user.click(grant);

    // permission 'view' and expires_in_days 7 are the component's real initial
    // state (:311-312), not invented defaults.
    await waitFor(() =>
      expect(contractSharingService.createShare).toHaveBeenCalledWith({
        contract_id: 'c-1',
        shared_with_email: ORG_MEMBER.email,
        permission: 'view',
        expires_in_days: 7,
      }),
    );
    // The banner is a hardcoded template with DATA interpolated — matched on
    // the data fragment only, never the whole string.
    expect(
      await screen.findByText(new RegExp(`Access granted to ${ORG_MEMBER.name}`)),
    ).toBeInTheDocument();
    // Success re-reads the share list (:757): once on open, once after.
    await waitFor(() =>
      expect(contractSharingService.getSharesByContract).toHaveBeenCalledTimes(2),
    );
  });

  it('blocks the grant and swaps in a coming-soon label when the email matches nobody in the organisation', async () => {
    const user = userEvent.setup();
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([] as never);
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, 'stranger@other-firm.test');

    // No match latches shareIsInternal=false, which both disables the control
    // and relabels it (:2288, :2294) — external sharing is deliberately not
    // wired (ContractShare Step 1 deprecation).
    const blocked = await screen.findByRole(
      'button',
      { name: 'External sharing coming soon' },
      { timeout: 3000 },
    );
    expect(blocked).toBeDisabled();
    expect(contractSharingService.createShare).not.toHaveBeenCalled();
  });

  it('CURRENT BEHAVIOUR — share has no in-flight guard, so a second click while the first is pending posts a second share', async () => {
    // ⚠️ DELIBERATE NEGATIVE TEST OF A KNOWN GAP. handleShareContract (:740)
    // has no loading state and no useRef guard, and the disabled condition
    // (:2288) contains no in-flight term. Asserting toHaveBeenCalledTimes(1)
    // here would FAIL — there is genuinely no protection. This documents the
    // double-post as the current contract. If a guard is added later this test
    // SHOULD go red: rewrite it to assert 1, don't delete it. Reported as a
    // finding for a separate session.
    const user = userEvent.setup();
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([
      ORG_MEMBER,
    ] as never);
    // Never resolves: shareEmail is only cleared AFTER the await (:749), so
    // the button provably cannot disable itself in the meantime.
    vi.mocked(contractSharingService.createShare).mockReturnValue(
      new Promise(() => {}) as never,
    );
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, ORG_MEMBER.email);
    await user.click(
      await screen.findByRole(
        'button',
        { name: new RegExp(ORG_MEMBER.name) },
        { timeout: 3000 },
      ),
    );

    const grant = screen.getByRole('button', { name: 'Grant Access' });
    await waitFor(() => expect(grant).toBeEnabled(), { timeout: 3000 });

    await user.click(grant);
    expect(grant).toBeEnabled();
    await user.click(grant);

    expect(contractSharingService.createShare).toHaveBeenCalledTimes(2);
  });

  it('CURRENT BEHAVIOUR — a failed share is indistinguishable from never having clicked: no error, no confirmation, recipient retained', async () => {
    // ⚠️ DELIBERATE NEGATIVE TEST OF A KNOWN GAP. handleShareContract's catch
    // is console.error-only (:758-760): no error state, no toast, no inline
    // message. Every reset (setShareEmail(''), setShareSuccess) sits inside
    // the try after the await, so on failure the UI is byte-identical to the
    // pre-click state. The retained input and the un-refreshed share list are
    // the only observable evidence. Reported as a finding.
    const user = userEvent.setup();
    vi.mocked(contractSharingService.searchOrgMembers).mockResolvedValue([
      ORG_MEMBER,
    ] as never);
    vi.mocked(contractSharingService.createShare).mockRejectedValue(new Error('boom'));
    renderContractDetail();
    await waitForPageReady();

    const input = await openShareModal(user);
    await pasteRecipient(user, input, ORG_MEMBER.email);
    await user.click(
      await screen.findByRole(
        'button',
        { name: new RegExp(ORG_MEMBER.name) },
        { timeout: 3000 },
      ),
    );

    const grant = screen.getByRole('button', { name: 'Grant Access' });
    await waitFor(() => expect(grant).toBeEnabled(), { timeout: 3000 });
    await user.click(grant);

    await waitFor(() => expect(contractSharingService.createShare).toHaveBeenCalled());
    expect(input).toHaveValue(ORG_MEMBER.email);
    expect(screen.queryByText(/Access granted to/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // No post-success refresh — still just the one read from opening the modal.
    expect(contractSharingService.getSharesByContract).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7.31 PART 2 (S6) — three further write flows.
//
// ENTRY-POINT SMOKE TESTS FIRST. Each of the three flows below is behind a
// render gate (a tab switch, a contract status, or a modal), and an assertion
// written against a surface that never mounted fails for the wrong reason. One
// cheap test per flow proves the entry point is genuinely reachable before any
// behaviour is asserted — the same staged approach that made the part-1 mount
// clean on the first attempt.
//
// ASSERTION STYLE: all three flows are hardcoded English. The only t() calls in
// the whole page are mark-signed (:1151, :1172, :2670-:2694), four tab labels
// (:1530-:1536) and parties.swap (:1384-:1389) — verified by grep, 28 t( call
// sites total. So chrome here is reached by ROLE wherever a role exists, and
// where a literal is the only handle it is marked TEMPORARY-LITERAL and should
// become a key when these surfaces are localized. DATA (contract name, party
// names, comment bodies, member names) is asserted by literal on purpose —
// those survive translation.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — part 2 entry points reachable (7.31)', () => {
  it('reaches the comment composer by switching to the Comments tab', async () => {
    const user = userEvent.setup();
    renderContractDetail();
    await waitForPageReady();

    // The tab button gains a count pill when comments exist, so the accessible
    // name is not stable as an exact string — hence the regex.
    await user.click(screen.getByRole('button', { name: /^Comments/ }));

    expect(
      await screen.findByPlaceholderText(
        'Share your thoughts or feedback on this contract...',
      ),
    ).toBeInTheDocument();
  });

  it('reaches the request-approval modal from a DRAFT contract header', async () => {
    const user = userEvent.setup();
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: 'Request Approval' }));

    // The trigger button (:1116) and the modal heading (:2351) share the exact
    // text "Request Approval" — the ROLE is what disambiguates them.
    expect(
      await screen.findByRole('heading', { name: 'Request Approval' }),
    ).toBeInTheDocument();
  });

  it('reaches the clause library modal from a DRAFT contract with no clauses yet', async () => {
    const user = userEvent.setup();
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await user.click(screen.getByRole('button', { name: 'Add Clause' }));

    expect(await screen.findByRole('heading', { name: 'Add Clause' })).toBeInTheDocument();
    expect(clauseService.getAll).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. APPROVAL WORKFLOW — the lifecycle chokepoint. Two halves that talk to each
//    other: REQUEST moves DRAFT → PENDING_APPROVAL, REVIEW resolves it.
//    TEMPORARY-LITERAL assertions throughout — this surface has no t(), no
//    testid, no aria and no role beyond the implicit button/heading roles.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — request approval (7.31 part 2)', () => {
  /** A member who is NOT an approver. openRequestApprovalModal filters the
   *  project roster down to permission_level === 'APPROVER' (:621), so this row
   *  must never reach the modal. */
  const EDITOR_MEMBER = {
    id: 'pm-2',
    user_id: 'u-8',
    project_id: 'p-1',
    permission_level: 'EDITOR',
    user: { id: 'u-8', first_name: 'Rana', last_name: 'Habib', email: 'rana@acme.test' },
  };

  /** Opens the modal from the DRAFT header. The trigger text and the modal
   *  heading are the same string, so the assertion below is on the HEADING —
   *  proving the modal mounted, not merely that the button exists. */
  async function openApprovalModal(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Request Approval' }));
    await screen.findByRole('heading', { name: 'Request Approval' });
  }

  it('offers only project members holding APPROVER permission, and keeps the submit disabled until one is picked', async () => {
    const user = userEvent.setup();
    vi.mocked(projectService.getMembers).mockResolvedValue([
      APPROVER_MEMBER,
      EDITOR_MEMBER,
    ] as never);
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await openApprovalModal(user);

    // DATA assertions — member names survive translation.
    expect(await screen.findByText('Omar Saleh')).toBeInTheDocument();
    // The discriminating half: an EDITOR is silently dropped by the filter. Its
    // absence is the whole point of the test, so it is asserted explicitly.
    expect(screen.queryByText('Rana Habib')).not.toBeInTheDocument();

    // Name is a regex because the label carries a live selection count (:2418).
    expect(screen.getByRole('button', { name: /^Send for Review/ })).toBeDisabled();
  });

  it('sends exactly the selected approver ids, closes the modal, and re-reads the contract for its new status', async () => {
    const user = userEvent.setup();
    vi.mocked(projectService.getMembers).mockResolvedValue([APPROVER_MEMBER] as never);
    vi.mocked(contractService.requestApproval).mockResolvedValue([
      { id: 'ap-1', user_id: 'u-7', status: 'PENDING' },
    ] as never);
    renderContractDetail({ status: 'DRAFT' }, { status: 'PENDING_APPROVAL' });
    await waitForPageReady();
    expect(contractService.getById).toHaveBeenCalledTimes(1);

    await openApprovalModal(user);
    await user.click(await screen.findByRole('checkbox', { name: /Omar Saleh/ }));

    const submit = screen.getByRole('button', { name: /^Send for Review/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(contractService.requestApproval).toHaveBeenCalledWith('c-1', ['u-7']),
    );
    expect(contractService.requestApproval).toHaveBeenCalledTimes(1);

    // Success closes the modal (:637) and re-reads the contract (:635) so the
    // header picks up PENDING_APPROVAL. Both are inside the try, after the
    // await — so both are real evidence the request resolved.
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Request Approval' }),
      ).not.toBeInTheDocument(),
    );
    expect(contractService.getById).toHaveBeenCalledTimes(2);
  });

  it('holds the submit disabled while the approval request is in flight, so a second click cannot request approval twice', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    vi.mocked(projectService.getMembers).mockResolvedValue([APPROVER_MEMBER] as never);
    vi.mocked(contractService.requestApproval).mockReturnValue(
      new Promise((res) => {
        release = () => res([] as never);
      }) as never,
    );
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await openApprovalModal(user);
    await user.click(await screen.findByRole('checkbox', { name: /Omar Saleh/ }));

    const submit = screen.getByRole('button', { name: /^Send for Review/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    // Unlike share, this flow DOES carry an in-flight term: `requestingApproval`
    // sits in the disabled expression (:2413) and is set before the await (:631).
    await waitFor(() => expect(submit).toBeDisabled());
    await user.click(submit);
    expect(contractService.requestApproval).toHaveBeenCalledTimes(1);

    release();
    // Settle the release INSIDE the test rather than letting its state updates
    // land after the body returns. Resolving the promise re-enters
    // handleRequestApproval — setApprovers, a getById re-read, setContract, then
    // the modal close and the `finally` reset — and awaiting the LAST of those
    // (the modal unmounting) keeps every commit inside waitFor's act(). Without
    // this the file's act()-warning count goes 2 → 3, and that count is only a
    // useful signal while it stays at its floor. Fixed by awaiting, never by
    // wrapping in act() or muting the console.
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Request Approval' }),
      ).not.toBeInTheDocument(),
    );

    // Same caveat as part 1: this is a React-committed `disabled` attribute, not
    // a synchronous useRef re-entry guard. Two clicks inside one tick would
    // still post twice.
  });

  it('CURRENT BEHAVIOUR — a failed approval request tells the user nothing: the modal stays open with the selection intact and no alert appears', async () => {
    // ⚠️ DELIBERATE NEGATIVE TEST OF A KNOWN GAP — the same swallowed-error
    // family as the DocuSign and share tests above. handleRequestApproval's
    // catch is console.error-only (:638-640): no error state, no toast, no
    // inline message. setShowRequestApprovalModal(false) sits inside the try
    // after the await, so on failure the modal simply stays put and the user
    // cannot tell a failed submit from an unclicked button. If real error
    // handling is added later this test SHOULD go red: update it, don't delete
    // it. Reported as a finding.
    const user = userEvent.setup();
    vi.mocked(projectService.getMembers).mockResolvedValue([APPROVER_MEMBER] as never);
    vi.mocked(contractService.requestApproval).mockRejectedValue(new Error('boom'));
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();

    await openApprovalModal(user);
    await user.click(await screen.findByRole('checkbox', { name: /Omar Saleh/ }));

    const submit = screen.getByRole('button', { name: /^Send for Review/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(contractService.requestApproval).toHaveBeenCalled());
    // Modal still mounted, checkbox still ticked, no alert raised.
    // queryByRole('alert') is a discriminating negative — role="alert" DOES
    // exist elsewhere in this file (the mark-signed modal uses it).
    expect(
      await screen.findByRole('heading', { name: 'Request Approval' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Omar Saleh/ })).toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // `finally` re-enables the button (:640-642), so the user can retry blind.
    await waitFor(() => expect(submit).toBeEnabled());
    // No re-read happened — still just the mount read.
    expect(contractService.getById).toHaveBeenCalledTimes(1);
  });
});

describe('ContractDetailPage — review approval decision (7.31 part 2)', () => {
  /** The Review trigger renders only when the contract is PENDING_APPROVAL AND
   *  the logged-in user is himself a PENDING approver (:1119) — all three
   *  conditions have to line up or the button never appears. */
  const MY_PENDING_APPROVAL = {
    id: 'ap-1',
    contract_id: 'c-1',
    user_id: 'u-1',
    status: 'PENDING',
    user: { id: 'u-1', first_name: 'Lea', last_name: 'Dev' },
  };

  async function openReviewModal(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await screen.findByRole('heading', { name: 'Submit Review Decision' });
  }

  it('submits an APPROVED decision with no comment and closes the modal', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getApprovers).mockResolvedValue([
      MY_PENDING_APPROVAL,
    ] as never);
    vi.mocked(contractService.reviewApproval).mockResolvedValue([] as never);
    renderContractDetail({ status: 'PENDING_APPROVAL' }, { status: 'APPROVED' });
    await waitForPageReady();

    await openReviewModal(user);

    // The decision tile's accessible name is its heading PLUS its sub-caption,
    // so the full string is used — a bare /^Approve/ would also match the
    // "Approve Contract" submit below.
    await user.click(screen.getByRole('button', { name: 'Approve Mark as approved' }));
    await user.click(screen.getByRole('button', { name: 'Approve Contract' }));

    // `reviewComment || undefined` (:650) — an untouched textarea is '' and
    // must travel as undefined, not as an empty string.
    await waitFor(() =>
      expect(contractService.reviewApproval).toHaveBeenCalledWith(
        'c-1',
        'APPROVED',
        undefined,
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Submit Review Decision' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('refuses to submit a REJECTED decision without a comment, then sends the comment once one is written', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getApprovers).mockResolvedValue([
      MY_PENDING_APPROVAL,
    ] as never);
    vi.mocked(contractService.reviewApproval).mockResolvedValue([] as never);
    renderContractDetail({ status: 'PENDING_APPROVAL' }, { status: 'CHANGES_REQUESTED' });
    await waitForPageReady();

    await openReviewModal(user);
    await user.click(
      screen.getByRole('button', { name: 'Request Changes Return to draft' }),
    );

    // Exact name 'Request Changes' hits only the submit — the decision tile's
    // full name carries its 'Return to draft' caption.
    const submit = screen.getByRole('button', { name: 'Request Changes' });
    expect(submit).toBeDisabled();
    expect(
      screen.getByText('A comment is required when requesting changes.'),
    ).toBeInTheDocument();

    // findBy, not getBy: this placeholder only exists once reviewDecision is
    // 'REJECTED' (:2474), so it appears as the result of the click above.
    await pasteInto(
      user,
      await screen.findByPlaceholderText('Describe the changes needed...'),
      'Payment window must be 28 days.',
    );

    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(contractService.reviewApproval).toHaveBeenCalledWith(
        'c-1',
        'REJECTED',
        'Payment window must be 28 days.',
      ),
    );
    expect(contractService.reviewApproval).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. COMMENTS — post / edit / delete. TEMPORARY-LITERAL assertions for chrome;
//    comment bodies are DATA and are asserted by literal on purpose.
//
//    The composer's guest-visibility toggle is the highest-stakes assertion in
//    this file: `is_internal_note: !commentVisibleToGuest` (:575) is what keeps
//    a host's private note out of the guest's comment feed. Both polarities are
//    pinned below, because a silent inversion here is a confidentiality bug, not
//    a UI bug.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — comments (7.31 part 2)', () => {
  const COMPOSER = 'Share your thoughts or feedback on this contract...';

  /** Switches to the Comments tab and returns the composer textarea. The tab
   *  button carries a live count pill, so its name is matched by prefix. */
  async function openCommentsTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^Comments/ }));
    return screen.findByPlaceholderText(COMPOSER);
  }

  it('posts a new comment as an INTERNAL note by default, then reloads the thread and clears the composer', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.addComment).mockResolvedValue({} as never);
    renderContractDetail();
    await waitForPageReady();
    expect(contractService.getComments).toHaveBeenCalledTimes(1);

    const composer = await openCommentsTab(user);
    await pasteInto(user, composer, 'Please confirm the retention percentage.');
    await user.click(screen.getByRole('button', { name: 'Post' }));

    // FAIL-CLOSED: the toggle is untouched, so the note must be internal. The
    // inverse (is_internal_note: false) would publish a host-only note to the
    // external guest feed.
    await waitFor(() =>
      expect(contractService.addComment).toHaveBeenCalledWith('c-1', {
        content: 'Please confirm the retention percentage.',
        contract_clause_id: undefined,
        is_internal_note: true,
      }),
    );
    // Success re-reads the thread (:577) — mount read plus this one.
    await waitFor(() => expect(contractService.getComments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(composer).toHaveValue(''));
  });

  it('flips is_internal_note to false only when the author explicitly ticks "Visible to guest"', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.addComment).mockResolvedValue({} as never);
    renderContractDetail();
    await waitForPageReady();

    const composer = await openCommentsTab(user);
    await pasteInto(user, composer, 'Revised programme attached for your review.');
    await user.click(screen.getByRole('checkbox', { name: 'Visible to guest' }));
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() =>
      expect(contractService.addComment).toHaveBeenCalledWith('c-1', {
        content: 'Revised programme attached for your review.',
        contract_clause_id: undefined,
        is_internal_note: false,
      }),
    );
  });

  it('keeps Post disabled for empty and whitespace-only input, so a blank comment can never be sent', async () => {
    const user = userEvent.setup();
    renderContractDetail();
    await waitForPageReady();

    const composer = await openCommentsTab(user);
    const post = screen.getByRole('button', { name: 'Post' });
    expect(post).toBeDisabled();

    // `!newComment.trim()` (:1724) — spaces must not satisfy the guard.
    await pasteInto(user, composer, '   ');
    expect(post).toBeDisabled();

    await pasteInto(user, composer, 'x');
    expect(post).toBeEnabled();
    expect(contractService.addComment).not.toHaveBeenCalled();
  });

  it('saves an edited comment in place — new body and an "edited" marker — without refetching the thread', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getComments).mockResolvedValue([MY_COMMENT] as never);
    vi.mocked(contractService.updateComment).mockResolvedValue({} as never);
    renderContractDetail();
    await waitForPageReady();

    await openCommentsTab(user);
    expect(await screen.findByText(MY_COMMENT.content)).toBeInTheDocument();
    // The pencil has no text — `title` supplies its accessible name (:1783).
    await user.click(screen.getByRole('button', { name: 'Edit comment' }));

    // findBy, not getBy: the textarea and its Save button are mounted only
    // while `isEditing` is true (:1807-:1823), i.e. as a result of the click
    // above. A sync getBy here is a latent flake — it is the one query in this
    // file that was observed timing out under `--coverage` instrumentation,
    // where every commit is slower than RTL's default 1000 ms window.
    const editBox = await screen.findByDisplayValue(MY_COMMENT.content);
    await user.clear(editBox);
    await pasteInto(user, editBox, 'Clause 14.7 payment window is agreed at 28 days.');
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(contractService.updateComment).toHaveBeenCalledWith(
        'c-1',
        'cm-1',
        'Clause 14.7 payment window is agreed at 28 days.',
      ),
    );

    // The update is OPTIMISTIC (:591-597) — the new body must appear from local
    // state alone. If a refetch were ever added, the stale fixture returned by
    // getComments would overwrite the edit and this assertion would catch it.
    expect(
      await screen.findByText('Clause 14.7 payment window is agreed at 28 days.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(MY_COMMENT.content)).not.toBeInTheDocument();
    // updated_at is bumped past created_at, so the "edited" marker (:1744) turns
    // on. The fixture ships with the two timestamps equal, so its appearance is
    // caused by the edit and nothing else.
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(contractService.getComments).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation before deleting: cancelling sends nothing, confirming deletes the comment and drops the row', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getComments).mockResolvedValue([MY_COMMENT] as never);
    vi.mocked(contractService.deleteComment).mockResolvedValue({} as never);
    renderContractDetail();
    await waitForPageReady();

    await openCommentsTab(user);
    // The trash has no text either — `title` again (:1796).
    await user.click(screen.getByRole('button', { name: 'Delete comment' }));

    expect(
      await screen.findByRole('heading', { name: 'Delete Comment' }),
    ).toBeInTheDocument();

    // Phase 1 — back out. The dialog must be a real gate, not decoration.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Delete Comment' }),
      ).not.toBeInTheDocument(),
    );
    expect(contractService.deleteComment).not.toHaveBeenCalled();
    expect(screen.getByText(MY_COMMENT.content)).toBeInTheDocument();

    // Phase 2 — go through with it.
    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(contractService.deleteComment).toHaveBeenCalledWith('c-1', 'cm-1'),
    );
    expect(contractService.deleteComment).toHaveBeenCalledTimes(1);
    // Removal is local (:609); the empty state proves the row actually left.
    expect(
      await screen.findByText('No comments yet. Start the conversation above.'),
    ).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. CLAUSE ADD / REMOVE — the contract's substantive legal content. Both
//    controls are gated on `contract.status === 'DRAFT'` (:1588, :1640, :1673),
//    so these tests render a DRAFT contract; the last one pins the gate itself.
//    TEMPORARY-LITERAL chrome; clause titles and bodies are DATA.
// ═════════════════════════════════════════════════════════════════════════════

describe('ContractDetailPage — clause add and remove (7.31 part 2)', () => {
  /** What the contract holds AFTER the library clause is attached. */
  const ADDED_CLAUSE = {
    ...ATTACHED_CLAUSE,
    id: 'cc-9',
    clause_id: LIBRARY_CLAUSE.id,
    section_number: '19.1',
    clause: LIBRARY_CLAUSE,
  };

  /** Models a clause list that CHANGES between reads. Counter-based rather than
   *  mockResolvedValueOnce for the same reason renderContractDetail is:
   *  vi.clearAllMocks() does not drain a `...Once` queue, so a leftover could
   *  silently shift the sequence into the next test. */
  function clausesThenReloadedWith(later: unknown[]) {
    let calls = 0;
    vi.mocked(contractService.getClauses).mockImplementation(async () => {
      calls += 1;
      return (calls === 1 ? [] : later) as never;
    });
  }

  it('attaches a library clause by id, re-reads the clause list, and closes the picker', async () => {
    const user = userEvent.setup();
    vi.mocked(clauseService.getAll).mockResolvedValue([LIBRARY_CLAUSE] as never);
    vi.mocked(contractService.addClause).mockResolvedValue({} as never);
    clausesThenReloadedWith([ADDED_CLAUSE]);
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();
    expect(contractService.getClauses).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Add Clause' }));
    // The library row is a button whose accessible name is title + type + body,
    // so it is matched on the DATA fragment.
    await user.click(
      await screen.findByRole('button', { name: new RegExp(LIBRARY_CLAUSE.title) }),
    );

    // Only clause_id travels — section_number/order_index/customizations are
    // optional on the service (contractService.ts:67) and the page sends none.
    await waitFor(() =>
      expect(contractService.addClause).toHaveBeenCalledWith('c-1', {
        clause_id: 'cl-9',
      }),
    );
    // Success re-reads (:551) and closes the picker (:553) — both inside the
    // try, after the await.
    await waitFor(() => expect(contractService.getClauses).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Add Clause' })).not.toBeInTheDocument(),
    );
    // The attached clause now renders in the Clauses tab.
    expect(await screen.findByRole('heading', { name: LIBRARY_CLAUSE.title })).toBeInTheDocument();
  });

  it('removes a clause by its JUNCTION id — not the library clause id — and drops the row immediately', async () => {
    const user = userEvent.setup();
    vi.mocked(contractService.getClauses).mockResolvedValue([ATTACHED_CLAUSE] as never);
    vi.mocked(contractService.removeClause).mockResolvedValue({} as never);
    renderContractDetail({ status: 'DRAFT' });
    await waitForPageReady();
    expect(await screen.findByRole('heading', { name: 'Payment Terms' })).toBeInTheDocument();

    // No text on the control — `title` is its accessible name (:1644).
    await user.click(screen.getByRole('button', { name: 'Remove clause' }));

    // THE DISCRIMINATING ASSERTION. handleRemoveClause is handed `cc.id` (:1642)
    // and the service path is /contracts/:id/clauses/:clauseId — two different
    // ids that are easy to transpose. The fixture keeps them deliberately
    // distinct so the wrong one cannot pass.
    await waitFor(() =>
      expect(contractService.removeClause).toHaveBeenCalledWith('c-1', 'cc-1'),
    );
    expect(contractService.removeClause).not.toHaveBeenCalledWith('c-1', 'cl-1');

    // ⚠️ NOTE A REAL GAP, ASSERTED AS IT BEHAVES: a single click destroys the
    // clause binding with NO confirmation dialog — unlike deleting a comment,
    // which does gate on one (:2618). The call above having already landed is
    // the proof: nothing stood between the click and the service. If a confirm
    // step is added later this test SHOULD go red — insert the confirmation,
    // don't delete the test. Reported as a finding.
    expect(screen.queryByRole('heading', { name: /remove/i })).not.toBeInTheDocument();

    // Removal is local (:563) — no refetch, the row simply goes.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Payment Terms' })).not.toBeInTheDocument(),
    );
    expect(contractService.getClauses).toHaveBeenCalledTimes(1);
  });

  it('offers no add or remove control once the contract has left DRAFT, so approved legal content cannot be edited from this tab', async () => {
    // The default fixture is APPROVED. Both controls sit behind
    // `contract.status === 'DRAFT'`, and this is the assertion that keeps that
    // gate honest.
    vi.mocked(contractService.getClauses).mockResolvedValue([ATTACHED_CLAUSE] as never);
    renderContractDetail();
    await waitForPageReady();

    expect(await screen.findByRole('heading', { name: 'Payment Terms' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove clause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Clause' })).not.toBeInTheDocument();
    // The FIDIC-flavoured label the top control would use on a DRAFT contract
    // of this type (:1599) — its absence proves the whole DRAFT block is gone,
    // not merely the empty-state button.
    expect(
      screen.queryByRole('button', { name: 'Add Particular Conditions' }),
    ).not.toBeInTheDocument();
  });
});
