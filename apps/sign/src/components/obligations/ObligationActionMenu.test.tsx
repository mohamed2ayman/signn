import { render, screen, fireEvent } from '@testing-library/react';

import ObligationActionMenu from '@/components/obligations/ObligationActionMenu';
import type { ContractObligation } from '@/services/api/complianceService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const baseObligation: ContractObligation = {
  id: 'ob-1',
  contract_id: 'c-1',
  project_id: 'p-1',
  compliance_check_id: null,
  contract_clause_id: null,
  description: 'Submit progress report',
  responsible_party: 'CONTRACTOR',
  obligation_type: 'REPORTING',
  clause_ref: null,
  due_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  duration: null,
  timeframe_description: null,
  amount: null,
  currency: null,
  is_critical: false,
  status: 'PENDING',
  completed_at: null,
  evidence_url: null,
  created_at: new Date().toISOString(),
};

describe('ObligationActionMenu', () => {
  it('opens the menu when the three-dot trigger is clicked', () => {
    render(
      <ObligationActionMenu
        obligation={baseObligation}
        onViewDetails={() => {}}
        onMarkActioned={() => {}}
        onEdit={() => {}}
        onAssign={() => {}}
      />,
    );
    const trigger = screen.getByLabelText('common.actions');
    fireEvent.click(trigger);
    expect(screen.getByText('obligation.actions.viewDetails')).toBeInTheDocument();
    expect(screen.getByText('obligation.actions.markActioned')).toBeInTheDocument();
    expect(screen.getByText('obligation.actions.edit')).toBeInTheDocument();
    expect(screen.getByText('obligation.actions.assign')).toBeInTheDocument();
  });

  it('hides Mark Actioned when the effective status is MET', () => {
    render(
      <ObligationActionMenu
        obligation={{ ...baseObligation, status: 'MET' }}
        onViewDetails={() => {}}
        onMarkActioned={() => {}}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('common.actions'));
    expect(screen.queryByText('obligation.actions.markActioned')).not.toBeInTheDocument();
    expect(screen.getByText('obligation.actions.viewDetails')).toBeInTheDocument();
  });

  it('does NOT render a Delete item (Phase 7.1 Step 3 — Delete deferred)', () => {
    render(
      <ObligationActionMenu
        obligation={baseObligation}
        onViewDetails={() => {}}
        onMarkActioned={() => {}}
        onEdit={() => {}}
        onAssign={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('common.actions'));
    // No "Delete" key should exist in the menu at all in Step 3.
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });
});
