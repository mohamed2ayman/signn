import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContractObligation } from '@/services/api/complianceService';
import { effectiveStatus } from './statusUtils';

interface ObligationActionMenuProps {
  obligation: ContractObligation;
  onMarkActioned?: () => void;
  onEdit?: () => void;
  onAssign?: () => void;
  onViewDetails?: () => void;
}

/**
 * Three-dot action menu shown on every obligation card.
 *
 * - Item visibility:
 *     View Details   — always
 *     Mark Actioned  — only if effective status is PENDING / IN_PROGRESS / OVERDUE
 *     Edit           — always
 *     Assign         — always (only shown when parent supplies the callback)
 *
 * - Delete is NOT shown in Step 3. The backend exposes DELETE
 *   /obligations/:id with JWT-only gating but no per-role permission
 *   model exists on the frontend. Deferred per Step 3 decision
 *   documented in CLAUDE.md (Phase 7.1 Step 3 "what's deferred").
 *
 * - Click-outside + Escape close.
 * - Keyboard: Enter/Space on trigger toggles; arrow nav inside the menu
 *   handled by the browser's native button focus order.
 */
export default function ObligationActionMenu({
  obligation,
  onMarkActioned,
  onEdit,
  onAssign,
  onViewDetails,
}: ObligationActionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const eff = effectiveStatus(obligation.status, obligation.due_date);
  const canMarkActioned =
    eff === 'PENDING' || eff === 'IN_PROGRESS' || eff === 'OVERDUE';

  const close = () => setOpen(false);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('common.actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
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
          {onViewDetails && (
            <MenuItem onClick={() => { close(); onViewDetails(); }}>
              {t('obligation.actions.viewDetails')}
            </MenuItem>
          )}
          {canMarkActioned && onMarkActioned && (
            <MenuItem onClick={() => { close(); onMarkActioned(); }}>
              {t('obligation.actions.markActioned')}
            </MenuItem>
          )}
          {onEdit && (
            <MenuItem onClick={() => { close(); onEdit(); }}>
              {t('obligation.actions.edit')}
            </MenuItem>
          )}
          {onAssign && (
            <MenuItem onClick={() => { close(); onAssign(); }}>
              {t('obligation.actions.assign')}
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-start text-sm text-gray-700 hover:bg-gray-50"
    >
      {children}
    </button>
  );
}
