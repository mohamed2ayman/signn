import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ImportContractModal from '@/components/guest/ImportContractModal';
import { projectService } from '@/services/api/projectService';
import { importSharedContract } from '@/services/api/guestService';

import en from '@/i18n/locales/en/common.json';
import ar from '@/i18n/locales/ar/common.json';
import fr from '@/i18n/locales/fr/common.json';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
  }),
}));
vi.mock('@/services/api/projectService', () => ({
  projectService: { getAll: vi.fn() },
}));
vi.mock('@/services/api/guestService', () => ({
  importSharedContract: vi.fn(),
}));
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const PROJECTS = [
  { id: 'p-1', name: 'Metro Phase 2' },
  { id: 'p-2', name: 'Bridge Works' },
] as any[];

function renderModal(overrides: Partial<Parameters<typeof ImportContractModal>[0]> = {}) {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ImportContractModal
          isOpen
          onClose={onClose}
          contractId="c-1"
          contractName="Alexandria Metro Line 3"
          sharedByOrg="Acme Construction"
          guestJwt="managing-token"
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose, ...utils };
}

function axiosError(status: number, data?: Record<string, unknown>): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

describe('ImportContractModal (#8d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectService.getAll).mockResolvedValue(PROJECTS);
  });

  it('confirm state: renders the three semantics + the destination picker with the importer\'s real projects', async () => {
    renderModal();
    expect(screen.getByText('sharedWithMe.import.point1.title')).toBeInTheDocument();
    expect(screen.getByText('sharedWithMe.import.point2.title')).toBeInTheDocument();
    expect(screen.getByText('sharedWithMe.import.point3.title')).toBeInTheDocument();
    // The sharing-org param threads into the copy semantics.
    expect(
      screen.getByText('sharedWithMe.import.point1.body:{"org":"Acme Construction"}'),
    ).toBeInTheDocument();
    // Picker lists the caller's own projects.
    const select = (await screen.findByTestId(
      'import-project-select',
    )) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['Metro Phase 2', 'Bridge Works']);
  });

  it('confirm calls the import endpoint with the CHOSEN project + the managing token', async () => {
    vi.mocked(importSharedContract).mockResolvedValue({
      id: 'new-1',
      name: 'Alexandria Metro Line 3',
      project_id: 'p-2',
    });
    renderModal();
    const select = (await screen.findByTestId(
      'import-project-select',
    )) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'p-2' } });
    fireEvent.click(screen.getByTestId('import-confirm'));
    await waitFor(() =>
      expect(importSharedContract).toHaveBeenCalledWith('c-1', 'managing-token', 'p-2'),
    );
  });

  it('success: shows the success state; "Open my copy" navigates to the NEW contract in the managing app', async () => {
    vi.mocked(importSharedContract).mockResolvedValue({
      id: 'new-1',
      name: 'Alexandria Metro Line 3',
      project_id: 'p-1',
    });
    renderModal();
    await screen.findByTestId('import-project-select');
    fireEvent.click(screen.getByTestId('import-confirm'));
    await screen.findByTestId('import-success');
    expect(screen.getByText('sharedWithMe.import.successTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('import-open-copy'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/contracts/new-1');
  });

  it('revoked: a 404 (binding gone) shows the unified "Import failed" layout with the revoked cause + the way back', async () => {
    vi.mocked(importSharedContract).mockRejectedValue(axiosError(404));
    renderModal();
    await screen.findByTestId('import-project-select');
    fireEvent.click(screen.getByTestId('import-confirm'));
    await screen.findByTestId('import-error');
    // The design's unified failure: one "Import failed" title, the cause in
    // the body (the shipped revoked sentences), Try again + the filled
    // Back-to-Shared-with-me action.
    expect(screen.getByText('sharedWithMe.import.failTitle')).toBeInTheDocument();
    expect(
      screen.getByText(/sharedWithMe\.revoked\.title sharedWithMe\.revoked\.body/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('import-retry')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('import-back-to-shared'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/shared-with-me');
    expect(screen.queryByText('sharedWithMe.import.failBody')).not.toBeInTheDocument();
  });

  it('plan-limit branch exists (DORMANT — no backend quota emits it in v1): unified layout + View plans', async () => {
    vi.mocked(importSharedContract).mockRejectedValue(
      axiosError(403, { code: 'PLAN_LIMIT_CONTRACTS' }),
    );
    renderModal();
    await screen.findByTestId('import-project-select');
    fireEvent.click(screen.getByTestId('import-confirm'));
    await screen.findByTestId('import-error');
    expect(screen.getByText('sharedWithMe.import.failTitle')).toBeInTheDocument();
    expect(screen.getByText('sharedWithMe.import.planLimitBody')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('import-view-plans'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/settings/subscription');
  });

  it('generic failure → "Try again" returns to confirm and a deliberate retry re-POSTs (guard releases — lesson #238)', async () => {
    vi.mocked(importSharedContract)
      .mockRejectedValueOnce(axiosError(500))
      .mockResolvedValueOnce({ id: 'new-2', name: 'X', project_id: 'p-1' });
    renderModal();
    await screen.findByTestId('import-project-select');
    fireEvent.click(screen.getByTestId('import-confirm'));
    await screen.findByTestId('import-error');
    expect(screen.getByText('sharedWithMe.import.failTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('import-retry'));
    fireEvent.click(await screen.findByTestId('import-confirm'));
    await screen.findByTestId('import-success');
    expect(importSharedContract).toHaveBeenCalledTimes(2);
  });

  it('a same-tick double-click produces exactly ONE request (synchronous in-flight guard)', async () => {
    let resolveImport: (v: any) => void = () => {};
    vi.mocked(importSharedContract).mockImplementation(
      () => new Promise((res) => (resolveImport = res)),
    );
    renderModal();
    await screen.findByTestId('import-project-select');
    const btn = screen.getByTestId('import-confirm');
    fireEvent.click(btn);
    fireEvent.click(btn); // second click before React commits any state
    resolveImport({ id: 'new-3', name: 'X', project_id: 'p-1' });
    await screen.findByTestId('import-success');
    expect(importSharedContract).toHaveBeenCalledTimes(1);
  });

  it('close is INERT while the import is in flight (Escape does not dismiss a running write)', async () => {
    let resolveImport: (v: any) => void = () => {};
    vi.mocked(importSharedContract).mockImplementation(
      () => new Promise((res) => (resolveImport = res)),
    );
    const { onClose } = renderModal();
    await screen.findByTestId('import-project-select');
    fireEvent.click(screen.getByTestId('import-confirm'));
    await screen.findByTestId('import-importing');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    resolveImport({ id: 'new-4', name: 'X', project_id: 'p-1' });
    await screen.findByTestId('import-success');
    // After terminal state, close works again.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('no projects → the "create a project first" hint and a disabled confirm', async () => {
    vi.mocked(projectService.getAll).mockResolvedValue([]);
    renderModal();
    await screen.findByTestId('import-no-projects');
    expect(screen.getByTestId('import-confirm')).toBeDisabled();
    expect(importSharedContract).not.toHaveBeenCalled();
  });
});

describe('sharedWithMe.import i18n — exact en/ar/fr parity + real Arabic (lesson #262)', () => {
  const flat = (obj: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null
        ? flat(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`],
    );

  it('the import block has identical key sets in en, ar and fr', () => {
    const enKeys = flat((en as any).sharedWithMe.import).sort();
    const arKeys = flat((ar as any).sharedWithMe.import).sort();
    const frKeys = flat((fr as any).sharedWithMe.import).sort();
    expect(arKeys).toEqual(enKeys);
    expect(frKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThanOrEqual(20);
  });

  it('the Arabic strings are REAL Arabic script — not mojibake, not English', () => {
    const block = (ar as any).sharedWithMe.import;
    const arabicRe = /[؀-ۿ]/;
    expect(block.button).toBe('استيراد إلى مساحة عملي');
    for (const key of ['title', 'confirm', 'successTitle', 'failTitle', 'open', 'stay']) {
      expect(block[key]).toMatch(arabicRe);
    }
    // The classic mojibake signature (UTF-8 read as Latin-1) never appears.
    expect(JSON.stringify(block)).not.toMatch(/Ø|Ù|Ã/);
  });
});
