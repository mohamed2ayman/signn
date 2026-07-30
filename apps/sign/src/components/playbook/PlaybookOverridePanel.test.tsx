import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  PlaybookOverrideBanner,
  PlaybookOverrideModal,
  AdjustStandardButton,
  overridesForContract,
  effectivePositionFor,
} from './PlaybookOverridePanel';
import playbookService, {
  type PlaybookPosition,
} from '@/services/api/playbookService';
import { UserRole } from '@/types';

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

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

let mockRole: UserRole | undefined = UserRole.OWNER_ADMIN;
vi.mock('react-redux', () => ({
  useSelector: (sel: (s: unknown) => unknown) =>
    sel({ auth: { user: mockRole ? { id: 'u1', role: mockRole } : null } }),
}));

vi.mock('@/services/api/playbookService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/api/playbookService')>();
  return { ...actual, default: { list: vi.fn(), create: vi.fn() } };
});

const svc = playbookService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const CONTRACT = 'contract-1';
const PROJECT = 'project-1';

function position(over: Partial<PlaybookPosition> = {}): PlaybookPosition {
  return {
    id: 'p1',
    organization_id: 'org1',
    scope: 'ORG',
    project_id: null,
    contract_id: null,
    clause_type: 'payment',
    is_custom_clause_type: false,
    rule_type: 'RANGE',
    value_config: { min: 28, max: 45, unit: 'days' },
    note: null,
    is_active: true,
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = UserRole.OWNER_ADMIN;
  svc.list.mockResolvedValue([]);
});

// ═══ Pure precedence helpers ══════════════════════════════════════════════════

describe('overridesForContract', () => {
  it('counts CONTRACT rows for this contract and PROJECT rows for its project', () => {
    const rows = [
      position({ id: 'org' }),
      position({ id: 'ctr', scope: 'CONTRACT', contract_id: CONTRACT }),
      position({ id: 'proj', scope: 'PROJECT', project_id: PROJECT }),
      position({ id: 'other-ctr', scope: 'CONTRACT', contract_id: 'nope' }),
      position({ id: 'other-proj', scope: 'PROJECT', project_id: 'nope' }),
    ];
    expect(
      overridesForContract(rows, CONTRACT, PROJECT).map((p) => p.id).sort(),
    ).toEqual(['ctr', 'proj']);
  });

  it('ignores PROJECT rows when the contract has no project', () => {
    const rows = [position({ id: 'proj', scope: 'PROJECT', project_id: PROJECT })];
    expect(overridesForContract(rows, CONTRACT, null)).toEqual([]);
  });
});

describe('effectivePositionFor — mirrors the backend precedence', () => {
  const org = position({ id: 'org', scope: 'ORG' });
  const proj = position({ id: 'proj', scope: 'PROJECT', project_id: PROJECT });
  const ctr = position({ id: 'ctr', scope: 'CONTRACT', contract_id: CONTRACT });

  it('CONTRACT beats PROJECT beats ORG', () => {
    expect(
      effectivePositionFor([org, proj, ctr], 'payment', CONTRACT, PROJECT)?.id,
    ).toBe('ctr');
    expect(effectivePositionFor([org, proj], 'payment', CONTRACT, PROJECT)?.id).toBe(
      'proj',
    );
    expect(effectivePositionFor([org], 'payment', CONTRACT, PROJECT)?.id).toBe('org');
  });

  it('excludes inactive rows', () => {
    expect(
      effectivePositionFor(
        [org, { ...ctr, is_active: false }],
        'payment',
        CONTRACT,
        PROJECT,
      )?.id,
    ).toBe('org');
  });

  it('ignores rows bound to a different contract or project', () => {
    expect(
      effectivePositionFor(
        [
          position({ id: 'x', scope: 'CONTRACT', contract_id: 'other' }),
          position({ id: 'y', scope: 'PROJECT', project_id: 'other' }),
        ],
        'payment',
        CONTRACT,
        PROJECT,
      ),
    ).toBeNull();
  });

  it('matches the clause type case-insensitively, like the resolver', () => {
    expect(
      effectivePositionFor(
        [position({ id: 'o', clause_type: '  Payment ' })],
        'payment',
        CONTRACT,
        PROJECT,
      )?.id,
    ).toBe('o');
  });

  it('returns null when nothing governs the clause type', () => {
    expect(effectivePositionFor([org], 'liability', CONTRACT, PROJECT)).toBeNull();
  });
});

// ═══ Banner ═══════════════════════════════════════════════════════════════════

describe('PlaybookOverrideBanner', () => {
  it('states which playbook is in use and counts this contract’s overrides', async () => {
    svc.list.mockResolvedValue([
      position({ id: 'org' }),
      position({ id: 'ctr', scope: 'CONTRACT', contract_id: CONTRACT }),
    ]);
    wrap(<PlaybookOverrideBanner contractId={CONTRACT} projectId={PROJECT} />);

    expect(
      await screen.findByText('playbook.override.banner.overrides(count=1)'),
    ).toBeInTheDocument();
    expect(screen.getByText('playbook.override.banner.using')).toBeInTheDocument();
  });

  it('claims NO count for a non-OWNER_ADMIN and never fires the 403 request', async () => {
    mockRole = UserRole.OWNER_CREATOR;
    wrap(<PlaybookOverrideBanner contractId={CONTRACT} projectId={PROJECT} />);

    expect(
      await screen.findByText('playbook.override.banner.noPermission'),
    ).toBeInTheDocument();
    expect(svc.list).not.toHaveBeenCalled();
    // A misleading "0 overrides" would be worse than saying nothing.
    expect(
      screen.queryByText(/playbook\.override\.banner\.overrides/),
    ).not.toBeInTheDocument();
  });
});

// ═══ Trigger ══════════════════════════════════════════════════════════════════

describe('AdjustStandardButton', () => {
  it('is enabled and fires for OWNER_ADMIN', async () => {
    const onClick = vi.fn();
    wrap(<AdjustStandardButton onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'playbook.override.adjust' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is DISABLED with a reason for every other role, mirroring the API guard', () => {
    for (const role of [
      UserRole.SYSTEM_ADMIN,
      UserRole.OWNER_CREATOR,
      UserRole.OWNER_REVIEWER,
    ]) {
      mockRole = role;
      const { unmount } = wrap(<AdjustStandardButton onClick={vi.fn()} />);
      const btn = screen.getByRole('button', { name: 'playbook.override.adjust' });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'playbook.override.noPermissionTitle');
      unmount();
    }
  });
});

// ═══ Override modal ═══════════════════════════════════════════════════════════

describe('PlaybookOverrideModal', () => {
  const finding = { requirement: 'Payment terms exceed the org standard', clause_ref: '14.7' };

  function open(projectId: string | null = PROJECT) {
    return wrap(
      <PlaybookOverrideModal
        contractId={CONTRACT}
        projectId={projectId}
        finding={finding}
        onClose={vi.fn()}
      />,
    );
  }

  it('shows the deviation for context', async () => {
    open();
    expect(
      await screen.findByText('Payment terms exceed the org standard'),
    ).toBeInTheDocument();
  });

  it('shows the ORG standard read-only once a subject is chosen', async () => {
    svc.list.mockResolvedValue([position({ id: 'org' })]);
    open();

    // Nothing claimed before a subject is picked.
    expect(
      await screen.findByText('playbook.override.chooseSubjectFirst'),
    ).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText('playbook.override.subjectLabel'),
      'payment',
    );
    expect(
      screen.getByText('playbook.value.range(max=45,min=28,unit=days)'),
    ).toBeInTheDocument();
  });

  it('says so plainly when no org standard exists for the subject', async () => {
    svc.list.mockResolvedValue([]);
    open();
    await userEvent.selectOptions(
      await screen.findByLabelText('playbook.override.subjectLabel'),
      'liability',
    );
    expect(screen.getByText('playbook.override.noOrgStandard')).toBeInTheDocument();
  });

  it('adopts the org standard’s shape as the override starting point', async () => {
    svc.list.mockResolvedValue([
      position({
        id: 'org',
        clause_type: 'liability',
        rule_type: 'THRESHOLD',
        value_config: { direction: 'AT_LEAST', value: 100, unit: 'percent' },
      }),
    ]);
    open();
    await userEvent.selectOptions(
      await screen.findByLabelText('playbook.override.subjectLabel'),
      'liability',
    );
    expect(screen.getByLabelText('playbook.modal.ruleTypeLabel')).toHaveValue('THRESHOLD');
    expect(screen.getByLabelText('playbook.modal.valueLabel')).toHaveValue(100);
  });

  it('creates a CONTRACT-scoped override with contract_id (project_id denormalized)', async () => {
    svc.list.mockResolvedValue([position({ id: 'org' })]);
    svc.create.mockResolvedValue(position());
    open();

    await userEvent.selectOptions(
      await screen.findByLabelText('playbook.override.subjectLabel'),
      'payment',
    );
    await userEvent.clear(screen.getByLabelText('playbook.modal.maxLabel'));
    await userEvent.type(screen.getByLabelText('playbook.modal.maxLabel'), '60');
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    expect(svc.create).toHaveBeenCalledWith({
      scope: 'CONTRACT',
      contract_id: CONTRACT,
      project_id: PROJECT,
      clause_type: 'payment',
      is_custom_clause_type: false,
      rule_type: 'RANGE',
      value_config: { min: 28, max: 60, unit: 'days' },
      note: undefined,
    });
  });

  it('creates a PROJECT-scoped override that NEVER carries contract_id', async () => {
    // The backend rejects a PROJECT position carrying contract_id.
    svc.list.mockResolvedValue([position({ id: 'org' })]);
    svc.create.mockResolvedValue(position());
    open();

    await userEvent.selectOptions(
      await screen.findByLabelText('playbook.override.subjectLabel'),
      'payment',
    );
    await userEvent.click(
      screen.getByRole('radio', { name: /playbook\.override\.scopeProject/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    const body = svc.create.mock.calls[0][0];
    expect(body.scope).toBe('PROJECT');
    expect(body.project_id).toBe(PROJECT);
    expect(body).not.toHaveProperty('contract_id');
  });

  it('disables the project scope when the contract has no project', async () => {
    svc.list.mockResolvedValue([]);
    open(null);
    expect(
      await screen.findByRole('radio', { name: /playbook\.override\.scopeProject/ }),
    ).toBeDisabled();
  });

  it('blocks submit without a subject', async () => {
    open();
    await userEvent.click(
      await screen.findByRole('button', { name: 'playbook.save' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'playbook.errors.clauseTypeRequired',
    );
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('blocks submit on an invalid override value', async () => {
    svc.list.mockResolvedValue([]);
    open();
    await userEvent.selectOptions(
      await screen.findByLabelText('playbook.override.subjectLabel'),
      'payment',
    );
    // RANGE with nothing filled in
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'playbook.errors.minRequired',
    );
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('keeps the modal open on a server error', async () => {
    svc.list.mockResolvedValue([position({ id: 'org' })]);
    svc.create.mockRejectedValueOnce({ response: { status: 403 } });
    open();

    await userEvent.selectOptions(
      await screen.findByLabelText('playbook.override.subjectLabel'),
      'payment',
    );
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'playbook.errors.forbidden',
    );
    expect(screen.getByText('playbook.override.title')).toBeInTheDocument();
  });

  it('offers the org’s custom subjects alongside the 17 standard types', async () => {
    svc.list.mockResolvedValue([
      position({ id: 'c', clause_type: 'Site access', is_custom_clause_type: true }),
    ]);
    open();
    // Wait for the positions query to land before counting — the select renders
    // with only the 17 standard keys until the org's custom subjects arrive.
    expect(
      await screen.findByRole('option', { name: 'Site access' }),
    ).toBeInTheDocument();
    const select = screen.getByLabelText('playbook.override.subjectLabel');
    // 1 placeholder + 17 standard + 1 custom
    expect(select.querySelectorAll('option')).toHaveLength(19);
  });
});
