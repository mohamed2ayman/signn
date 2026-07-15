/**
 * 7.20 Slice 5 — Customize mode: pure layout-model tests (RED-first).
 *
 * Covers the reconciliation invariants the customize UI depends on:
 * corrupt/invalid → default (resilience), unknown-widget entries dropped,
 * missing-widget entries appended-visible, hidden-set sanitised, plus the
 * pure reorder/hide/show transforms and the localStorage round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  DEFAULT_WIDGET_ORDER,
  DEFAULT_LAYOUT,
  KNOWN_WIDGET_IDS,
  normalizeLayout,
  visibleWidgets,
  isAllHidden,
  isDefaultLayout,
  moveWidget,
  reorderTo,
  hideWidget,
  showWidget,
  resetLayout,
  loadLayout,
  saveLayout,
  layoutStorageKey,
  type DashboardLayout,
  type WidgetId,
} from './dashboardLayout';

describe('dashboardLayout — widget registry', () => {
  it('knows exactly the four supporting analytics widgets (health bar + attention zone are NOT here)', () => {
    expect([...DEFAULT_WIDGET_ORDER].sort()).toEqual(
      ['contractsByStatus', 'directory', 'obligations', 'riskMix'].sort(),
    );
    expect(KNOWN_WIDGET_IDS.size).toBe(4);
    // The fixed spine must never be a manageable widget.
    expect(KNOWN_WIDGET_IDS.has('health' as WidgetId)).toBe(false);
    expect(KNOWN_WIDGET_IDS.has('attention' as WidgetId)).toBe(false);
  });

  it('default layout is every widget visible in canonical order', () => {
    expect(DEFAULT_LAYOUT.order).toEqual([...DEFAULT_WIDGET_ORDER]);
    expect(DEFAULT_LAYOUT.hidden).toEqual([]);
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
  });
});

describe('normalizeLayout — resilience & reconciliation', () => {
  it.each([null, undefined, 'garbage', 42, [], true])(
    'returns the default layout for the corrupt/invalid value %p',
    (bad) => {
      const out = normalizeLayout(bad as unknown);
      expect(out.order).toEqual([...DEFAULT_WIDGET_ORDER]);
      expect(out.hidden).toEqual([]);
    },
  );

  it('drops unknown widget entries (future-proofing) without crashing', () => {
    const out = normalizeLayout({
      order: ['directory', 'someFutureWidget', 'riskMix'],
      hidden: ['someFutureWidget'],
    });
    expect(out.order).not.toContain('someFutureWidget');
    // known ids only, and all four present
    expect([...out.order].sort()).toEqual([...DEFAULT_WIDGET_ORDER].sort());
    expect(out.hidden).toEqual([]); // unknown hidden id dropped
  });

  it('appends known widgets missing from the stored order (default VISIBLE, not dropped)', () => {
    const out = normalizeLayout({ order: ['directory'], hidden: [] });
    expect(out.order[0]).toBe('directory'); // stored position preserved
    expect([...out.order].sort()).toEqual([...DEFAULT_WIDGET_ORDER].sort()); // all four present
    // appended widgets default to visible
    expect(out.hidden).toEqual([]);
    expect(visibleWidgets(out)).toHaveLength(4);
  });

  it('keeps a valid reordered + hidden layout intact', () => {
    const out = normalizeLayout({
      order: ['obligations', 'riskMix', 'directory', 'contractsByStatus'],
      hidden: ['directory'],
    });
    expect(out.order).toEqual(['obligations', 'riskMix', 'directory', 'contractsByStatus']);
    expect(out.hidden).toEqual(['directory']);
  });

  it('de-dupes repeated ids in order and hidden', () => {
    const out = normalizeLayout({
      order: ['riskMix', 'riskMix', 'directory'],
      hidden: ['directory', 'directory'],
    });
    expect(out.order.filter((x) => x === 'riskMix')).toHaveLength(1);
    expect(out.hidden).toEqual(['directory']);
  });

  it('drops hidden ids not present in the resolved order', () => {
    const out = normalizeLayout({ order: DEFAULT_WIDGET_ORDER, hidden: ['ghost'] });
    expect(out.hidden).toEqual([]);
  });
});

describe('pure transforms', () => {
  const base: DashboardLayout = {
    order: ['riskMix', 'obligations', 'contractsByStatus', 'directory'],
    hidden: [],
  };

  it('moveWidget up/down swaps neighbours and is a no-op at the ends', () => {
    const down = moveWidget(base, 'riskMix', 1);
    expect(down.order).toEqual(['obligations', 'riskMix', 'contractsByStatus', 'directory']);

    const up = moveWidget(base, 'obligations', -1);
    expect(up.order).toEqual(['obligations', 'riskMix', 'contractsByStatus', 'directory']);

    // no-op at boundaries
    expect(moveWidget(base, 'riskMix', -1).order).toEqual(base.order);
    expect(moveWidget(base, 'directory', 1).order).toEqual(base.order);
    // unknown id no-op
    expect(moveWidget(base, 'ghost' as WidgetId, 1).order).toEqual(base.order);
  });

  it('moveWidget returns a NEW object (no mutation of input)', () => {
    const out = moveWidget(base, 'riskMix', 1);
    expect(out).not.toBe(base);
    expect(base.order).toEqual(['riskMix', 'obligations', 'contractsByStatus', 'directory']);
  });

  it('reorderTo moves a widget to occupy the target slot', () => {
    const out = reorderTo(base, 'directory', 'riskMix');
    expect(out.order).toEqual(['directory', 'riskMix', 'obligations', 'contractsByStatus']);
    // dropping onto itself is a no-op
    expect(reorderTo(base, 'riskMix', 'riskMix').order).toEqual(base.order);
  });

  it('hideWidget / showWidget toggle the hidden set idempotently', () => {
    const hidden = hideWidget(base, 'directory');
    expect(hidden.hidden).toEqual(['directory']);
    expect(visibleWidgets(hidden)).toEqual(['riskMix', 'obligations', 'contractsByStatus']);
    // hiding again is a no-op
    expect(hideWidget(hidden, 'directory').hidden).toEqual(['directory']);

    const shown = showWidget(hidden, 'directory');
    expect(shown.hidden).toEqual([]);
    // showing a visible one is a no-op
    expect(showWidget(base, 'riskMix')).toBe(base);
  });

  it('isAllHidden is true only when no widget is visible', () => {
    expect(isAllHidden(base)).toBe(false);
    const allHidden: DashboardLayout = { order: [...base.order], hidden: [...base.order] };
    expect(isAllHidden(allHidden)).toBe(true);
    expect(visibleWidgets(allHidden)).toEqual([]);
  });

  it('resetLayout returns a fresh default (order restored, everything un-hidden)', () => {
    const scrambled: DashboardLayout = {
      order: ['directory', 'contractsByStatus', 'obligations', 'riskMix'],
      hidden: ['riskMix', 'obligations'],
    };
    const reset = resetLayout();
    expect(reset.order).toEqual([...DEFAULT_WIDGET_ORDER]);
    expect(reset.hidden).toEqual([]);
    expect(isDefaultLayout(reset)).toBe(true);
    // reset does not alias the shared default
    expect(reset.order).not.toBe(DEFAULT_LAYOUT.order);
    expect(isDefaultLayout(scrambled)).toBe(false);
  });
});

describe('localStorage wrappers', () => {
  const KEY = 'sign_project_dashboard_layout:v1:u-1:proj-1';

  beforeEach(() => localStorage.clear());

  it('layoutStorageKey is per-user-and-project with an anon fallback', () => {
    expect(layoutStorageKey('u-9', 'p-2')).toBe('sign_project_dashboard_layout:v1:u-9:p-2');
    expect(layoutStorageKey(null, 'p-2')).toBe('sign_project_dashboard_layout:v1:anon:p-2');
    expect(layoutStorageKey(undefined, 'p-2')).toContain(':anon:');
  });

  it('loadLayout returns default when nothing is stored', () => {
    expect(loadLayout(KEY)).toEqual(DEFAULT_LAYOUT);
  });

  it('loadLayout falls back to default on corrupt JSON (does not throw)', () => {
    localStorage.setItem(KEY, '{ not json ]');
    expect(() => loadLayout(KEY)).not.toThrow();
    expect(loadLayout(KEY)).toEqual(DEFAULT_LAYOUT);
  });

  it('save → load round-trips a customised layout', () => {
    const custom: DashboardLayout = {
      order: ['obligations', 'directory', 'riskMix', 'contractsByStatus'],
      hidden: ['contractsByStatus'],
    };
    saveLayout(KEY, custom);
    const back = loadLayout(KEY);
    expect(back.order).toEqual(custom.order);
    expect(back.hidden).toEqual(custom.hidden);
  });

  it('a stored value with an unknown widget is reconciled on load, not surfaced', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, order: ['directory', 'legacyWidget', 'riskMix'], hidden: ['legacyWidget'] }),
    );
    const back = loadLayout(KEY);
    expect(back.order).not.toContain('legacyWidget');
    expect([...back.order].sort()).toEqual([...DEFAULT_WIDGET_ORDER].sort());
    expect(back.hidden).toEqual([]);
  });
});
