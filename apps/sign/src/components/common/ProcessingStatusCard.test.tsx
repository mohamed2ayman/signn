import { render, screen } from '@testing-library/react';

import ProcessingStatusCard from '@/components/common/ProcessingStatusCard';
import { DocumentProcessingStatus } from '@/types';
import type { DocumentUpload } from '@/types';
import enCommon from '@/i18n/locales/en/common.json';
import arCommon from '@/i18n/locales/ar/common.json';
import frCommon from '@/i18n/locales/fr/common.json';

// t() returns the key (repo convention) — so the banner renders the i18n KEY string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const CORRUPTION_KEY = 'document.processing.qualityWarning.textCorruption';

function makeDoc(overrides: Partial<DocumentUpload>): DocumentUpload {
  return {
    id: 'doc-1',
    file_name: 'Project10.pdf',
    original_name: 'Project10.pdf',
    document_label: 'Contract Agreement',
    mime_type: 'application/pdf',
    error_message: null,
    processing_status: DocumentProcessingStatus.CLAUSES_EXTRACTED,
    quality_flags: null,
    page_count: 5,
    ...overrides,
  } as unknown as DocumentUpload;
}

describe('ProcessingStatusCard — text-corruption banner (Fix #2)', () => {
  it('renders the textCorruption advisory when quality_flags carries the corruption flag', () => {
    render(
      <ProcessingStatusCard
        document={makeDoc({
          processing_status: DocumentProcessingStatus.CLAUSES_EXTRACTED,
          quality_flags: ['text_corruption_suspected:61.3'],
        })}
      />,
    );
    expect(screen.getByText(CORRUPTION_KEY)).toBeInTheDocument();
  });

  it('renders NO corruption banner when quality_flags is null (clean doc)', () => {
    render(<ProcessingStatusCard document={makeDoc({ quality_flags: null })} />);
    expect(screen.queryByText(CORRUPTION_KEY)).not.toBeInTheDocument();
  });

  it('renders NO corruption banner when quality_flags is empty', () => {
    render(<ProcessingStatusCard document={makeDoc({ quality_flags: [] })} />);
    expect(screen.queryByText(CORRUPTION_KEY)).not.toBeInTheDocument();
  });

  it('does NOT show the corruption banner for an unrelated flag (blur only)', () => {
    render(
      <ProcessingStatusCard
        document={makeDoc({ quality_flags: ['blur:12.0'] })}
      />,
    );
    expect(screen.queryByText(CORRUPTION_KEY)).not.toBeInTheDocument();
  });

  it('i18n parity: the textCorruption key is present in EN, AR and FR', () => {
    for (const loc of [enCommon, arCommon, frCommon]) {
      const v = (loc as Record<string, any>).document.processing.qualityWarning
        .textCorruption;
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
