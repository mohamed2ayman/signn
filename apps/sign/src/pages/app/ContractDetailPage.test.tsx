import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import ContractDetailPage from '@/pages/app/ContractDetailPage';
import { contractService } from '@/services/api/contractService';
import { contractSharingService } from '@/services/api/contractSharingService';
import { riskAnalysisService } from '@/services/api/riskAnalysisService';
import { documentProcessingService } from '@/services/api/documentProcessingService';

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE (7.31 S2) — three flows on a 2711-line page:
//   1. MARK-SIGNED  (signed-state pinning "door 2" — handleMarkSigned, :836)
//   2. DOCUSIGN     (initiate signature + open the signing window, :793)
//   3. SHARE        (grant internal access — handleShareContract, :740)
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
// act() WARNINGS: expected and NOT fixed here. userEvent dispatches outside
// act() because two @testing-library/dom instances are installed (RTL 14.3.1
// nests 9.3.4; user-event resolves the hoisted 10.4.1). A separate PR dedupes
// them. Nothing here wraps act(), stubs console, or downgrades to fireEvent.
// ─────────────────────────────────────────────────────────────────────────────

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
