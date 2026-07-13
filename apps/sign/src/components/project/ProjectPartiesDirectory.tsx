import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { projectPartyService } from '@/services/api/projectPartyService';
import { projectService } from '@/services/api/projectService';
import { PartyType, PermissionLevel } from '@/types';
import type { ProjectParty, ProjectMember } from '@/types';
import {
  partyStatusKind,
  PARTY_STATUS_BADGE,
  partyTypeCounts,
  filterPartiesByType,
  memberDisplay,
  initialsOf,
} from './directoryData';
import type { PartyTypeFilter, PartyStatusKind } from './directoryData';

/**
 * Parties & Team directory — 7.20 slice 4a (DISPLAY-ONLY).
 *
 * Replaces the "Parties & Team" tab placeholder with the three-section
 * directory: (1) external parties card grid, (2) internal team matrix,
 * (3) Portal Guests vision placeholder (labelled, never populated —
 * guest access is contract-scoped; no project-level endpoint exists).
 *
 * Data rides the SAME two query keys Slice 3's DirectorySummary already
 * wired (lesson #213 — identical queryKeys ARE the lift):
 * ['project-parties', projectId] + ['project-members', projectId].
 * Per-source error isolation: a parties failure never blanks the team
 * section and vice versa (the Slice 2/3 isolation pattern).
 *
 * DEFERRED to Slice 4b: ALL write actions. The Send/Resend invite
 * buttons are rendered per the design but DISABLED — there is no
 * existing party-invite UI surface to navigate to, and inline POSTs
 * are out of scope this slice.
 */
export default function ProjectPartiesDirectory({ projectId }: { projectId: string }) {
  const partiesQ = useQuery({
    queryKey: ['project-parties', projectId],
    queryFn: () => projectPartyService.getAll(projectId),
    enabled: !!projectId,
  });
  const membersQ = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectService.getMembers(projectId),
    enabled: !!projectId,
  });

  return (
    <div className="space-y-6">
      <PartiesSection
        parties={partiesQ.data}
        loading={partiesQ.isLoading}
        error={partiesQ.isError}
        onRetry={() => void partiesQ.refetch()}
      />
      <TeamSection
        projectId={projectId}
        members={membersQ.data}
        loading={membersQ.isLoading}
        error={membersQ.isError}
        onRetry={() => void membersQ.refetch()}
      />
      <GuestsVisionSection />
    </div>
  );
}

// ─── Shared section chrome (matches the page's card idiom) ────────

function SectionCard({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200/80 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          {count !== undefined && (
            <span dir="ltr" className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function SectionLoading() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span aria-hidden="true" className="text-2xl">
        ⚠️
      </span>
      <p className="text-sm text-red-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
      >
        {t('projectDashboard.directory.retry')}
      </button>
    </div>
  );
}

// ─── 1. External parties ─────────────────────────────────────────

function PartiesSection({
  parties,
  loading,
  error,
  onRetry,
}: {
  parties: ProjectParty[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<PartyTypeFilter>('ALL');

  const counts = partyTypeCounts(parties ?? []);
  const visible = filterPartiesByType(parties ?? [], filter);

  return (
    <SectionCard title={t('projectDashboard.directory.parties.title')} count={parties?.length}>
      {error ? (
        <SectionError message={t('projectDashboard.directory.parties.error')} onRetry={onRetry} />
      ) : loading ? (
        <SectionLoading />
      ) : !parties || parties.length === 0 ? (
        <PartiesEmptyState />
      ) : (
        <div className="space-y-4">
          {/* Filter chips: All + the 6 party types with counts (0-count disabled) */}
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label={t('projectDashboard.directory.parties.filterAll')}
              count={counts.total}
              selected={filter === 'ALL'}
              onClick={() => setFilter('ALL')}
            />
            {Object.values(PartyType).map((type) => (
              <FilterChip
                key={type}
                label={t(`projectDashboard.analytics.directory.partyType.${type}`)}
                count={counts.byType[type]}
                selected={filter === type}
                disabled={counts.byType[type] === 0}
                onClick={() => setFilter(type)}
              />
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              {t('projectDashboard.directory.parties.noneOfType')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((party) => (
                <PartyCard key={party.id} party={party} />
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function FilterChip({
  label,
  count,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
      <span dir="ltr" className={selected ? 'text-primary' : 'text-gray-400'}>
        {count}
      </span>
    </button>
  );
}

const STATUS_LABEL_KEY: Record<PartyStatusKind, string> = {
  active: 'projectDashboard.directory.parties.status.active',
  invited: 'projectDashboard.directory.parties.status.invited',
  pending: 'projectDashboard.directory.parties.status.pending',
};

const STATUS_FOOTER_KEY: Record<PartyStatusKind, string> = {
  active: 'projectDashboard.directory.parties.footer.active',
  invited: 'projectDashboard.directory.parties.footer.invited',
  pending: 'projectDashboard.directory.parties.footer.notInvited',
};

function PartyCard({ party }: { party: ProjectParty }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const kind = partyStatusKind(party.invitation_status);

  const copyEmail = async () => {
    try {
      await navigator.clipboard?.writeText(party.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — non-critical affordance */
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header: avatar + name/type, status badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
          >
            {initialsOf(party.name)}
          </span>
          <div className="min-w-0">
            <p
              className="truncate text-sm font-semibold text-gray-900"
              dir="auto"
              style={{ unicodeBidi: 'plaintext' }}
            >
              {party.name}
            </p>
            <span className="mt-0.5 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              {t(`projectDashboard.analytics.directory.partyType.${party.party_type}`)}
            </span>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${PARTY_STATUS_BADGE[kind]}`}
        >
          {t(STATUS_LABEL_KEY[kind])}
        </span>
      </div>

      {/* Contact rows */}
      <div className="mt-4 space-y-1.5 text-sm">
        {party.contact_person ? (
          <p className="text-gray-700" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
            {party.contact_person}
          </p>
        ) : (
          <p className="italic text-gray-400">
            {t('projectDashboard.directory.parties.noContactPerson')}
          </p>
        )}
        <div className="flex items-center gap-2">
          <a
            href={`mailto:${party.email}`}
            className="min-w-0 truncate text-primary hover:underline"
            dir="auto"
            style={{ unicodeBidi: 'plaintext' }}
          >
            {party.email}
          </a>
          <button
            type="button"
            onClick={() => void copyEmail()}
            className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:bg-gray-50"
          >
            {copied
              ? t('projectDashboard.directory.parties.emailCopied')
              : t('projectDashboard.directory.parties.copyEmail')}
          </button>
        </div>
        <p className="text-gray-500" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
          {party.phone ?? '—'}
        </p>
      </div>

      {/* Footer: contextual status line + honest added-date; invite CTA (4b) */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{t(STATUS_FOOTER_KEY[kind])}</p>
          <p className="text-[11px] text-gray-400">
            {t('projectDashboard.directory.parties.added', {
              date: new Date(party.created_at).toLocaleDateString(),
            })}
          </p>
        </div>
        {/* Display-only this slice: no existing invite surface to navigate
            to, and inline POST is Slice 4b — render disabled per spec. */}
        {kind === 'pending' && (
          <button
            type="button"
            disabled
            title={t('projectDashboard.directory.parties.inviteComingSoon')}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white opacity-50"
          >
            {t('projectDashboard.directory.parties.invite')}
          </button>
        )}
        {kind === 'invited' && (
          <button
            type="button"
            disabled
            title={t('projectDashboard.directory.parties.inviteComingSoon')}
            className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 opacity-60"
          >
            {t('projectDashboard.directory.parties.resendInvite')}
          </button>
        )}
      </div>
    </div>
  );
}

function PartiesEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-500">
        {t('projectDashboard.directory.parties.empty')}
      </p>
      <p className="mt-1 text-xs text-gray-400">
        {t('projectDashboard.directory.parties.emptyHint')}
      </p>
      {/* Labelled affordance only — no add-party flow exists yet (4b). */}
      <button
        type="button"
        disabled
        title={t('projectDashboard.directory.parties.inviteComingSoon')}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white opacity-50"
      >
        {t('projectDashboard.directory.parties.addParty')}
      </button>
    </div>
  );
}

// ─── 2. Internal team ────────────────────────────────────────────

/** Existing permission-badge palette — mirrors ProjectPermissionsPage's levelBadge. */
const PERMISSION_LEVEL_BADGE: Record<PermissionLevel, string> = {
  [PermissionLevel.VIEWER]: 'bg-gray-100 text-gray-700',
  [PermissionLevel.COMMENTER]: 'bg-blue-50 text-blue-700',
  [PermissionLevel.EDITOR]: 'bg-amber-50 text-amber-700',
  [PermissionLevel.APPROVER]: 'bg-emerald-50 text-emerald-700',
};

function TeamSection({
  projectId,
  members,
  loading,
  error,
  onRetry,
}: {
  projectId: string;
  members: ProjectMember[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <SectionCard
      title={t('projectDashboard.directory.team.title')}
      count={members?.length}
      action={
        <Link
          to={`/app/projects/${projectId}/permissions`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary-600"
        >
          {t('projectDashboard.directory.team.managePermissions')}
          <span aria-hidden="true">↗</span>
        </Link>
      }
    >
      {error ? (
        <SectionError message={t('projectDashboard.directory.team.error')} onRetry={onRetry} />
      ) : loading ? (
        <SectionLoading />
      ) : !members || members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-500">
            {t('projectDashboard.directory.team.empty')}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {t('projectDashboard.directory.team.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-start font-medium text-gray-500">
                  {t('projectDashboard.directory.team.columns.member')}
                </th>
                <th className="px-4 py-3 text-start font-medium text-gray-500">
                  {t('projectDashboard.directory.team.columns.jobTitle')}
                </th>
                <th className="px-4 py-3 text-start font-medium text-gray-500">
                  {t('projectDashboard.directory.team.columns.role')}
                </th>
                <th className="px-4 py-3 text-start font-medium text-gray-500">
                  {t('projectDashboard.directory.team.columns.permission')}
                </th>
                <th className="px-4 py-3 text-start font-medium text-gray-500">
                  {t('projectDashboard.directory.team.columns.added')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {members.map((member) => (
                <MemberRow key={member.id} member={member} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function MemberRow({ member }: { member: ProjectMember }) {
  const { t } = useTranslation();
  const d = memberDisplay(member);

  return (
    <tr className="transition-colors hover:bg-gray-50/50">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          {d.isPendingInvitation ? (
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-xs font-semibold text-gray-400"
            >
              ?
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {initialsOf(d.name)}
            </span>
          )}
          <div className="min-w-0">
            {d.isPendingInvitation ? (
              <>
                <p className="font-medium text-gray-500">
                  {t('projectDashboard.directory.team.pendingTeammate')}
                </p>
                <p className="text-xs text-gray-400">
                  {t('projectDashboard.directory.team.pendingInvitation')}
                </p>
              </>
            ) : (
              <p
                className="font-medium text-gray-900"
                dir="auto"
                style={{ unicodeBidi: 'plaintext' }}
              >
                {d.name}
              </p>
            )}
            <p className="truncate text-xs text-gray-400" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
              {d.email}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 text-gray-600">
        {d.jobTitle ?? (
          <span className="text-gray-300">
            {t('projectDashboard.directory.team.jobTitleNotSet')}
          </span>
        )}
      </td>
      <td className="px-4 py-3.5">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {d.systemRole.replace(/_/g, ' ')}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${PERMISSION_LEVEL_BADGE[d.permissionLevel]}`}
        >
          {t(`projectDashboard.directory.team.permissionLevel.${d.permissionLevel}`)}
        </span>
      </td>
      <td className="px-4 py-3.5 text-gray-500">
        <span dir="ltr">{new Date(member.added_at).toLocaleDateString()}</span>
      </td>
    </tr>
  );
}

// ─── 3. Portal Guests — vision placeholder (labelled, never live) ─

function GuestsVisionSection() {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t('projectDashboard.directory.guests.title')}
      action={
        <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          {t('projectDashboard.directory.guests.plannedBadge')}
        </span>
      }
    >
      <p className="text-sm text-gray-500">
        {t('projectDashboard.directory.guests.explanation')}
      </p>
      {/* Non-live ghost rows — decorative only; no data is fetched or
          fabricated (guest access is contract-scoped; no project-level
          endpoint exists — confirmed backend gap). */}
      <div aria-hidden="true" className="mt-4 space-y-2 opacity-50">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 px-4 py-3">
            <span className="h-8 w-8 shrink-0 rounded-full border-2 border-dashed border-gray-300" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-1/3 rounded bg-gray-200" />
              <div className="h-2 w-1/2 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
