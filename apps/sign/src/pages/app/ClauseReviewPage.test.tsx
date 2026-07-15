import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import ClauseReviewPage from '@/pages/app/ClauseReviewPage';
import { clauseReviewService } from '@/services/api/clauseReviewService';
import { contractService } from '@/services/api/contractService';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { ClauseReviewStatus } from '@/types';

// Service-level mocks only — axios.ts side-effect-loads the Redux store (lesson #37),
// so never mock at the axios layer.
vi.mock('@/services/api/clauseReviewService', () => ({
  clauseReviewService: {
    getClausesForReview: vi.fn(),
    updateClauseReview: vi.fn(),
    bulkApproveReview: vi.fn(),
    finalizeReview: vi.fn(),
  },
}));
vi.mock('@/services/api/contractService', () => ({
  contractService: { getById: vi.fn() },
}));
vi.mock('@/services/api/documentProcessingService', () => ({
  documentProcessingService: { getDocuments: vi.fn(), updateExtractedText: vi.fn() },
}));

// Child components stubbed to avoid deep rendering / i18n.
vi.mock('@/components/review/ClauseReviewCard', () => ({
  default: () => <div data-testid="clause-card" />,
}));
vi.mock('@/components/common/AIDisclaimer', () => ({ default: () => null }));

const mkDoc = (over: Partial<Record<string, unknown>>): any => ({
  id: 'x',
  contract_id: 'c1',
  organization_id: 'o1',
  file_url: '',
  file_name: 'f.docx',
  original_name: null,
  file_size: null,
  mime_type: null,
  document_priority: 0,
  document_label: null,
  processing_status: 'CLAUSES_EXTRACTED',
  extracted_text: '',
  page_count: null,
  error_message: null,
  quality_flags: null,
  processing_job_id: null,
  uploaded_by: 'u',
  created_at: '',
  updated_at: '',
  ...over,
});

const mkCC = (
  id: string,
  srcDoc: string,
  status: ClauseReviewStatus,
  section: string,
): any => ({
  id: `cc-${id}`,
  section_number: section,
  is_proposed: false,
  clause: {
    id,
    source_document_id: srcDoc,
    review_status: status,
    content: 'clause text',
    title: 'title',
  },
});

// getDocuments returns rows already sorted by document_priority ASC (the backend
// contract — PR #137). A(1) Appendix, B(2) Other, C(3) Other with ZERO clauses.
// B & C share document_label "Other" → both must fall back to their filename.
const DOCS = [
  mkDoc({ id: 'a', document_priority: 1, document_label: 'Appendix', file_name: 'appendix.docx', original_name: 'appendix.docx' }),
  mkDoc({ id: 'b', document_priority: 2, document_label: 'Other', file_name: 'other-b.docx', original_name: 'Other B.docx' }),
  mkDoc({ id: 'c', document_priority: 3, document_label: 'Other', file_name: 'other-c.docx', original_name: 'Other C.docx' }),
];
const CLAUSES = [
  mkCC('cl1', 'a', ClauseReviewStatus.PENDING_REVIEW, '1'),
  mkCC('cl2', 'b', ClauseReviewStatus.APPROVED, '2'),
  // doc 'c' intentionally has NO clauses (zero-clause document)
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/contracts/c1/review']}>
      <Routes>
        <Route path="/app/contracts/:id/review" element={<ClauseReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (documentProcessingService.getDocuments as any).mockResolvedValue(DOCS);
  (clauseReviewService.getClausesForReview as any).mockResolvedValue(CLAUSES);
  (contractService.getById as any).mockResolvedValue({
    id: 'c1',
    name: 'Project14',
    party_first_name: null,
    party_second_name: null,
    project_id: 'p1',
  });
});

describe('ClauseReviewPage — document tabs (Issue 3)', () => {
  it('renders one tab button per document returned by getDocuments', async () => {
    renderPage();
    const tabs = await screen.findAllByTestId('doc-tab');
    expect(tabs).toHaveLength(DOCS.length); // 3
  });

  it('falls back to the filename when 2+ documents share a document_label', async () => {
    renderPage();
    const tabs = await screen.findAllByTestId('doc-tab');
    const texts = tabs.map((t) => t.textContent ?? '');

    // A's label is unique → it keeps "Appendix".
    expect(texts[0]).toContain('Appendix');
    // B and C both carry document_label "Other" → each falls back to its filename.
    expect(texts[1]).toContain('Other B.docx');
    expect(texts[2]).toContain('Other C.docx');
    // No tab is left as the ambiguous bare "Other (…)".
    expect(texts.some((t) => /^\s*Other\s*\(/.test(t))).toBe(false);
    // Every tab carries the full filename as a tooltip.
    tabs.forEach((t) => expect(t.getAttribute('title')).toBeTruthy());
  });

  it('a zero-clause document keeps its tab and shows the empty state when selected', async () => {
    renderPage();
    const tabs = await screen.findAllByTestId('doc-tab');
    // Doc C has a tab and shows a (0) count.
    expect(tabs[2].textContent).toContain('(0)');

    fireEvent.click(tabs[2]);
    await waitFor(() =>
      expect(screen.getByText('No clauses in this document')).toBeInTheDocument(),
    );
  });

  it('renders tabs in document_priority order (PR #137 shared-ordering guard)', async () => {
    renderPage();
    const tabs = await screen.findAllByTestId('doc-tab');
    const order = tabs.map((t) => t.textContent ?? '');
    expect(order[0]).toContain('Appendix'); // priority 1
    expect(order[1]).toContain('Other B.docx'); // priority 2
    expect(order[2]).toContain('Other C.docx'); // priority 3
  });
});
