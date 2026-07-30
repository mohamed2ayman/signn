import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PlaybookHouseRulesCard from './PlaybookHouseRulesCard';
import playbookService, {
  type PlaybookPosition,
} from '@/services/api/playbookService';
import { UserRole } from '@/types';

const navigate = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (!opts) return k;
      const { defaultValue, ...rest } = opts as Record<string, unknown>;
      const parts = Object.keys(rest)
        .sort()
        .map((key) => `${key}=${String(rest[key])}`);
      return parts.length ? `${k}(${parts.join(',')})` : k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

let mockRole: UserRole | undefined = UserRole.OWNER_ADMIN;
vi.mock('react-redux', () => ({
  useSelector: (sel: (s: unknown) => unknown) =>
    sel({ auth: { user: mockRole ? { id: 'u1', role: mockRole } : null } }),
}));

vi.mock('@/services/api/playbookService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/api/playbookService')>();
  return { ...actual, default: { list: vi.fn() } };
});

const svc = playbookService as unknown as Record<string, ReturnType<typeof vi.fn>>;

function position(over: Partial<PlaybookPosition> = {}): PlaybookPosition {
  return {
    id: 'p1',
    organization_id: 'org1',
    scope: 'ORG',
    project_id: null,
    contract_id: null,
    clause_type: 'payment',
    is_custom_clause_type: false,
    rule_type: 'REQUIRED',
    value_config: { required: true },
    note: null,
    is_active: true,
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlaybookHouseRulesCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = UserRole.OWNER_ADMIN;
  svc.list.mockResolvedValue([]);
});

describe('PlaybookHouseRulesCard — role gate', () => {
  it('renders for OWNER_ADMIN', async () => {
    renderCard();
    expect(await screen.findByText('playbook.kbCard.title')).toBeInTheDocument();
  });

  it.each([
    UserRole.SYSTEM_ADMIN,
    UserRole.OWNER_CREATOR,
    UserRole.OWNER_REVIEWER,
    UserRole.CONTRACTOR_ADMIN,
  ])('renders NOTHING for %s', (role) => {
    mockRole = role;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no user', () => {
    mockRole = undefined;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('NEVER fires the OWNER_ADMIN-only request for a non-OWNER_ADMIN', async () => {
    // The API is @Roles(OWNER_ADMIN) exact-match — an ungated fetch would be a
    // guaranteed 403 on every Knowledge Base visit for most of the org.
    mockRole = UserRole.OWNER_CREATOR;
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('SYSTEM_ADMIN is excluded too — the guard is membership, not hierarchy', async () => {
    mockRole = UserRole.SYSTEM_ADMIN;
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.list).not.toHaveBeenCalled();
  });
});

describe('PlaybookHouseRulesCard — content', () => {
  it('shows coverage out of 17', async () => {
    svc.list.mockResolvedValue([
      position({ id: 'a', clause_type: 'payment' }),
      position({ id: 'b', clause_type: 'liability' }),
    ]);
    renderCard();
    expect(
      await screen.findByText('playbook.kbCard.coverage(covered=2,total=17)'),
    ).toBeInTheDocument();
  });

  it('shows 0 of 17 for an empty playbook rather than hiding', async () => {
    svc.list.mockResolvedValue([]);
    renderCard();
    expect(
      await screen.findByText('playbook.kbCard.coverage(covered=0,total=17)'),
    ).toBeInTheDocument();
  });

  it('shows an error line instead of a wrong number when the fetch fails', async () => {
    svc.list.mockRejectedValueOnce(new Error('boom'));
    renderCard();
    expect(await screen.findByText('playbook.kbCard.error')).toBeInTheDocument();
    expect(
      screen.queryByText(/playbook\.kbCard\.coverage/),
    ).not.toBeInTheDocument();
  });

  it('routes to the manager page', async () => {
    renderCard();
    await userEvent.click(
      await screen.findByRole('button', { name: /playbook\.kbCard\.manage/ }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/app/settings/playbook'),
    );
  });
});
