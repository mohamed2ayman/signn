import { render, screen, fireEvent } from '@testing-library/react';

import DocumentsNeedingReview, {
  docNeedsReview,
} from '@/components/contracts/DocumentsNeedingReview';
import { DocumentProcessingStatus } from '@/types';
import type { DocumentUpload } from '@/types';
import enCommon from '@/i18n/locales/en/common.json';
import arCommon from '@/i18n/locales/ar/common.json';
import frCommon from '@/i18n/locales/fr/common.json';

// t() returns the key (repo convention) — so banners/headings render the i18n KEY.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const HEADING_KEY = 'document.processing.needsReviewHeading';
const INCOMPLETE_TITLE_KEY = 'document.processing.incompleteExtractionTitle';
const RERUN_KEY = 'document.processing.rerunExtraction';
const CORRUPTION_KEY = 'document.processing.qualityWarning.textCorruption';

function makeDoc(overrides: Partial<DocumentUpload>): DocumentUpload {
  return {
    id: 'doc-1',
    file_name: 'Project10.pdf',
    original_name: 'Project10.pdf',
    document_label: 'General Conditions',
    mime_type: 'application/pdf',
    error_message: null,
    processing_status: DocumentProcessingStatus.CLAUSES_EXTRACTED,
    quality_flags: null,
    page_count: 5,
    ...overrides,
  } as unknown as DocumentUpload;
}

// ── docNeedsReview predicate ──────────────────────────────────────────────
describe('docNeedsReview', () => {
  it('true — terminal (CLAUSES_EXTRACTED) + incomplete flag', () => {
    expect(
      docNeedsReview(
        makeDoc({ quality_flags: ['clause_extraction_incomplete:2'] }),
      ),
    ).toBe(true);
  });

  it('true — terminal + corruption flag', () => {
    expect(
      docNeedsReview(
        makeDoc({ quality_flags: ['text_corruption_suspected:61.3'] }),
      ),
    ).toBe(true);
  });

  it('false — terminal + no flag', () => {
    expect(docNeedsReview(makeDoc({ quality_flags: null }))).toBe(false);
    expect(docNeedsReview(makeDoc({ quality_flags: [] }))).toBe(false);
    expect(docNeedsReview(makeDoc({ quality_flags: ['blur:12.0'] }))).toBe(false);
  });

  it('false — in-progress doc even WITH a flag (belongs to the in-progress panel)', () => {
    expect(
      docNeedsReview(
        makeDoc({
          processing_status: DocumentProcessingStatus.EXTRACTING_CLAUSES,
          quality_flags: ['clause_extraction_incomplete:2'],
        }),
      ),
    ).toBe(false);
  });

  it('false — null quality_flags', () => {
    expect(docNeedsReview(makeDoc({ quality_flags: null }))).toBe(false);
  });
});

// ── DocumentsNeedingReview component ──────────────────────────────────────
describe('DocumentsNeedingReview', () => {
  it('incomplete doc → renders the card + banner + working reprocess button', () => {
    const onReprocess = vi.fn();
    render(
      <DocumentsNeedingReview
        documents={[
          makeDoc({
            id: 'doc-9',
            quality_flags: ['clause_extraction_incomplete:2'],
          }),
        ]}
        onReprocess={onReprocess}
      />,
    );
    // panel heading + the incomplete banner + the re-run button all present
    expect(screen.getByText(HEADING_KEY)).toBeInTheDocument();
    expect(screen.getByText(INCOMPLETE_TITLE_KEY)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: RERUN_KEY });
    fireEvent.click(btn);
    expect(onReprocess).toHaveBeenCalledWith('doc-9');
  });

  it('corruption doc → renders the corruption banner (one fix covers both flags)', () => {
    render(
      <DocumentsNeedingReview
        documents={[
          makeDoc({
            id: 'doc-c',
            quality_flags: ['text_corruption_suspected:61.3'],
          }),
        ]}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.getByText(HEADING_KEY)).toBeInTheDocument();
    expect(screen.getByText(CORRUPTION_KEY)).toBeInTheDocument();
  });

  it('clean terminal doc → renders NOTHING (no false review panel)', () => {
    const { container } = render(
      <DocumentsNeedingReview
        documents={[makeDoc({ quality_flags: null })]}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.queryByText(HEADING_KEY)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('in-progress flagged doc → renders NOTHING (left to the in-progress panel)', () => {
    render(
      <DocumentsNeedingReview
        documents={[
          makeDoc({
            processing_status: DocumentProcessingStatus.EXTRACTING_CLAUSES,
            quality_flags: ['clause_extraction_incomplete:2'],
          }),
        ]}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.queryByText(HEADING_KEY)).not.toBeInTheDocument();
  });

  it('i18n parity: needsReviewHeading present in EN, AR and FR', () => {
    for (const loc of [enCommon, arCommon, frCommon]) {
      const v = (loc as Record<string, any>).document.processing
        .needsReviewHeading;
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
