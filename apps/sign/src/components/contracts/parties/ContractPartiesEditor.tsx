import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { toast } from 'react-hot-toast';
import type { RootState } from '@/store';
import type { Contract, ContractParty, PartyRole } from '@/types';
import { partyService } from '@/services/api/partyService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import PartyCard from './PartyCard';
import {
  validateParties,
  signatoryStats,
  pendingRoleConfirmCount,
  canSaveParties,
  draftFromServer,
  buildPayload,
  emptyParty,
  nextKey,
  type DraftParty,
} from './partiesModel';

/**
 * Multi-tier T0c-2 — the Parties Editor (Contract Detail "Parties" tab).
 *
 * Manages the organisations bound by a contract and the people who sign on
 * their behalf, wired to the real T0c-1 ContractParty API. Implements the five
 * bounded mock-additions — see partiesModel.ts for the pure logic and each
 * item's boundary. Read-only for viewers below EDITOR and for signed (pinned)
 * contracts (mirrors the backend EDITOR floor + CONTRACT_PINNED guard).
 */

/** An AI-prefilled party (item 1). In the shipped integration this is NOT
 *  passed — there is no extract API. Provided ⇒ seeds the editor with parties
 *  that start in the role-confirmation-pending state. */
export interface PrefilledPartyInput {
  role_code?: string;
  org_name?: string;
  is_signatory?: boolean;
  contacts?: Array<{ name?: string; title?: string; email?: string; is_designated_signatory?: boolean }>;
}

interface Props {
  contractId: string;
  contract: Contract;
  /** Optional AI-prefill (item 1). Omitted in the shipped tab wiring. */
  prefilledParties?: PrefilledPartyInput[];
}

const EDIT_ROLES = new Set([
  'SYSTEM_ADMIN',
  'OWNER_ADMIN',
  'PROJECT_MANAGER',
  'REVIEWER',
  'CONTRACTOR_ADMIN',
]);

function prefilledToDraft(p: PrefilledPartyInput): DraftParty {
  return {
    ...emptyParty(),
    role_code: p.role_code ?? '',
    org_name: p.org_name ?? '',
    is_signatory: !!p.is_signatory,
    contacts: (p.contacts ?? []).map((c) => ({
      key: nextKey('c'),
      name: c.name ?? '',
      title: c.title ?? '',
      email: c.email ?? '',
      is_designated_signatory: !!c.is_designated_signatory,
    })),
    needs_role_confirm: true, // item 1 — AI-prefilled ⇒ pending confirmation
  };
}

export default function ContractPartiesEditor({
  contractId,
  contract,
  prefilledParties,
}: Props) {
  const { t, i18n } = useTranslation();
  const currentUser = useSelector((s: RootState) => s.auth.user);

  // Permission floor (mirror ObligationsTab): global-role EDITOR floor.
  const hasEditRole = !!currentUser && EDIT_ROLES.has(currentUser.role);
  // Signed contracts are frozen (backend CONTRACT_PINNED guard).
  const isPinned = !!contract.pinned_version_id || !!contract.pinned_at;
  const editable = hasEditRole && !isPinned;

  const hostOrgId = currentUser?.organization_id ?? null;

  const [drafts, setDrafts] = useState<DraftParty[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  const partiesQ = useQuery({
    queryKey: ['contract-parties', contractId],
    queryFn: () => partyService.list(contractId),
    enabled: !!contractId,
  });

  // Role registry — one fetch shared with PartyRoleSelect (same query key),
  // used here to resolve role codes → localized labels for the read-only view.
  const rolesQ = useQuery({
    queryKey: ['party-roles', 'contract'],
    queryFn: () => partyService.getRoles('contract'),
    staleTime: 1000 * 60 * 60,
  });
  const roleLabel = useMemo(() => {
    const byCode = new Map((rolesQ.data ?? []).map((r: PartyRole) => [r.code, r]));
    return (code: string) => {
      const r = byCode.get(code);
      if (!r) return code;
      if (i18n.language === 'ar') return r.label_ar;
      if (i18n.language === 'fr') return r.label_fr;
      return r.label_en;
    };
  }, [rolesQ.data, i18n.language]);

  const hydrate = (server: ContractParty[]) => {
    if (server.length === 0 && prefilledParties && prefilledParties.length > 0) {
      setDrafts(prefilledParties.map(prefilledToDraft));
    } else {
      setDrafts(server.map((p) => draftFromServer(p, hostOrgId)));
    }
    setDirty(false);
  };

  // Hydrate once on first data arrival (and after an explicit re-sync on save).
  useEffect(() => {
    if (partiesQ.data && !hydratedRef.current) {
      hydratedRef.current = true;
      hydrate(partiesQ.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partiesQ.data]);

  const issues = useMemo(() => validateParties(drafts), [drafts]);
  const stats = useMemo(() => signatoryStats(drafts), [drafts]);
  const pendingConfirm = pendingRoleConfirmCount(drafts);
  const canSave = editable && dirty && !saving && canSaveParties(drafts);

  const change = (key: string, next: DraftParty) => {
    setDrafts((ds) => ds.map((d) => (d.key === key ? next : d)));
    setDirty(true);
  };
  const remove = (key: string) => {
    setDrafts((ds) => ds.filter((d) => d.key !== key));
    setDirty(true);
  };
  const confirmRole = (key: string) => {
    setDrafts((ds) =>
      ds.map((d) => (d.key === key ? { ...d, needs_role_confirm: false } : d)),
    );
    setDirty(true);
  };
  const addManually = () => {
    setDrafts((ds) => [...ds, emptyParty()]);
    setDirty(true);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const serverParties = partiesQ.data ?? [];
      const keptIds = new Set(drafts.map((d) => d.id).filter(Boolean));
      // Deletes: server rows no longer present in drafts.
      const toDelete = serverParties.filter((p) => !keptIds.has(p.id));
      for (const p of toDelete) {
        await partyService.remove(contractId, p.id);
      }
      // Creates + updates.
      for (const d of drafts) {
        const payload = buildPayload(d, hostOrgId);
        if (d.id) await partyService.update(contractId, d.id, payload);
        else await partyService.create(contractId, payload);
      }
      const fresh = await partyService.list(contractId);
      hydrate(fresh);
      toast.success(t('partiesEditor.saved'));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('partiesEditor.saveError');
      toast.error(typeof msg === 'string' ? msg : t('partiesEditor.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Loading / error ──────────────────────────────────────────────────────
  if (partiesQ.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-16">
        <LoadingSpinner size="md" />
      </div>
    );
  }
  if (partiesQ.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
        <p className="text-sm text-red-700">{t('partiesEditor.loadError')}</p>
        <button
          type="button"
          onClick={() => partiesQ.refetch()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
        >
          {t('partiesEditor.retry')}
        </button>
      </div>
    );
  }

  const isRtl = i18n.language === 'ar';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">
            {t('partiesEditor.title')}
          </h3>
          <p className="mt-0.5 text-sm text-gray-500">
            {t('partiesEditor.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
            {t('partiesEditor.partyCount', { count: drafts.length })}
          </span>
          {/* Item 2 — signatory count indicator (DISPLAY ONLY). */}
          <span
            className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
            title={t('partiesEditor.signatoriesHint')}
          >
            {t('partiesEditor.signatoriesChip', {
              designated: stats.designatedCount,
              total: stats.signatoryCount,
            })}
          </span>
        </div>
      </div>

      {/* Pinned (signed) notice */}
      {isPinned && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          {t('partiesEditor.frozen')}
        </div>
      )}

      {/* Empty state (item 3) */}
      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-gray-700">
            {t('partiesEditor.empty.title')}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            {t('partiesEditor.empty.hint')}
          </p>
          {editable && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={addManually}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {t('partiesEditor.addManually')}
              </button>
              {/* Upload/extract — DISABLED, "coming soon" (item 3; no pipeline). */}
              <button
                type="button"
                disabled
                aria-disabled="true"
                title={t('partiesEditor.comingSoon')}
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-400"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {t('partiesEditor.uploadDocument')}
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {t('partiesEditor.comingSoon')}
                </span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((d, i) => (
            <PartyCard
              key={d.key}
              party={d}
              index={i}
              issues={issues.filter((x) => x.partyKey === d.key)}
              canEdit={editable}
              hostOrgName={null}
              roleLabel={roleLabel}
              onChange={(next) => change(d.key, next)}
              onRemove={() => remove(d.key)}
              onConfirmRole={() => confirmRole(d.key)}
            />
          ))}
        </div>
      )}

      {/* Add-another + footer (editable only) */}
      {editable && drafts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={addManually}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-primary/50 hover:text-primary"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('partiesEditor.addParty')}
          </button>

          <div className="flex items-center gap-3">
            {/* Gate messaging: confirm gate (item 1) takes precedence, then issues (item 5). */}
            {pendingConfirm > 0 ? (
              <span className="text-xs font-medium text-amber-700">
                {t('partiesEditor.confirm.gate', { count: pendingConfirm })}
              </span>
            ) : issues.length > 0 ? (
              <span className="text-xs font-medium text-red-600">
                {t('partiesEditor.issuesToFix', { count: issues.length })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <LoadingSpinner size="sm" />}
              {t('partiesEditor.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
