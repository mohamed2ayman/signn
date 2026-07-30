import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PlaybookPage from '@/pages/app/PlaybookPage';
import playbookService, {
  type PlaybookPosition,
} from '@/services/api/playbookService';

// ─────────────────────────────────────────────────────────────────
// Mocks (house conventions: service-level mock — lesson #37; t() → key)
// ─────────────────────────────────────────────────────────────────

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

vi.mock('@/services/api/playbookService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/playbookService')>();
  return {
    ...actual,
    default: {
      list: vi.fn(),
      getOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  };
});

const svc = playbookService as unknown as Record<string, ReturnType<typeof vi.fn>>;

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

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

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PlaybookPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.list.mockResolvedValue([]);
});

// ═════════════════════════════════════════════════════════════════
// List rendering
// ═════════════════════════════════════════════════════════════════

describe('PlaybookPage — list', () => {
  it('renders the empty state when the org has no positions', async () => {
    svc.list.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('playbook.empty.title')).toBeInTheDocument();
  });

  it('groups positions under family headers in display order', async () => {
    svc.list.mockResolvedValue([
      position({ id: 'a', clause_type: 'liability', rule_type: 'REQUIRED', value_config: { required: true } }),
      position({ id: 'b', clause_type: 'payment' }),
      position({ id: 'c', clause_type: 'termination', rule_type: 'REQUIRED', value_config: { required: true } }),
    ]);
    renderPage();

    await screen.findByText('playbook.family.commercial');
    const headers = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'playbook.family.commercial',
      'playbook.family.risk',
      'playbook.family.legal',
    ]);
  });

  it('renders clause label, rule-type badge, human value and note on a row', async () => {
    svc.list.mockResolvedValue([
      position({ note: 'Our standard net-30 line' }),
    ]);
    renderPage();

    expect(await screen.findByText('clauseType.payment')).toBeInTheDocument();
    expect(screen.getByText('playbook.ruleType.RANGE')).toBeInTheDocument();
    expect(
      screen.getByText('playbook.value.range(max=45,min=28,unit=days)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Our standard net-30 line')).toBeInTheDocument();
  });

  it('shows a scope badge ONLY for narrower-than-org positions', async () => {
    svc.list.mockResolvedValue([
      position({ id: 'org', clause_type: 'payment' }),
      position({
        id: 'ctr',
        clause_type: 'liability',
        scope: 'CONTRACT',
        contract_id: 'c1',
        rule_type: 'REQUIRED',
        value_config: { required: true },
      }),
    ]);
    renderPage();

    await screen.findByText('clauseType.payment');
    expect(screen.getByText('playbook.scope.CONTRACT')).toBeInTheDocument();
    expect(screen.queryByText('playbook.scope.ORG')).not.toBeInTheDocument();
  });

  it('flags an inactive position', async () => {
    svc.list.mockResolvedValue([position({ is_active: false })]);
    renderPage();
    expect(await screen.findByText('playbook.inactiveBadge')).toBeInTheDocument();
  });

  it('renders a custom position verbatim with the custom badge', async () => {
    svc.list.mockResolvedValue([
      position({
        clause_type: 'قواعد الموقع',
        is_custom_clause_type: true,
        rule_type: 'TEXT',
        value_config: { text: 'نص الموقف' },
      }),
    ]);
    renderPage();

    expect(await screen.findByText('قواعد الموقع')).toBeInTheDocument();
    expect(screen.getByText('playbook.customBadge')).toBeInTheDocument();
    expect(screen.getByText('نص الموقف')).toBeInTheDocument();
  });

  it('reports coverage out of 17, counting only active standard types', async () => {
    svc.list.mockResolvedValue([
      position({ id: 'a', clause_type: 'payment' }),
      position({ id: 'b', clause_type: 'payment', scope: 'PROJECT', project_id: 'pr1' }),
      position({ id: 'c', clause_type: 'liability', is_active: false, rule_type: 'REQUIRED', value_config: { required: true } }),
      position({ id: 'd', clause_type: 'Site rules', is_custom_clause_type: true, rule_type: 'REQUIRED', value_config: { required: true } }),
    ]);
    renderPage();

    expect(
      await screen.findByText('playbook.coverage.headline(covered=1,total=17)'),
    ).toBeInTheDocument();
  });

  it('shows an error state with a working retry', async () => {
    svc.list.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    const retry = await screen.findByRole('button', { name: 'playbook.retry' });
    svc.list.mockResolvedValue([position()]);
    await userEvent.click(retry);

    expect(await screen.findByText('clauseType.payment')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════
// Delete
// ═════════════════════════════════════════════════════════════════

describe('PlaybookPage — delete', () => {
  it('requires confirmation and never deletes on cancel', async () => {
    svc.list.mockResolvedValue([position()]);
    renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: 'playbook.deleteAction' }),
    );
    expect(await screen.findByText('playbook.delete.body')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'playbook.cancel' }));
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it('deletes the right position on confirm', async () => {
    svc.list.mockResolvedValue([position({ id: 'target-id' })]);
    svc.remove.mockResolvedValue(undefined);
    renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: 'playbook.deleteAction' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'playbook.delete.confirm' }),
    );

    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith('target-id'));
  });
});

// ═════════════════════════════════════════════════════════════════
// Add / edit modal
// ═════════════════════════════════════════════════════════════════

describe('PlaybookPage — add position', () => {
  async function openAdd() {
    renderPage();
    await screen.findByText('playbook.empty.title');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'playbook.addPosition' })[0],
    );
    return screen.findByText('playbook.modal.addTitle');
  }

  it('offers exactly the 17 standard clause types plus a LAST custom option', async () => {
    await openAdd();
    const select = screen.getByLabelText('playbook.modal.clauseTypeLabel');
    const options = within(select).getAllByRole('option');
    // 1 placeholder + 17 standard + 1 custom
    expect(options).toHaveLength(19);
    expect(options[0]).toHaveValue('');
    expect(options[18]).toHaveValue('__custom__');
    expect(options[18]).toHaveTextContent('playbook.modal.clauseTypeCustom');
  });

  it('reveals the custom-name field only when the custom option is chosen', async () => {
    await openAdd();
    expect(
      screen.queryByLabelText('playbook.modal.customNameLabel'),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.clauseTypeLabel'),
      '__custom__',
    );
    expect(
      screen.getByLabelText('playbook.modal.customNameLabel'),
    ).toBeInTheDocument();
  });

  it('swaps the value inputs when the rule type changes', async () => {
    await openAdd();
    const ruleSelect = screen.getByLabelText('playbook.modal.ruleTypeLabel');

    // RANGE is the default
    expect(screen.getByLabelText('playbook.modal.minLabel')).toBeInTheDocument();

    await userEvent.selectOptions(ruleSelect, 'THRESHOLD');
    expect(
      screen.queryByLabelText('playbook.modal.minLabel'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('playbook.modal.directionLabel'),
    ).toBeInTheDocument();

    await userEvent.selectOptions(ruleSelect, 'ENUM');
    expect(screen.getByLabelText('playbook.modal.allowedLabel')).toBeInTheDocument();

    await userEvent.selectOptions(ruleSelect, 'REQUIRED');
    expect(screen.getByText('playbook.value.requiredHint')).toBeInTheDocument();

    await userEvent.selectOptions(ruleSelect, 'TEXT');
    expect(screen.getByLabelText('playbook.modal.textLabel')).toBeInTheDocument();
  });

  it('creates a RANGE position with exactly the keys the backend accepts', async () => {
    svc.create.mockResolvedValue(position());
    await openAdd();

    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.clauseTypeLabel'),
      'payment',
    );
    await userEvent.type(screen.getByLabelText('playbook.modal.minLabel'), '28');
    await userEvent.type(screen.getByLabelText('playbook.modal.maxLabel'), '45');
    await userEvent.type(screen.getByLabelText('playbook.modal.unitLabel'), 'days');
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    expect(svc.create).toHaveBeenCalledWith({
      clause_type: 'payment',
      is_custom_clause_type: false,
      rule_type: 'RANGE',
      value_config: { min: 28, max: 45, unit: 'days' },
      note: undefined,
    });
    // organization_id / created_by are server-side only — never sent.
    const body = svc.create.mock.calls[0][0];
    expect(body).not.toHaveProperty('organization_id');
    expect(body).not.toHaveProperty('created_by');
  });

  it('creates a custom position using the typed name and the custom flag', async () => {
    svc.create.mockResolvedValue(position());
    await openAdd();

    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.clauseTypeLabel'),
      '__custom__',
    );
    await userEvent.type(
      screen.getByLabelText('playbook.modal.customNameLabel'),
      '  Site access  ',
    );
    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.ruleTypeLabel'),
      'REQUIRED',
    );
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clause_type: 'Site access',
        is_custom_clause_type: true,
        rule_type: 'REQUIRED',
        value_config: { required: true },
      }),
    );
  });

  it('blocks submit with an inline message when the value is invalid', async () => {
    await openAdd();
    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.clauseTypeLabel'),
      'payment',
    );
    // RANGE with no min/max/unit
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'playbook.errors.minRequired',
    );
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('blocks submit when no clause type is chosen', async () => {
    await openAdd();
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'playbook.errors.clauseTypeRequired',
    );
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('keeps the modal open on a server error so the operator can retry', async () => {
    svc.create.mockRejectedValueOnce({ response: { status: 400, data: { message: ['bad'] } } });
    await openAdd();
    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.clauseTypeLabel'),
      'payment',
    );
    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.ruleTypeLabel'),
      'REQUIRED',
    );
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('playbook.errors.invalid');
    expect(screen.getByText('playbook.modal.addTitle')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════
// Double-submit guard — BOTH halves (lesson #238)
// ═════════════════════════════════════════════════════════════════

describe('PlaybookPage — double-submit guard', () => {
  async function openAddValid() {
    renderPage();
    await screen.findByText('playbook.empty.title');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'playbook.addPosition' })[0],
    );
    await screen.findByText('playbook.modal.addTitle');
    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.clauseTypeLabel'),
      'payment',
    );
    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.ruleTypeLabel'),
      'REQUIRED',
    );
    return screen.getByRole('button', { name: 'playbook.save' });
  }

  it('ACQUIRE: a same-tick double click sends exactly ONE create', async () => {
    let resolve!: (v: unknown) => void;
    svc.create.mockReturnValue(new Promise((r) => { resolve = r; }));

    const save = await openAddValid();
    // Fire twice synchronously — before React can commit `disabled`.
    save.click();
    save.click();

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    resolve(position());
  });

  it('RELEASE: a deliberate retry after failure genuinely re-sends', async () => {
    svc.create.mockRejectedValueOnce({ response: { status: 500 } });
    const save = await openAddValid();

    await userEvent.click(save);
    await screen.findByRole('alert');
    expect(svc.create).toHaveBeenCalledTimes(1);

    svc.create.mockResolvedValueOnce(position());
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(2));
  });
});

// ═════════════════════════════════════════════════════════════════
// Edit — the PATCH merge-semantics invariants
// ═════════════════════════════════════════════════════════════════

describe('PlaybookPage — edit', () => {
  async function openEdit(p: PlaybookPosition) {
    svc.list.mockResolvedValue([p]);
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'playbook.edit' }),
    );
    return screen.findByText('playbook.modal.editTitle');
  }

  it('prefills the stored position', async () => {
    await openEdit(position({ note: 'why' }));

    expect(screen.getByLabelText('playbook.modal.clauseTypeLabel')).toHaveValue('payment');
    expect(screen.getByLabelText('playbook.modal.ruleTypeLabel')).toHaveValue('RANGE');
    expect(screen.getByLabelText('playbook.modal.minLabel')).toHaveValue(28);
    expect(screen.getByLabelText('playbook.modal.unitLabel')).toHaveValue('days');
    expect(screen.getByLabelText('playbook.modal.noteLabel')).toHaveValue('why');
  });

  it('preselects the custom option and name for a custom position', async () => {
    await openEdit(
      position({
        clause_type: 'Site access',
        is_custom_clause_type: true,
        rule_type: 'REQUIRED',
        value_config: { required: true },
      }),
    );
    expect(screen.getByLabelText('playbook.modal.clauseTypeLabel')).toHaveValue('__custom__');
    expect(screen.getByLabelText('playbook.modal.customNameLabel')).toHaveValue('Site access');
  });

  it('ALWAYS sends rule_type and value_config together — never a half-patch', async () => {
    // The service re-validates the MERGED pair: patching rule_type alone against
    // a stored config of another shape is a 400 that writes nothing.
    svc.update.mockResolvedValue(position());
    await openEdit(position({ id: 'edit-me' }));

    await userEvent.selectOptions(
      screen.getByLabelText('playbook.modal.ruleTypeLabel'),
      'REQUIRED',
    );
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    const [id, body] = svc.update.mock.calls[0];
    expect(id).toBe('edit-me');
    expect(body.rule_type).toBe('REQUIRED');
    expect(body.value_config).toEqual({ required: true });
  });

  it('NEVER sends scope / project_id / contract_id, so a narrow position keeps its scope', async () => {
    // `{ scope: 'ORG' }` alone with project_id still set is a 400; omitting all
    // three is the only correct way to edit a narrower position from here.
    svc.update.mockResolvedValue(position());
    await openEdit(
      position({
        id: 'narrow',
        scope: 'PROJECT',
        project_id: 'pr1',
        rule_type: 'REQUIRED',
        value_config: { required: true },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    const body = svc.update.mock.calls[0][1];
    expect(body).not.toHaveProperty('scope');
    expect(body).not.toHaveProperty('project_id');
    expect(body).not.toHaveProperty('contract_id');
  });

  it('clears a note with explicit null rather than dropping the key', async () => {
    svc.update.mockResolvedValue(position());
    await openEdit(position({ note: 'remove me' }));

    await userEvent.clear(screen.getByLabelText('playbook.modal.noteLabel'));
    await userEvent.click(screen.getByRole('button', { name: 'playbook.save' }));

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update.mock.calls[0][1].note).toBeNull();
  });
});
