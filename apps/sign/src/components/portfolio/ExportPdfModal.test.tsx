import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import ExportPdfModal from '@/components/portfolio/ExportPdfModal';
import { portfolioService } from '@/services/api/portfolioService';

/**
 * Phase 7.17 Prompt 2c Bucket 4 — ExportPdfModal tests.
 *
 * Mock the i18n helper to return the key path verbatim — same pattern
 * the obligations modal tests use. The copy-correctness assertions
 * (1-hour expiry + re-export recovery) live on the *English source*
 * separately verified at the locale file level (exact-parity script),
 * so we don't re-litigate the actual text here; we assert the right
 * i18n keys appear, which proves the modal references the right copy.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, string>) => {
      // Interpolate {{email}} when the caller passes it so tests can
      // assert the toast was given the right destination.
      if (opts?.email && k.endsWith('recipient')) {
        return `recipient:${opts.email}`;
      }
      if (opts?.email && k.endsWith('success')) {
        return `success:${opts.email}`;
      }
      return k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api/portfolioService', () => ({
  portfolioService: { requestExport: vi.fn() },
}));

function renderModal(overrides: {
  isOpen?: boolean;
  period?: '7d' | '30d' | '90d' | '365d';
  projectId?: string;
  userEmail?: string;
  onClose?: () => void;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <QueryClientProvider client={qc}>
      <ExportPdfModal
        isOpen={overrides.isOpen ?? true}
        onClose={onClose}
        period={overrides.period ?? '90d'}
        projectId={overrides.projectId}
        userEmail={overrides.userEmail ?? 'user@example.com'}
      />
    </QueryClientProvider>,
  );
  return { ...result, onClose };
}

describe('ExportPdfModal', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('correctness copy (must reference the right i18n keys)', () => {
    it('renders the 1-hour expiry key (NOT 24h)', () => {
      renderModal();
      // The mocked t() returns the key verbatim — so finding the key
      // in the DOM proves we're rendering the 1-hour copy from the
      // locale file (which itself says "1 hour" per the script that
      // injected it with that exact text).
      expect(screen.getByText('portfolio.export.modal.expiry')).toBeInTheDocument();
    });

    it('renders the recovery-expectation key (single email, no in-app, re-export is free)', () => {
      renderModal();
      expect(screen.getByText('portfolio.export.modal.recovery')).toBeInTheDocument();
    });

    it('shows the destination email in the recipient line (interpolated from prop)', () => {
      renderModal({ userEmail: 'owner@example.com' });
      // Interpolated key per the t() mock returns `recipient:<email>`.
      expect(screen.getByText('recipient:owner@example.com')).toBeInTheDocument();
    });

    it('renders title + cancel + submit copy', () => {
      renderModal();
      expect(screen.getByText('portfolio.export.modal.title')).toBeInTheDocument();
      expect(screen.getByText('portfolio.export.modal.cancel')).toBeInTheDocument();
      expect(screen.getByText('portfolio.export.modal.submit')).toBeInTheDocument();
    });
  });

  describe('submit', () => {
    it('calls portfolioService.requestExport with the page filters and toasts the response email', async () => {
      vi.mocked(portfolioService.requestExport).mockResolvedValue({
        job_id: 'job-1',
        email: 'captured@example.com', // server-side captured value
      });
      const { onClose } = renderModal({
        period: '30d',
        projectId: 'proj-1',
        userEmail: 'client-side@example.com', // prop value
      });

      fireEvent.click(screen.getByText('portfolio.export.modal.submit'));

      await waitFor(() =>
        expect(portfolioService.requestExport).toHaveBeenCalledTimes(1),
      );
      expect(portfolioService.requestExport).toHaveBeenCalledWith('30d', 'proj-1');

      // Toast uses the SERVER's email from the response, not the
      // client-side prop — server-side is the source of truth.
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('success:captured@example.com'),
      );
      // Modal closes on success.
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('omits project_id from the request when no project filter is active', async () => {
      vi.mocked(portfolioService.requestExport).mockResolvedValue({
        job_id: 'job-2',
        email: 'u@example.com',
      });
      renderModal({ period: '90d', projectId: undefined });

      fireEvent.click(screen.getByText('portfolio.export.modal.submit'));

      await waitFor(() =>
        expect(portfolioService.requestExport).toHaveBeenCalledWith('90d', undefined),
      );
    });
  });

  describe('error handling', () => {
    it('toasts the generic error and does NOT close on non-429 failures', async () => {
      const err = { response: { status: 500 } };
      vi.mocked(portfolioService.requestExport).mockRejectedValue(err);
      const { onClose } = renderModal();

      fireEvent.click(screen.getByText('portfolio.export.modal.submit'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('portfolio.export.toast.error.generic'),
      );
      expect(onClose).not.toHaveBeenCalled();
    });

    it('toasts the rate-limit-specific error on 429', async () => {
      const err = { response: { status: 429 } };
      vi.mocked(portfolioService.requestExport).mockRejectedValue(err);
      renderModal();

      fireEvent.click(screen.getByText('portfolio.export.modal.submit'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('portfolio.export.toast.error.rateLimit'),
      );
    });
  });

  describe('cancel + close', () => {
    it('clicking Cancel calls onClose', () => {
      const { onClose } = renderModal();
      fireEvent.click(screen.getByText('portfolio.export.modal.cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not render when isOpen is false', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByText('portfolio.export.modal.title')).not.toBeInTheDocument();
    });
  });
});
