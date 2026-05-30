import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ExportPdfButton from '@/components/portfolio/ExportPdfButton';

/**
 * Phase 7.17 Prompt 2c Bucket 4 — ExportPdfButton tests.
 *
 * Thin wrapper: button → toggles modal open. The modal's behavior is
 * covered by ExportPdfModal.test.tsx; this spec only asserts the
 * trigger contract.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api/portfolioService', () => ({
  portfolioService: { requestExport: vi.fn() },
}));

function renderButton(disabled = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExportPdfButton
        period="90d"
        projectId={undefined}
        userEmail="user@example.com"
        disabled={disabled}
      />
    </QueryClientProvider>,
  );
}

describe('ExportPdfButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the i18n button label', () => {
    renderButton();
    expect(screen.getByText('portfolio.export.button')).toBeInTheDocument();
  });

  it('opens the modal when clicked (modal title becomes visible)', () => {
    renderButton();
    // Modal is closed initially — its title is not in the DOM.
    expect(screen.queryByText('portfolio.export.modal.title')).not.toBeInTheDocument();
    // Click the button.
    fireEvent.click(screen.getByText('portfolio.export.button'));
    // Modal opens — its title appears.
    expect(screen.getByText('portfolio.export.modal.title')).toBeInTheDocument();
  });

  it('closes the modal when Cancel is clicked', () => {
    renderButton();
    fireEvent.click(screen.getByText('portfolio.export.button'));
    expect(screen.getByText('portfolio.export.modal.title')).toBeInTheDocument();
    fireEvent.click(screen.getByText('portfolio.export.modal.cancel'));
    expect(screen.queryByText('portfolio.export.modal.title')).not.toBeInTheDocument();
  });

  it('respects the disabled prop and does not open the modal', () => {
    renderButton(true);
    const btn = screen.getByText('portfolio.export.button').closest('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn!);
    expect(screen.queryByText('portfolio.export.modal.title')).not.toBeInTheDocument();
  });
});
