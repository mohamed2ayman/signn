import { describe, it, expect } from 'vitest';
import {
  validateParties,
  signatoryStats,
  pendingRoleConfirmCount,
  canSaveParties,
  buildPayload,
  draftFromServer,
  emptyParty,
  emptyContact,
  type DraftParty,
} from './partiesModel';
import type { ContractParty } from '@/types';

const party = (over: Partial<DraftParty> = {}): DraftParty => ({
  ...emptyParty(),
  role_code: 'EMPLOYER',
  org_name: 'Acme Co',
  ...over,
});

describe('validateParties (item 5 — mirrors T0c-1 400s)', () => {
  it('flags an empty org_name (ORG_NAME_REQUIRED)', () => {
    const issues = validateParties([party({ org_name: '   ' })]);
    expect(issues.map((i) => i.code)).toContain('ORG_NAME_REQUIRED');
  });

  it('flags a missing role (ROLE_REQUIRED)', () => {
    const issues = validateParties([party({ role_code: '' })]);
    expect(issues.map((i) => i.code)).toContain('ROLE_REQUIRED');
  });

  it('a fully-filled non-signatory party has no issues', () => {
    expect(validateParties([party()])).toHaveLength(0);
  });

  it('requires a contact email on a signatory party (CONTACT_EMAIL_REQUIRED)', () => {
    const p = party({
      is_signatory: true,
      contacts: [{ ...emptyContact(), name: 'A', email: '' }],
    });
    expect(validateParties([p]).map((i) => i.code)).toContain(
      'CONTACT_EMAIL_REQUIRED',
    );
  });

  it('flags a malformed contact email (CONTACT_EMAIL_INVALID)', () => {
    const p = party({
      is_signatory: true,
      contacts: [{ ...emptyContact(), name: 'A', email: 'not-an-email' }],
    });
    expect(validateParties([p]).map((i) => i.code)).toContain(
      'CONTACT_EMAIL_INVALID',
    );
  });

  it('accepts a well-formed contact email', () => {
    const p = party({
      is_signatory: true,
      contacts: [{ ...emptyContact(), name: 'A', email: 'a@b.com' }],
    });
    expect(validateParties([p])).toHaveLength(0);
  });

  it('flags more than one designated signatory per party (MULTIPLE_DESIGNATED)', () => {
    const p = party({
      is_signatory: true,
      contacts: [
        { ...emptyContact(), name: 'A', email: 'a@b.com', is_designated_signatory: true },
        { ...emptyContact(), name: 'B', email: 'b@b.com', is_designated_signatory: true },
      ],
    });
    expect(validateParties([p]).map((i) => i.code)).toContain(
      'MULTIPLE_DESIGNATED',
    );
  });

  it('does NOT validate contacts on a non-signatory party (they are dropped)', () => {
    const p = party({
      is_signatory: false,
      contacts: [{ ...emptyContact(), name: 'A', email: 'bad' }],
    });
    // Non-signatory → contacts hidden/dropped → no email issue.
    expect(validateParties([p])).toHaveLength(0);
  });
});

describe('signatoryStats (item 2 — display only)', () => {
  it('counts signatory parties and how many have a designated contact', () => {
    const parties = [
      party({ is_signatory: true, contacts: [{ ...emptyContact(), email: 'a@b.com', is_designated_signatory: true }] }),
      party({ is_signatory: true, contacts: [{ ...emptyContact(), email: 'b@b.com' }] }),
      party({ is_signatory: false }),
    ];
    expect(signatoryStats(parties)).toEqual({ signatoryCount: 2, designatedCount: 1 });
  });

  it('one signatory is a valid state (no enforced 2/2)', () => {
    const parties = [party({ is_signatory: true }), party({ is_signatory: false })];
    // The count is 1 signatory — canSaveParties must NOT be blocked by it.
    expect(signatoryStats(parties).signatoryCount).toBe(1);
    expect(canSaveParties(parties)).toBe(true);
  });
});

describe('role-confirm gate (item 1) + canSave', () => {
  it('pendingRoleConfirmCount counts drafts needing confirmation', () => {
    const parties = [party({ needs_role_confirm: true }), party()];
    expect(pendingRoleConfirmCount(parties)).toBe(1);
  });

  it('canSaveParties is false while any role is unconfirmed, true once cleared', () => {
    const parties = [party({ needs_role_confirm: true })];
    expect(canSaveParties(parties)).toBe(false);
    parties[0].needs_role_confirm = false;
    expect(canSaveParties(parties)).toBe(true);
  });

  it('canSaveParties is false when a validation issue exists', () => {
    expect(canSaveParties([party({ role_code: '' })])).toBe(false);
  });
});

describe('buildPayload (item 4 org link + contact drop)', () => {
  it('maps is_own_org → host org id; counterparty stays null', () => {
    const host = buildPayload(party({ is_own_org: true }), 'org-host');
    expect(host.organization_id).toBe('org-host');
    const counter = buildPayload(party({ is_own_org: false }), 'org-host');
    expect(counter.organization_id).toBeNull();
  });

  it('drops contacts entirely for a non-signatory party', () => {
    const p = party({ is_signatory: false, contacts: [{ ...emptyContact(), name: 'A', email: 'a@b.com' }] });
    expect(buildPayload(p, null).contacts).toEqual([]);
  });

  it('sends contacts for a signatory party, trimming and nulling blank title', () => {
    const p = party({
      is_signatory: true,
      contacts: [{ ...emptyContact(), name: ' A ', title: '  ', email: ' a@b.com ', is_designated_signatory: true }],
    });
    const payload = buildPayload(p, null);
    expect(payload.contacts).toEqual([
      { name: 'A', email: 'a@b.com', title: null, is_designated_signatory: true },
    ]);
  });
});

describe('draftFromServer', () => {
  const server: ContractParty = {
    id: 'p1',
    contract_id: 'c1',
    role_code: 'CONTRACTOR',
    org_name: 'البناء للمقاولات',
    is_signatory: true,
    organization_id: 'org-host',
    legal_tax_card: 'TAX-1',
    legal_address: 'Cairo',
    contacts: [
      { id: 'ct1', contract_party_id: 'p1', name: 'Sara', email: 's@x.com', title: 'Director', is_designated_signatory: true },
    ],
    created_at: '2026-07-12T00:00:00Z',
    updated_at: '2026-07-12T00:00:00Z',
  };

  it('hydrates a loaded party as CONFIRMED (needs_role_confirm=false)', () => {
    const d = draftFromServer(server, 'org-host');
    expect(d.needs_role_confirm).toBe(false);
    expect(d.role_code).toBe('CONTRACTOR');
    expect(d.is_own_org).toBe(true); // organization_id === hostOrgId
    expect(d.contacts).toHaveLength(1);
    expect(d.contacts[0].is_designated_signatory).toBe(true);
  });

  it('is_own_org is false when the linked org differs from the host', () => {
    expect(draftFromServer(server, 'org-other').is_own_org).toBe(false);
  });
});
