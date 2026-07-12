import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PartyRoleSelect from './PartyRoleSelect';
import {
  emptyContact,
  type DraftParty,
  type DraftContact,
  type PartyIssue,
  type PartyIssueCode,
} from './partiesModel';

interface Props {
  party: DraftParty;
  /** Issues scoped to THIS party (from validateParties, filtered by partyKey). */
  issues: PartyIssue[];
  index: number;
  canEdit: boolean;
  /** Host org display name — labels the "your organisation" link toggle. */
  hostOrgName?: string | null;
  /** Resolve a role code → localized label (registry-backed, from the editor). */
  roleLabel: (code: string) => string;
  onChange: (next: DraftParty) => void;
  onRemove: () => void;
  onConfirmRole: () => void;
}

const hasCode = (issues: PartyIssue[], code: PartyIssueCode) =>
  issues.some((i) => i.code === code && !i.contactKey);

/** Small accessible on/off switch matching house styling. */
function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'ltr:translate-x-5 rtl:-translate-x-5' : 'ltr:translate-x-0.5 rtl:-translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function PartyCard({
  party,
  issues,
  index,
  canEdit,
  hostOrgName,
  roleLabel,
  onChange,
  onRemove,
  onConfirmRole,
}: Props) {
  const { t } = useTranslation();
  const [legalOpen, setLegalOpen] = useState(
    !!party.legal_tax_card || !!party.legal_address,
  );

  const patch = (p: Partial<DraftParty>) => onChange({ ...party, ...p });

  const setContact = (key: string, c: Partial<DraftContact>) =>
    patch({
      contacts: party.contacts.map((x) => (x.key === key ? { ...x, ...c } : x)),
    });

  const addContact = () =>
    patch({ contacts: [...party.contacts, emptyContact()] });

  const removeContact = (key: string) =>
    patch({ contacts: party.contacts.filter((x) => x.key !== key) });

  // Designated signatory is single-select within a party (radio semantics).
  const setDesignated = (key: string) =>
    patch({
      contacts: party.contacts.map((x) => ({
        ...x,
        is_designated_signatory: x.key === key,
      })),
    });

  const contactIssue = (contactKey: string): PartyIssueCode | null => {
    const found = issues.find((i) => i.contactKey === contactKey);
    return found ? found.code : null;
  };

  // ── Read-only view (below EDITOR) — NAME + ROLE (+ badges), no controls ──
  if (!canEdit) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900" dir="auto">
              {party.org_name || t('partiesEditor.card.unnamedParty')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500" dir="auto">
              {party.role_code
                ? roleLabel(party.role_code)
                : t('partiesEditor.role.placeholder')}
            </p>
          </div>
          {party.is_signatory && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {t('partiesEditor.card.signsBadge')}
            </span>
          )}
        </div>
        {party.is_signatory && party.contacts.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
            {party.contacts.map((c) => (
              <li key={c.key} className="flex items-center gap-2 text-xs text-gray-600" dir="auto">
                <span className="font-medium text-gray-800">{c.name || '—'}</span>
                {c.title && <span className="text-gray-400">· {c.title}</span>}
                <span className="text-gray-400">· {c.email}</span>
                {c.is_designated_signatory && (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {t('partiesEditor.contacts.designatedShort')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Editable card ────────────────────────────────────────────────────────
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm sm:p-5 ${
        party.needs_role_confirm ? 'border-amber-300' : 'border-gray-200/80'
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('partiesEditor.card.partyN', { n: index + 1 })}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
          aria-label={t('partiesEditor.card.remove')}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Role-confirm banner (item 1) */}
      {party.needs_role_confirm && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-800" dir="auto">
            {t('partiesEditor.confirm.roleNeedsConfirmation')}
          </p>
          <button
            type="button"
            onClick={onConfirmRole}
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-700"
          >
            {t('partiesEditor.confirm.confirm')}
          </button>
        </div>
      )}

      {/* Organisation name + Role */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {t('partiesEditor.fields.orgName')}
          </label>
          <input
            type="text"
            value={party.org_name}
            dir="auto"
            onChange={(e) => patch({ org_name: e.target.value })}
            placeholder={t('partiesEditor.fields.orgNamePlaceholder')}
            aria-invalid={hasCode(issues, 'ORG_NAME_REQUIRED') || undefined}
            className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
              hasCode(issues, 'ORG_NAME_REQUIRED')
                ? 'border-red-300 focus:border-red-400'
                : 'border-gray-200 focus:border-primary'
            }`}
          />
          {hasCode(issues, 'ORG_NAME_REQUIRED') && (
            <p className="mt-1 text-xs text-red-600">
              {t('partiesEditor.errors.orgNameRequired')}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {t('partiesEditor.fields.role')}
          </label>
          <PartyRoleSelect
            value={party.role_code}
            onChange={(code) => patch({ role_code: code })}
            invalid={hasCode(issues, 'ROLE_REQUIRED')}
          />
          {hasCode(issues, 'ROLE_REQUIRED') && (
            <p className="mt-1 text-xs text-red-600">
              {t('partiesEditor.errors.roleRequired')}
            </p>
          )}
        </div>
      </div>

      {/* Toggles: signs + your organisation */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-800">
              {t('partiesEditor.fields.signs')}
            </p>
            <p className="text-xs text-gray-500">
              {t('partiesEditor.fields.signsHint')}
            </p>
          </div>
          <Switch
            checked={party.is_signatory}
            onChange={(v) => patch({ is_signatory: v })}
            label={t('partiesEditor.fields.signs')}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-800">
              {t('partiesEditor.fields.ownOrg')}
            </p>
            <p className="text-xs text-gray-500" dir="auto">
              {hostOrgName
                ? t('partiesEditor.fields.ownOrgHintNamed', { org: hostOrgName })
                : t('partiesEditor.fields.ownOrgHint')}
            </p>
          </div>
          <Switch
            checked={party.is_own_org}
            onChange={(v) => patch({ is_own_org: v })}
            label={t('partiesEditor.fields.ownOrg')}
          />
        </div>
      </div>

      {/* Authorised contacts (meaningful when signatory) */}
      {party.is_signatory && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">
              {t('partiesEditor.contacts.title')}
            </p>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {t('partiesEditor.contacts.hint')}
          </p>

          {hasCode(issues, 'MULTIPLE_DESIGNATED') && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {t('partiesEditor.errors.multipleDesignated')}
            </p>
          )}

          <div className="space-y-3">
            {party.contacts.map((c) => {
              const cIssue = contactIssue(c.key);
              return (
                <div
                  key={c.key}
                  className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      value={c.name}
                      dir="auto"
                      onChange={(e) => setContact(c.key, { name: e.target.value })}
                      placeholder={t('partiesEditor.contacts.name')}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <input
                      type="text"
                      value={c.title}
                      dir="auto"
                      onChange={(e) => setContact(c.key, { title: e.target.value })}
                      placeholder={t('partiesEditor.contacts.role')}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <input
                      type="email"
                      value={c.email}
                      dir="ltr"
                      onChange={(e) => setContact(c.key, { email: e.target.value })}
                      placeholder={t('partiesEditor.contacts.email')}
                      aria-invalid={!!cIssue || undefined}
                      className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        cIssue
                          ? 'border-red-300 focus:border-red-400'
                          : 'border-gray-200 focus:border-primary'
                      }`}
                    />
                  </div>
                  {cIssue && (
                    <p className="mt-1.5 text-xs text-red-600">
                      {cIssue === 'CONTACT_EMAIL_INVALID'
                        ? t('partiesEditor.errors.emailInvalid')
                        : t('partiesEditor.errors.emailRequired')}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="radio"
                        name={`designated-${party.key}`}
                        checked={c.is_designated_signatory}
                        onChange={() => setDesignated(c.key)}
                        className="h-3.5 w-3.5 text-primary focus:ring-primary/30"
                      />
                      <span dir="auto">{t('partiesEditor.contacts.designated')}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeContact(c.key)}
                      className="text-xs font-medium text-gray-400 transition hover:text-red-600"
                    >
                      {t('partiesEditor.contacts.removeContact')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addContact}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-primary/50 hover:text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('partiesEditor.contacts.addContact')}
          </button>
        </div>
      )}

      {/* Legal details (optional) */}
      <div className="mt-5 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => setLegalOpen((o) => !o)}
          className="flex w-full items-center justify-between text-xs font-semibold text-gray-600"
        >
          <span>{t('partiesEditor.legal.title')}</span>
          <svg
            className={`h-4 w-4 transition-transform ${legalOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {legalOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t('partiesEditor.legal.taxCard')}
              </label>
              <input
                type="text"
                value={party.legal_tax_card}
                dir="auto"
                onChange={(e) => patch({ legal_tax_card: e.target.value })}
                placeholder={t('partiesEditor.legal.taxCardPlaceholder')}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t('partiesEditor.legal.address')}
              </label>
              <input
                type="text"
                value={party.legal_address}
                dir="auto"
                onChange={(e) => patch({ legal_address: e.target.value })}
                placeholder={t('partiesEditor.legal.addressPlaceholder')}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
