import { useEffect, useRef, useState } from 'react';

// Chart.js is loaded lazily from CDN (NOT a bundled dependency) — this matches
// the established codebase convention (AdminAnalyticsPage). No new npm dep.

declare global {
  interface Window {
    Chart?: any;
    __chartJsLoading?: Promise<void>;
  }
}

// Chart.js 4.5.0 (NOT 4.4.0): 4.4.0 miscomputes the bar base on a horizontal
// bar with a reversed value axis (scales.x.reverse) — RTL bars render as tiny
// stubs at the wrong end. 4.5.0 fixes it (verified in the Step-1 RTL harness).
// Note: AdminAnalyticsPage has its own loader still on 4.4.0; that's fine — it's
// SYSTEM_ADMIN-only and this page is OWNER_ADMIN-only, so no single session
// loads both (they share window.Chart). Align AdminAnalytics to 4.5.0 separately.
const CHART_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js';

export function loadChartJs(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.Chart) return Promise.resolve();
  if (window.__chartJsLoading) return window.__chartJsLoading;
  window.__chartJsLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-chartjs="1"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Chart.js failed to load')),
      );
      return;
    }
    const s = document.createElement('script');
    s.src = CHART_CDN;
    s.async = true;
    s.dataset.chartjs = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Chart.js failed to load'));
    document.head.appendChild(s);
  });
  return window.__chartJsLoading;
}

// Palette aligned with SIGN's status-badge + risk colors.
export const PORTFOLIO_CHART_COLORS = {
  draft: '#9ca3af',
  inApproval: '#f59e0b',
  withCounterparty: '#8b5cf6',
  active: '#3b82f6',
  completed: '#10b981',
  terminated: '#ef4444',
  riskLow: '#10b981',
  riskMedium: '#f59e0b',
  riskHigh: '#ef4444',
  primary: '#4F6EF7',
};

/**
 * Merge RTL-aware CHROME into a Chart.js config.
 *
 * Chart.js does NOT follow the page's dir="rtl" automatically — legend/tooltip
 * text direction and the number locale must be set explicitly. This helper
 * handles ONLY the chrome that is common to every geometry (legend rtl +
 * textDirection, tooltip rtl + textDirection, locale).
 *
 * Axis DIRECTION (scale.reverse) and category-label SIDE (scale.position) are
 * geometry-specific RTL failure modes and are handled by each chart component,
 * NOT here — a pie has no axes, a horizontal bar flips its value axis, a time
 * line reverses its x axis. That is exactly why Step 1 builds one chart of each
 * geometry rather than assuming a single wrapper normalizes them all.
 */
export function withRtlChrome(config: any, rtl: boolean): any {
  const plugins = config.options?.plugins ?? {};
  return {
    ...config,
    options: {
      ...config.options,
      // Dashboard charts don't animate. Beyond being a sensible default, the
      // grow animation races badly with a reversed value axis on the
      // horizontal bar (bars get caught mid-grow at the wrong anchor under
      // React re-mounts) — disabling it makes the reversed RTL bar render its
      // final geometry deterministically. Verified in the Step-1 RTL harness.
      animation: false as const,
      locale: rtl ? 'ar' : 'en',
      plugins: {
        ...plugins,
        legend: {
          ...(plugins.legend ?? {}),
          rtl,
          textDirection: rtl ? 'rtl' : 'ltr',
        },
        tooltip: {
          ...(plugins.tooltip ?? {}),
          rtl,
          textDirection: rtl ? 'rtl' : 'ltr',
        },
      },
    },
  };
}

export function ChartBlock({
  config,
  height = 220,
}: {
  config: any;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<any>(null);
  const [ready, setReady] = useState<boolean>(Boolean(window.Chart));

  useEffect(() => {
    let cancelled = false;
    loadChartJs()
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setReady(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !canvasRef.current || !window.Chart) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    chartRef.current = new window.Chart(ctx, config);
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [ready, config]);

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
