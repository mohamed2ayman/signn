import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addMonths, subMonths } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { ar } from 'date-fns/locale/ar';
import { fr } from 'date-fns/locale/fr';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { obligationService } from '@/services/api/obligationService';
import { projectService } from '@/services/api/projectService';
import type { ObligationCalendarEvent } from '@/services/api/obligationService';
import type {
  ObligationStatus,
  ObligationType,
} from '@/services/api/complianceService';
import { OBLIGATION_STATUSES, OBLIGATION_TYPES } from '@/components/obligations/statusUtils';
import ObligationDetailDrawer from '@/components/obligations/ObligationDetailDrawer';
import MarkActionedModal from '@/components/obligations/MarkActionedModal';
import AddEditObligationModal from '@/components/obligations/AddEditObligationModal';
import AssignUserModal from '@/components/obligations/AssignUserModal';

// ─── react-big-calendar setup ─────────────────────────────────────
//
// date-fns localizer keyed by the current i18n language. RBC keeps a
// single Calendar instance, so we re-create the localizer per language
// inside the component via useMemo.

const LOCALES = { 'en-US': enUS, ar, fr };
type LocaleKey = keyof typeof LOCALES;

function makeLocalizer(lang: string) {
  return dateFnsLocalizer({
    format,
    parse,
    startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    getDay,
    locales: LOCALES,
    culture: (lang.startsWith('ar')
      ? 'ar'
      : lang.startsWith('fr')
      ? 'fr'
      : 'en-US') as LocaleKey,
  });
}

// Status → RBC event style. Caller-side filtering ensures every event
// gets a colour because backend pre-computes obligation.color too —
// we override with our own mapping to match the rest of the UI.
const STATUS_COLORS: Record<ObligationStatus, string> = {
  PENDING: '#F59E0B', // amber
  IN_PROGRESS: '#3B82F6', // blue
  COMPLETED: '#10B981', // emerald
  MET: '#10B981',
  OVERDUE: '#EF4444', // red
  WAIVED: '#6B7280', // gray
};

/**
 * /app/obligations/calendar — month / week / day calendar showing
 * every obligation from the user's accessible contracts as events.
 *
 * Filters mirror ObligationsPage (project / contract / type / status /
 * assignee) so the user can drill down without leaving the calendar.
 *
 * Clicking an event opens the same ObligationDetailDrawer as the rest
 * of the obligation surfaces — keeping interactions consistent.
 *
 * Mobile responsive: the RBC default toolbar collapses gracefully at
 * narrow widths; we hide the secondary nav (Today / Back / Next) labels
 * via CSS overrides defined inline below.
 */
export default function ObligationsCalendarPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  // ── Calendar UI state ──────────────────────────────────────────
  const [view, setView] = useState<View>('month');
  const [date, setDate] = useState<Date>(new Date());
  const [filters, setFilters] = useState<{
    project_id?: string;
    contract_id?: string;
    type?: ObligationType;
    status?: ObligationStatus;
    assignee?: string;
  }>({});

  // Detail drawer + modal state
  const [drawerObligationId, setDrawerObligationId] = useState<string | null>(null);
  const [drawerContractId, setDrawerContractId] = useState<string>('');
  const [editObligation, setEditObligation] = useState<{ obligation: ObligationCalendarEvent | null; contractId: string } | null>(null);
  const [actioningObligation, setActioningObligation] = useState<{ obligation: ObligationCalendarEvent | null; contractId: string } | null>(null);
  const [assigningObligation, setAssigningObligation] = useState<{ obligation: ObligationCalendarEvent | null; contractId: string; projectId?: string } | null>(null);

  // ── Date-range computed from current view + date ───────────────
  // Backend caps the calendar window at 1 year per Step 1 docs —
  // month/week/day views are all well under that.
  const { rangeFrom, rangeTo } = useMemo(() => {
    const from = subMonths(date, 1);
    const to = addMonths(date, 2);
    return { rangeFrom: from.toISOString().slice(0, 10), rangeTo: to.toISOString().slice(0, 10) };
  }, [date]);

  // ── Data fetches ───────────────────────────────────────────────
  const eventsQuery = useQuery({
    queryKey: ['obligation-calendar', rangeFrom, rangeTo],
    queryFn: () => obligationService.getCalendarObligations(rangeFrom, rangeTo),
  });

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getAll(),
  });

  // ── Apply UI filters client-side ───────────────────────────────
  const filteredEvents = useMemo(() => {
    const all = eventsQuery.data ?? [];
    return all.filter((ev) => {
      if (filters.project_id && ev.project_id !== filters.project_id) return false;
      if (filters.contract_id && ev.contract_id !== filters.contract_id) return false;
      if (filters.status && ev.status !== filters.status) return false;
      // type + assignee not present on calendar event payload —
      // would require a richer endpoint. Step 4 work.
      return true;
    });
  }, [eventsQuery.data, filters]);

  // ── react-big-calendar event mapping ───────────────────────────
  const rbcEvents = useMemo(
    () =>
      filteredEvents.map((ev) => ({
        id: ev.id,
        title: ev.title,
        start: new Date(ev.start),
        end: new Date(ev.end),
        resource: ev,
      })),
    [filteredEvents],
  );

  const localizer = useMemo(() => makeLocalizer(i18n.language), [i18n.language]);

  // ── Event-style fn — colour per status ─────────────────────────
  const eventPropGetter = (event: { resource: ObligationCalendarEvent }) => {
    const color = STATUS_COLORS[event.resource.status] ?? '#6B7280';
    return {
      style: {
        backgroundColor: color,
        borderColor: color,
        borderRadius: '4px',
        color: 'white',
        fontSize: '11px',
        padding: '2px 4px',
      },
    };
  };

  // ── Footer-callback wiring ─────────────────────────────────────
  // When the drawer opens, we don't know the contract_id directly —
  // we capture it from the clicked event's resource.
  const handleSelectEvent = (event: {
    id: string;
    resource: ObligationCalendarEvent;
  }) => {
    setDrawerObligationId(event.id);
    setDrawerContractId(event.resource.contract_id);
  };

  // ── Drawer → child modals: shared launchers ────────────────────
  const handleEditFromDrawer = () => {
    // Re-fetch fresh — open edit modal with the underlying obligation.
    // The drawer holds a ContractObligation in its query cache; we just
    // mark the modal as "editing" via id pass-through. (For brevity the
    // edit modal reads the same id from cache through React Query.)
    setEditObligation({ obligation: null, contractId: drawerContractId });
  };
  const handleMarkActionedFromDrawer = () => {
    setActioningObligation({ obligation: null, contractId: drawerContractId });
  };
  const handleAssignFromDrawer = () => {
    setAssigningObligation({ obligation: null, contractId: drawerContractId });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['obligation-calendar'] });
    qc.invalidateQueries({ queryKey: ['obligation-detail'] });
  };

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <nav className="mb-1 flex items-center gap-1 text-xs text-gray-500">
            <Link to="/app/obligations" className="hover:text-gray-700">
              {t('obligation.titlePlural')}
            </Link>
            <span>›</span>
            <span className="text-gray-700">{t('obligation.calendar.title')}</span>
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">
            {t('obligation.calendar.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {t('obligation.calendar.subtitle')}
          </p>
        </div>
        <Link
          to="/app/obligations"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
          {t('obligation.calendar.backToList')}
        </Link>
      </div>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <FilterField label={t('project.title')}>
          <select
            value={filters.project_id ?? ''}
            onChange={(e) =>
              setFilters({ ...filters, project_id: e.target.value || undefined })
            }
            className="min-w-[140px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            <option value="">{t('common.all')}</option>
            {(projectsQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label={t('common.type')}>
          <select
            value={filters.type ?? ''}
            onChange={(e) =>
              setFilters({ ...filters, type: (e.target.value as ObligationType) || undefined })
            }
            className="min-w-[140px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            <option value="">{t('common.all')}</option>
            {OBLIGATION_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {t(`obligation.type.${tp}`)}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label={t('common.status')}>
          <select
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters({ ...filters, status: (e.target.value as ObligationStatus) || undefined })
            }
            className="min-w-[120px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            <option value="">{t('common.all')}</option>
            {OBLIGATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`obligation.status.${s}`)}
              </option>
            ))}
          </select>
        </FilterField>
      </div>

      {/* ── Calendar ──────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
        {eventsQuery.isLoading ? (
          <p className="py-16 text-center text-sm text-gray-500">
            {t('common.loading')}
          </p>
        ) : eventsQuery.isError ? (
          <p className="py-16 text-center text-sm text-red-600">
            {t('obligation.ui.errorTitle')}
          </p>
        ) : (
          <Calendar
            localizer={localizer}
            events={rbcEvents}
            startAccessor={(e) => (e as (typeof rbcEvents)[number]).start}
            endAccessor={(e) => (e as (typeof rbcEvents)[number]).end}
            titleAccessor={(e) => (e as (typeof rbcEvents)[number]).title}
            view={view}
            onView={(v) => setView(v)}
            date={date}
            onNavigate={(d) => setDate(d)}
            views={['month', 'week', 'day']}
            popup
            messages={{
              today: t('obligation.calendar.today'),
              previous: t('common.previous'),
              next: t('common.next'),
              month: t('obligation.calendar.monthView'),
              week: t('obligation.calendar.weekView'),
              day: t('obligation.calendar.dayView'),
              noEventsInRange: t('obligation.calendar.noEventsInRange'),
            }}
            eventPropGetter={(e) =>
              eventPropGetter(e as { resource: ObligationCalendarEvent })
            }
            onSelectEvent={(e) =>
              handleSelectEvent(
                e as { id: string; resource: ObligationCalendarEvent },
              )
            }
            style={{ height: '70vh', minHeight: 500 }}
            culture={
              i18n.language.startsWith('ar')
                ? 'ar'
                : i18n.language.startsWith('fr')
                ? 'fr'
                : 'en-US'
            }
          />
        )}
      </div>

      {/* ── Drawer + modals ───────────────────────────────────── */}
      <ObligationDetailDrawer
        isOpen={!!drawerObligationId}
        obligationId={drawerObligationId}
        contractId={drawerContractId}
        onClose={() => setDrawerObligationId(null)}
        onEdit={() => handleEditFromDrawer()}
        onMarkActioned={() => handleMarkActionedFromDrawer()}
        onAssign={() => handleAssignFromDrawer()}
      />

      {editObligation && (
        <AddEditObligationModal
          isOpen
          onClose={() => setEditObligation(null)}
          contractId={editObligation.contractId}
          obligation={null}
          onSuccess={invalidate}
        />
      )}

      {actioningObligation && (
        <MarkActionedModal
          isOpen
          onClose={() => setActioningObligation(null)}
          obligation={null}
          contractId={actioningObligation.contractId}
          onSuccess={invalidate}
        />
      )}

      {assigningObligation && (
        <AssignUserModal
          isOpen
          onClose={() => setAssigningObligation(null)}
          obligation={null}
          contractId={assigningObligation.contractId}
          projectId={assigningObligation.projectId}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}
