import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';
import ObligationStatusBadge from './ObligationStatusBadge';
import ObligationTypeBadge from './ObligationTypeBadge';
import {
  effectiveStatus,
  daysUntil,
  daysTone,
  DAYS_TONE_STYLES,
  tierKey,
} from './statusUtils';

interface ObligationCardProps {
  obligation: ObligationPortfolioItem;
  /**
   * Show the project + contract links above the description. Always
   * true on ObligationsPage portfolio view, false inside ObligationsTab
   * (where the contract context is already implicit).
   */
  showContractLink?: boolean;
  onMarkActioned?: (id: string) => void;
  onEdit?: (id: string) => void;
  onAssign?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  /**
   * When supplied, a red Delete item appears in the action menu.
   * Phase 7.15: only pass this for users with APPROVER-equivalent
   * permission (SYSTEM_ADMIN / OWNER_ADMIN in the frontend gate).
   */
  onDelete?: (id: string) => void;
}

/**
 * One obligation rendered as a card.
 *
 * Layout (top → bottom):
 * 1. Top row — clause ref · type badge · status badge · days-remaining pill
 * 2. Description (dir="auto" — CLAUDE.md hard rule)
 * 3. Bottom row — due date · assignees (or "Unassigned") · action menu
 *
 * Mobile (375px): top row wraps, bottom row stacks. The action menu
 * stays anchored to the right edge so it remains tappable.
 */
export default function ObligationCard({
  obligation,
  showContractLink = false,
  onMarkActioned,
  onEdit,
  onAssign,
  onViewDetails,
  onDelete,
}: ObligationCardProps) {
  const { t } = useTranslation();
  const eff = effectiveStatus(obligation.status, obligation.due_date);
  const days = daysUntil(obligation.due_date);
  const tone = daysTone(days);
  const tier = tierKey(days);
  const isOverdue = eff === 'OVERDUE';

  const isActioned = eff === 'MET' || eff === 'COMPLETED';

  return (
    <article
      className={`rounded-lg border bg-white p-4 transition-colors ${
        isOverdue
          ? 'border-red-200'
          : obligation.is_critical
          ? 'border-amber-200'
          : 'border-gray-200'
      } hover:border-gray-300`}
    >
      {/* Project + contract links (portfolio view only) */}
      {showContractLink && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          {obligation.project && (
            <Link
              to={`/app/projects/${obligation.project.id}`}
              className="text-primary hover:underline"
            >
              {obligation.project.name}
            </Link>
          )}
          {obligation.project && obligation.contract && <span>·</span>}
          {obligation.contract && (
            <Link
              to={`/app/contracts/${obligation.contract.id}#obligation-${obligation.id}`}
              className="text-primary hover:underline"
            >
              {obligation.contract.name}
            </Link>
          )}
        </div>
      )}

      {/* Top row — refs + badges + days indicator */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {obligation.clause_ref && (
          <span className="text-[11px] font-medium text-gray-500">
            {obligation.clause_ref}
          </span>
        )}
        {obligation.is_critical && (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
            aria-label={t('obligation.ui.critical')}
            title={t('obligation.ui.critical')}
          >
            <span aria-hidden>⚠</span>
            {t('obligation.ui.critical')}
          </span>
        )}
        <ObligationTypeBadge type={obligation.obligation_type} />
        <ObligationStatusBadge status={eff} />
        {tier && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${DAYS_TONE_STYLES[tone].text} ${DAYS_TONE_STYLES[tone].bg}`}
          >
            {tier === 'overdue'
              ? t('obligation.tier.overdue', { days: Math.abs(days ?? 0) })
              : t(`obligation.tier.${tier}`)}
          </span>
        )}
      </div>

      {/* Description — CLAUDE.md hard rule: dir="auto" + unicodeBidi:plaintext */}
      <p
        className="text-sm font-medium text-gray-900"
        dir="auto"
        style={{ unicodeBidi: 'plaintext' }}
        id={`obligation-${obligation.id}`}
      >
        {obligation.description}
      </p>

      {/* Timeframe / amount line (if present) */}
      {(obligation.timeframe_description || obligation.amount) && (
        <p
          className="mt-1 text-xs text-gray-500"
          dir="auto"
          style={{ unicodeBidi: 'plaintext' }}
        >
          {obligation.timeframe_description}
          {obligation.timeframe_description && obligation.amount ? ' · ' : ''}
          {obligation.amount &&
            `${Number(obligation.amount).toLocaleString()} ${obligation.currency ?? ''}`.trim()}
        </p>
      )}

      {/* Bottom row — due date · assignees · actions */}
      <div className="mt-3 flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <IconCalendar className="h-3.5 w-3.5 text-gray-400" />
            {obligation.due_date
              ? format(new Date(obligation.due_date), 'PP')
              : t('obligation.ui.noDueDate')}
          </span>
          <AssigneesLine obligation={obligation} />
          {obligation.responsible_party && (
            <span className="inline-flex items-center gap-1.5 text-gray-400">
              · {obligation.responsible_party}
            </span>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {!isActioned && onMarkActioned && (
            <button
              onClick={() => onMarkActioned(obligation.id)}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('obligation.actions.markActioned')}
            </button>
          )}
          <ActionMenu
            obligation={obligation}
            isActioned={isActioned}
            onMarkActioned={onMarkActioned}
            onEdit={onEdit}
            onAssign={onAssign}
            onViewDetails={onViewDetails}
            onDelete={onDelete}
          />
        </div>
      </div>
    </article>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function AssigneesLine({
  obligation,
}: {
  obligation: ObligationPortfolioItem;
}) {
  const { t } = useTranslation();
  const assignees = obligation.assignees ?? [];

  if (assignees.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-400">
        <IconUser className="h-3.5 w-3.5" />
        {t('obligation.ui.unassigned')}
      </span>
    );
  }

  const first = assignees[0];
  const extras = assignees.length - 1;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={`${first.user?.first_name ?? ''} ${first.user?.last_name ?? ''}`.trim() || first.user?.email || '?'} />
      <span className="text-gray-700">
        {first.user
          ? `${first.user.first_name} ${first.user.last_name}`
          : first.user_id}
      </span>
      {extras > 0 && (
        <span className="text-gray-400">+{extras}</span>
      )}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
      {initial}
    </span>
  );
}

function ActionMenu({
  obligation,
  isActioned,
  onMarkActioned,
  onEdit,
  onAssign,
  onViewDetails,
  onDelete,
}: {
  obligation: ObligationPortfolioItem;
  isActioned: boolean;
  onMarkActioned?: (id: string) => void;
  onEdit?: (id: string) => void;
  onAssign?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        aria-label={t('common.actions')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {!isActioned && onMarkActioned && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onMarkActioned(obligation.id);
              }}
            >
              {t('obligation.actions.markActioned')}
            </MenuItem>
          )}
          {onAssign && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onAssign(obligation.id);
              }}
            >
              {t('obligation.actions.assign')}
            </MenuItem>
          )}
          {onEdit && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onEdit(obligation.id);
              }}
            >
              {t('obligation.actions.edit')}
            </MenuItem>
          )}
          {onViewDetails && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onViewDetails(obligation.id);
              }}
            >
              {t('obligation.actions.viewDetails')}
            </MenuItem>
          )}
          {onDelete && (
            <>
              <div className="my-1 border-t border-gray-100" role="separator" />
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  onDelete(obligation.id);
                }}
                variant="danger"
              >
                {t('obligation.actions.delete')}
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  variant = 'default',
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-3 py-2 text-start text-sm ${
        variant === 'danger'
          ? 'text-red-600 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  );
}

function IconUser({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}
