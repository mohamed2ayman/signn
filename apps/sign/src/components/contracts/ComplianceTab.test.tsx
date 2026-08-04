import { describe, it, expect, vi } from 'vitest';

import { PLAYBOOK_STATUS_BADGE } from '@/components/contracts/ComplianceTab';
import type { PlaybookStatus } from '@/services/api/complianceService';

// ─────────────────────────────────────────────────────────────────
// Mocks (house conventions: service-level mock — lesson #37; t() → key)
//
// The colour map is the contract under test, so nothing is rendered here.
// The mocks exist only so importing ComplianceTab does not drag `./axios`
// — which imports the Redux store as a module side effect — into the run:
// the tab imports complianceService directly and playbookService
// transitively, via the 7.22 Slice 3 override panel.
// ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api/complianceService', () => ({
  default: {
    listChecks: vi.fn(),
    getCheck: vi.fn(),
    runCheck: vi.fn(),
    emailReport: vi.fn(),
    updateFinding: vi.fn(),
    listContractObligations: vi.fn(),
    updateObligation: vi.fn(),
    updateEvidence: vi.fn(),
    assignObligation: vi.fn(),
    unassignObligation: vi.fn(),
    icalExportUrl: vi.fn(),
  },
}));

vi.mock('@/services/api/playbookService', () => ({
  default: {
    list: vi.fn(),
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  NOTE_MAX_LENGTH: 2000,
}));

// The three values the backend can put in `findings_summary.playbook_status`
// (PR #213). Typed, so dropping one here is a compile error rather than a
// silently narrower assertion.
const ALL_PLAYBOOK_STATUSES: PlaybookStatus[] = [
  'ON_STANDARD',
  'MINOR_DEVIATIONS',
  'MAJOR_DEVIATIONS',
];

describe('ComplianceTab — playbook_status pill colours (7.22, #216)', () => {
  it('renders ON_STANDARD in emerald, the same success tone the rest of the app uses', () => {
    expect(PLAYBOOK_STATUS_BADGE.ON_STANDARD).toContain('emerald');
  });

  it('renders MINOR_DEVIATIONS in amber, a soft warning rather than an alarm', () => {
    expect(PLAYBOOK_STATUS_BADGE.MINOR_DEVIATIONS).toContain('amber');
  });

  it('renders MAJOR_DEVIATIONS in orange — the deeper amber tone, which is the product decision on this PR', () => {
    expect(PLAYBOOK_STATUS_BADGE.MAJOR_DEVIATIONS).toContain('orange');
  });

  it('never renders MAJOR_DEVIATIONS in red, because the worst playbook outcome is still a preference miss and must never read as legal non-compliance', () => {
    expect(PLAYBOOK_STATUS_BADGE.MAJOR_DEVIATIONS).not.toContain('red');
  });

  it('maps exactly the three playbook statuses, so a fourth badge is a deliberate decision and never a silent addition', () => {
    expect(Object.keys(PLAYBOOK_STATUS_BADGE).sort()).toEqual(
      [...ALL_PLAYBOOK_STATUSES].sort(),
    );
  });
});
