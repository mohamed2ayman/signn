/**
 * 7.20 Slice 5 — Customize mode: layout model (pure + localStorage wrappers).
 *
 * ONLY the four SUPPORTING ANALYTICS widgets are customizable (reorder +
 * hide/show). The ProjectHealthBar and ProjectAttentionZone are the fixed
 * dashboard spine (the "30-second test") and are deliberately NOT part of this
 * model — they are never listed here, so they can never be hidden or reordered.
 *
 * Persistence is localStorage ONLY (per-browser). There is NO backend
 * preferences store — server-side layout sync is DEFERRED to Ayman. UI copy
 * must never imply cross-device sync. Follows the `sign_portfolio_view`
 * localStorage precedent in PortfolioPage.tsx.
 */

export type WidgetId = 'riskMix' | 'obligations' | 'contractsByStatus' | 'directory';

/** The canonical default order — every widget visible, in this order. */
export const DEFAULT_WIDGET_ORDER: readonly WidgetId[] = [
  'riskMix',
  'obligations',
  'contractsByStatus',
  'directory',
];

/** The complete set of known widget ids (order-independent membership test). */
export const KNOWN_WIDGET_IDS: ReadonlySet<WidgetId> = new Set(DEFAULT_WIDGET_ORDER);

export interface DashboardLayout {
  /** Master ordering of ALL known widgets (visible + hidden). */
  order: WidgetId[];
  /** Ids currently hidden from the row. */
  hidden: WidgetId[];
}

export const DEFAULT_LAYOUT: DashboardLayout = {
  order: [...DEFAULT_WIDGET_ORDER],
  hidden: [],
};

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'sign_project_dashboard_layout';

/**
 * Per-user-and-project key. localStorage is per-browser; the user scope guards
 * a browser shared by two accounts (the existing `sign_portfolio_view` key is
 * not user-scoped — this is the more correct default the prompt asked for).
 */
export function layoutStorageKey(userId: string | null | undefined, projectId: string): string {
  return `${STORAGE_PREFIX}:v${STORAGE_VERSION}:${userId ?? 'anon'}:${projectId}`;
}

function cloneDefault(): DashboardLayout {
  return { order: [...DEFAULT_WIDGET_ORDER], hidden: [] };
}

function isWidgetId(x: unknown): x is WidgetId {
  return typeof x === 'string' && KNOWN_WIDGET_IDS.has(x as WidgetId);
}

/**
 * Reconcile an arbitrary stored value into a valid layout. NEVER throws.
 * - non-object / corrupt shape → DEFAULT_LAYOUT
 * - unknown widget entries → dropped (future-proofing against removed widgets)
 * - known widgets missing from the stored order → appended in default order,
 *   defaulting to VISIBLE (a widget added in a later release shows up, it is not
 *   silently swallowed)
 * - hidden ids not present in the resolved order → dropped
 */
export function normalizeLayout(raw: unknown): DashboardLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cloneDefault();

  const rec = raw as Record<string, unknown>;
  const rawOrder = Array.isArray(rec.order) ? rec.order : [];
  const rawHidden = Array.isArray(rec.hidden) ? rec.hidden : [];

  // 1. known ids in stored order, de-duped
  const order: WidgetId[] = [];
  for (const id of rawOrder) {
    if (isWidgetId(id) && !order.includes(id)) order.push(id);
  }
  // 2. append any known widget missing from the stored order (default visible)
  for (const id of DEFAULT_WIDGET_ORDER) {
    if (!order.includes(id)) order.push(id);
  }
  // 3. hidden = known ids present in the resolved order, de-duped
  const hidden: WidgetId[] = [];
  for (const id of rawHidden) {
    if (isWidgetId(id) && order.includes(id) && !hidden.includes(id)) hidden.push(id);
  }

  return { order, hidden };
}

// ─── Pure derivations ────────────────────────────────────────────

/** Visible widgets in their master-order sequence (what the row renders). */
export function visibleWidgets(layout: DashboardLayout): WidgetId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

export function isAllHidden(layout: DashboardLayout): boolean {
  return visibleWidgets(layout).length === 0;
}

export function isDefaultLayout(layout: DashboardLayout): boolean {
  return (
    layout.hidden.length === 0 &&
    layout.order.length === DEFAULT_WIDGET_ORDER.length &&
    layout.order.every((id, i) => id === DEFAULT_WIDGET_ORDER[i])
  );
}

// ─── Pure transforms (each returns a NEW layout) ─────────────────

/** Move a widget one slot up (dir=-1) or down (dir=+1) in the full order. No-op at ends / unknown id. */
export function moveWidget(layout: DashboardLayout, id: WidgetId, dir: -1 | 1): DashboardLayout {
  const order = [...layout.order];
  const i = order.indexOf(id);
  if (i < 0) return layout;
  const j = i + dir;
  if (j < 0 || j >= order.length) return layout;
  [order[i], order[j]] = [order[j], order[i]];
  return { order, hidden: [...layout.hidden] };
}

/** Drag-and-drop drop handler: move `dragId` to occupy `targetId`'s slot. */
export function reorderTo(layout: DashboardLayout, dragId: WidgetId, targetId: WidgetId): DashboardLayout {
  if (dragId === targetId) return layout;
  const order = layout.order.filter((wid) => wid !== dragId);
  const target = order.indexOf(targetId);
  if (target < 0) return layout;
  order.splice(target, 0, dragId);
  return { order, hidden: [...layout.hidden] };
}

export function hideWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  if (!layout.order.includes(id) || layout.hidden.includes(id)) return layout;
  return { order: [...layout.order], hidden: [...layout.hidden, id] };
}

export function showWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  if (!layout.hidden.includes(id)) return layout;
  return { order: [...layout.order], hidden: layout.hidden.filter((h) => h !== id) };
}

/** Fresh default layout — order restored, everything un-hidden. */
export function resetLayout(): DashboardLayout {
  return cloneDefault();
}

// ─── localStorage wrappers (never throw) ─────────────────────────

export function loadLayout(key: string): DashboardLayout {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return cloneDefault();
    return normalizeLayout(JSON.parse(raw));
  } catch {
    /* corrupt / unavailable localStorage → safe default, never crash */
    return cloneDefault();
  }
}

export function saveLayout(key: string, layout: DashboardLayout): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ v: STORAGE_VERSION, order: layout.order, hidden: layout.hidden }),
    );
  } catch {
    /* ignore quota / private-mode / availability errors */
  }
}
