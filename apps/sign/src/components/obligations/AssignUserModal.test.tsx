import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AssignUserModal from '@/components/obligations/AssignUserModal';
import complianceService from '@/services/api/complianceService';
import { projectService } from '@/services/api/projectService';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';
import type { ProjectMember } from '@/types';
import { PermissionLevel } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/api/complianceService', () => ({
  default: { assignObligation: vi.fn(), unassignObligation: vi.fn() },
}));
vi.mock('@/services/api/projectService', () => ({
  projectService: { getMembers: vi.fn() },
}));

const MEMBERS: ProjectMember[] = [
  {
    id: 'm-1',
    project_id: 'p-1',
    user_id: 'u-1',
    role: 'Contracts Manager',
    permission_level: PermissionLevel.EDITOR,
    added_at: new Date().toISOString(),
    user: {
      id: 'u-1',
      organization_id: 'o-1',
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      role: 'OWNER_ADMIN' as never,
      job_title: 'Contracts Manager',
      default_permission_level: PermissionLevel.EDITOR,
      is_active: true,
      is_email_verified: true,
      mfa_enabled: false,
      mfa_method: null,
      preferred_language: 'en',
      last_login_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  },
];

const OBL: ObligationPortfolioItem = {
  id: 'ob-1',
  contract_id: 'c-1',
  project_id: 'p-1',
  compliance_check_id: null,
  contract_clause_id: null,
  description: 'Submit progress report',
  responsible_party: 'CONTRACTOR',
  obligation_type: 'REPORTING',
  clause_ref: null,
  due_date: new Date().toISOString(),
  duration: null,
  timeframe_description: null,
  amount: null,
  currency: null,
  is_critical: false,
  status: 'PENDING',
  completed_at: null,
  evidence_url: null,
  created_at: new Date().toISOString(),
  assignees: [],
};

function renderModal(obligation: ObligationPortfolioItem | null = OBL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AssignUserModal
        isOpen
        onClose={() => {}}
        obligation={obligation}
        contractId="c-1"
        projectId="p-1"
      />
    </QueryClientProvider>,
  );
}

describe('AssignUserModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectService.getMembers).mockResolvedValue(MEMBERS);
  });

  it('lists team members for the project in the assignable picker', async () => {
    renderModal();
    await screen.findByText(/Alice Smith/);
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('renders an empty assignees state ("Unassigned") when none are present', () => {
    renderModal();
    expect(screen.getByText('obligation.ui.unassigned')).toBeInTheDocument();
  });

  it('calls assignObligation when a team member is clicked', async () => {
    vi.mocked(complianceService.assignObligation).mockResolvedValue({} as never);
    renderModal();
    const item = await screen.findByText(/Alice Smith/);
    fireEvent.click(item.closest('button')!);
    await waitFor(() =>
      expect(complianceService.assignObligation).toHaveBeenCalledWith('c-1', 'ob-1', 'u-1'),
    );
  });

  it('returns null when obligation prop is null', () => {
    const { container } = renderModal(null);
    expect(container.textContent).toBe('');
  });
});
