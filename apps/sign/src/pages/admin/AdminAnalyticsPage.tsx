import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  adminService,
  AnalyticsPeriod,
  AnalyticsTab,
  ContractsAnalytics,
  KnowledgeAnalytics,
  OverviewAnalytics,
  PerformanceAnalytics,
  SubscriptionsAnalytics,
  UsersAnalytics,
} from '@/services/api/adminService';

// Chart.js loaded lazily from CDN (not a package dep).
declare global {
  interface Window {
    Chart?: any;
    __chartJsLoading?: Promise<void>;
  }
}

const CHART_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';

function loadChartJs(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.Chart) return Promise.resolve();
  if (window.__chartJsLoading) return window.__chartJsLoading;
  window.__chartJsLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-chartjs="1"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Chart.js failed to load')));
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

// ─── Shared tokens ─────────────────────────────────────────────────────────
const COLORS = {
  primary: '#3b82f6',
  secondary: '#8b5cf6',
  tertiary: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  gray: '#6b7280',
};

const PLAN_PILL_COLORS = [
  { bg: '#dbeafe', fg: '#1e40af' }, // blue
  { bg: '#ede9fe', fg: '#6d28d9' }, // purple
  { bg: '#d1fae5', fg: '#047857' }, // green
  { bg: '#fef3c7', fg: '#b45309' }, // amber
  { bg: '#fee2e2', fg: '#b91c1c' }, // red
];

const TABS: Array<{ id: AnalyticsTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'users', label: 'Users' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'knowledge', label: 'Knowledge Assets' },
  { id: 'performance', label: 'Performance' },
];

const PERIOD_OPTIONS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '365d', label: 'Last year' },
];

// ─── CSV helpers ───────────────────────────────────────────────────────────
function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const escape = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(','), ...rows.map((r) => r.map(escape).join(','))];
  return lines.join('\n');
}

function downloadCsv(tab: AnalyticsTab, csv: string) {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sign-analytics-${tab}-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildCsvForTab(tab: AnalyticsTab, data: any): string {
  switch (tab) {
    case 'overview': {
      const d = data as OverviewAnalytics;
      const lines: string[] = [];
      lines.push(toCsv(['Metric', 'Value'], [
        ['Total Revenue', d.totalRevenue],
        ['Revenue Change %', d.revenueChange],
        ['Active Users', d.activeUsers],
        ['Users Change %', d.usersChange],
        ['Total Contracts', d.totalContracts],
        ['Contracts Change %', d.contractsChange],
        ['System Uptime %', d.systemUptime],
      ]));
      if (d.topPerformingPlans.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Plan', 'Subscribers', 'Revenue'],
            d.topPerformingPlans.map((p) => [p.name, p.subscribers, p.revenue]),
          ),
        );
      }
      return lines.join('\n');
    }
    case 'subscriptions': {
      const d = data as SubscriptionsAnalytics;
      const lines: string[] = [];
      lines.push(toCsv(['Metric', 'Value'], [
        ['MRR', d.mrr],
        ['ARR', d.arr],
        ['MRR Change %', d.mrrChange],
        ['Churn Rate %', d.churnRate],
        ['Upgrade Rate %', d.upgradeRate],
        ['Annual Subs', d.annualVsMonthly.annual],
        ['Monthly Subs', d.annualVsMonthly.monthly],
      ]));
      if (d.planBreakdown.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Plan', 'Subscribers', 'Revenue', 'Percentage'],
            d.planBreakdown.map((p) => [
              p.planName,
              p.subscribers,
              p.revenue,
              p.percentage,
            ]),
          ),
        );
      }
      return lines.join('\n');
    }
    case 'users': {
      const d = data as UsersAnalytics;
      const lines: string[] = [];
      lines.push(toCsv(['Metric', 'Value'], [
        ['Total Users', d.totalUsers],
        ['New Users This Period', d.newUsersThisPeriod],
        ['MFA Adoption %', d.mfaAdoptionRate],
        ['Invitation Acceptance %', d.invitationAcceptanceRate],
      ]));
      if (d.byRole.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Role', 'Count', 'Percentage'],
            d.byRole.map((r) => [r.role, r.count, r.percentage]),
          ),
        );
      }
      if (d.newUserTimeSeries.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Date', 'New Users'],
            d.newUserTimeSeries.map((p) => [p.date, p.count]),
          ),
        );
      }
      return lines.join('\n');
    }
    case 'contracts': {
      const d = data as ContractsAnalytics;
      const lines: string[] = [];
      lines.push(toCsv(['Metric', 'Value'], [
        ['Total Contracts', d.totalContracts],
        ['Contracts This Period', d.contractsThisPeriod],
        ['Avg Time To Sign (days)', d.avgTimeToSign ?? ''],
        ['DocuSign Adoption %', d.docuSignAdoptionRate],
      ]));
      if (d.byStatus.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Status', 'Count'],
            d.byStatus.map((s) => [s.status, s.count]),
          ),
        );
      }
      if (d.byType.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Type', 'Count'],
            d.byType.map((t) => [t.type, t.count]),
          ),
        );
      }
      if (d.contractTimeSeries.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Date', 'Contracts'],
            d.contractTimeSeries.map((p) => [p.date, p.count]),
          ),
        );
      }
      return lines.join('\n');
    }
    case 'knowledge': {
      const d = data as KnowledgeAnalytics;
      const lines: string[] = [];
      lines.push(toCsv(['Metric', 'Value'], [
        ['Total Assets', d.totalAssets],
        ['Pending Review', d.pendingReview],
        ['Indexing Success %', d.indexingSuccessRate],
      ]));
      if (d.byType.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Type', 'Count'],
            d.byType.map((t) => [t.type, t.count]),
          ),
        );
      }
      if (d.byJurisdiction.length) {
        lines.push('');
        lines.push(
          toCsv(
            ['Jurisdiction', 'Count'],
            d.byJurisdiction.map((j) => [j.jurisdiction, j.count]),
          ),
        );
      }
      return lines.join('\n');
    }
    case 'performance': {
      const d = data as PerformanceAnalytics;
      return toCsv(['Metric', 'Value'], [
        ['API Response Time p95 (ms)', d.apiResponseTimeP95],
        ['Error Rate %', d.errorRate],
        ['Active WS Sessions', d.activeWebSocketSessions],
        ['Email Queue Depth', d.bullQueueDepths.emailQueue],
        ['AI Queue Depth', d.bullQueueDepths.aiQueue],
        ['Storage Used %', d.storageUsedPercent],
        ['AI Backend Latency (ms)', d.aiBackendLatency],
      ]);
    }
    default:
      return '';
  }
}

// ─── Formatting helpers ────────────────────────────────────────────────────
const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const numberFmt = new Intl.NumberFormat('en-US');
const formatChange = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

// ─── KPI card ──────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  change,
  subtitle,
}: {
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
}) {
  const positive = (change ?? 0) >= 0;
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#111827' }}>{value}</div>
      {change !== undefined && (
        <div
          style={{
            fontSize: 13,
            color: positive ? '#047857' : '#b91c1c',
            marginTop: 6,
            fontWeight: 500,
          }}
        >
          {formatChange(change)}
        </div>
      )}
      {subtitle && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>{subtitle}</div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          height: 12,
          width: '40%',
          background: '#f3f4f6',
          borderRadius: 4,
          marginBottom: 12,
        }}
      />
      <div style={{ height: 28, width: '60%', background: '#f3f4f6', borderRadius: 4 }} />
      <div
        style={{
          height: 10,
          width: '30%',
          background: '#f3f4f6',
          borderRadius: 4,
          marginTop: 10,
        }}
      />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Chart helper ──────────────────────────────────────────────────────────
function ChartBlock({
  config,
  height = 200,
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
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
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

// ─── Tab contents ──────────────────────────────────────────────────────────
function OverviewTab({ data }: { data: OverviewAnalytics }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <KpiCard
          label="Total Revenue"
          value={currencyFmt.format(data.totalRevenue)}
          change={data.revenueChange}
        />
        <KpiCard
          label="Active Users"
          value={numberFmt.format(data.activeUsers)}
          change={data.usersChange}
        />
        <KpiCard
          label="Total Contracts"
          value={numberFmt.format(data.totalContracts)}
          change={data.contractsChange}
        />
        <KpiCard
          label="System Uptime"
          value={`${data.systemUptime.toFixed(1)}%`}
          subtitle="Last 30 days"
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Panel title="Top Performing Plans">
          {data.topPerformingPlans.length === 0 ? (
            <div style={{ fontSize: 14, color: '#9ca3af' }}>No active plans yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.topPerformingPlans.map((plan, i) => {
                const c = PLAN_PILL_COLORS[i % PLAN_PILL_COLORS.length];
                return (
                  <div
                    key={plan.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: '#f9fafb',
                      borderRadius: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>
                        {plan.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {numberFmt.format(plan.subscribers)} subscribers
                      </div>
                    </div>
                    <span
                      style={{
                        background: c.bg,
                        color: c.fg,
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {currencyFmt.format(plan.revenue)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Knowledge Asset Usage">
          {data.knowledgeAssetUsage.length === 0 ? (
            <div style={{ fontSize: 14, color: '#9ca3af' }}>
              No usage data tracked yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.knowledgeAssetUsage.map((a) => (
                <div
                  key={a.title}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: '#f9fafb',
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>
                      {a.title}
                    </div>
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: 4,
                        background: '#eef2ff',
                        color: '#4338ca',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                      }}
                    >
                      {a.category}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: '#111827', fontWeight: 600 }}>
                    {numberFmt.format(a.uses)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function SubscriptionsTab({ data }: { data: SubscriptionsAnalytics }) {
  const chartConfig = useMemo(
    () => ({
      type: 'bar',
      data: {
        labels: data.planBreakdown.map((p) => p.planName),
        datasets: [
          {
            label: 'Revenue',
            data: data.planBreakdown.map((p) => p.revenue),
            backgroundColor: COLORS.primary,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    }),
    [data.planBreakdown],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <KpiCard label="MRR" value={currencyFmt.format(data.mrr)} change={data.mrrChange} />
        <KpiCard label="ARR" value={currencyFmt.format(data.arr)} />
        <KpiCard label="Churn Rate" value={`${data.churnRate.toFixed(1)}%`} />
      </div>

      <Panel title="Revenue by plan">
        {data.planBreakdown.length === 0 ? (
          <div style={{ fontSize: 14, color: '#9ca3af' }}>No active subscriptions.</div>
        ) : (
          <ChartBlock config={chartConfig} />
        )}
      </Panel>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Panel title="Annual vs Monthly billing">
          <div style={{ fontSize: 14, color: '#374151' }}>
            <div style={{ marginBottom: 6 }}>
              Annual: <b>{numberFmt.format(data.annualVsMonthly.annual)}</b>
            </div>
            <div>
              Monthly: <b>{numberFmt.format(data.annualVsMonthly.monthly)}</b>
            </div>
          </div>
        </Panel>
        <Panel title="Upgrade rate">
          <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
            {data.upgradeRate.toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>this period</div>
        </Panel>
      </div>
    </div>
  );
}

function UsersTab({ data }: { data: UsersAnalytics }) {
  const donutConfig = useMemo(
    () => ({
      type: 'doughnut',
      data: {
        labels: data.byRole.map((r) => r.role),
        datasets: [
          {
            data: data.byRole.map((r) => r.count),
            backgroundColor: [
              COLORS.primary,
              COLORS.secondary,
              COLORS.tertiary,
              COLORS.warning,
              COLORS.danger,
              COLORS.gray,
              '#14b8a6',
              '#ec4899',
              '#f97316',
            ],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } },
        cutout: '60%',
      },
    }),
    [data.byRole],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <KpiCard label="Total Users" value={numberFmt.format(data.totalUsers)} />
        <KpiCard
          label="New This Period"
          value={numberFmt.format(data.newUsersThisPeriod)}
        />
        <KpiCard
          label="MFA Adoption Rate"
          value={`${data.mfaAdoptionRate.toFixed(1)}%`}
        />
      </div>

      <Panel title="Users by role">
        {data.byRole.length === 0 ? (
          <div style={{ fontSize: 14, color: '#9ca3af' }}>No users yet.</div>
        ) : (
          <ChartBlock config={donutConfig} height={240} />
        )}
      </Panel>

      <Panel title="Invitation acceptance rate">
        <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
          {data.invitationAcceptanceRate.toFixed(1)}%
        </div>
      </Panel>
    </div>
  );
}

function ContractsTab({ data }: { data: ContractsAnalytics }) {
  const statusChart = useMemo(
    () => ({
      type: 'bar',
      data: {
        labels: data.byStatus.map((s) => s.status),
        datasets: [
          {
            label: 'Contracts',
            data: data.byStatus.map((s) => s.count),
            backgroundColor: COLORS.primary,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    }),
    [data.byStatus],
  );

  const typeChart = useMemo(
    () => ({
      type: 'bar',
      data: {
        labels: data.byType.map((t) => t.type),
        datasets: [
          {
            label: 'Contracts',
            data: data.byType.map((t) => t.count),
            backgroundColor: COLORS.secondary,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    }),
    [data.byType],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <KpiCard label="Total Contracts" value={numberFmt.format(data.totalContracts)} />
        <KpiCard
          label="This Period"
          value={numberFmt.format(data.contractsThisPeriod)}
        />
        <KpiCard
          label="Avg Time to Sign"
          value={data.avgTimeToSign !== null ? `${data.avgTimeToSign} d` : '—'}
        />
      </div>

      <Panel title="Contracts by status">
        {data.byStatus.length === 0 ? (
          <div style={{ fontSize: 14, color: '#9ca3af' }}>No contracts yet.</div>
        ) : (
          <ChartBlock config={statusChart} />
        )}
      </Panel>

      <Panel title="Contracts by type">
        {data.byType.length === 0 ? (
          <div style={{ fontSize: 14, color: '#9ca3af' }}>No contracts yet.</div>
        ) : (
          <ChartBlock config={typeChart} />
        )}
      </Panel>

      <Panel title="DocuSign adoption rate">
        <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
          {data.docuSignAdoptionRate.toFixed(1)}%
        </div>
      </Panel>
    </div>
  );
}

function KnowledgeTab({ data }: { data: KnowledgeAnalytics }) {
  const chart = useMemo(
    () => ({
      type: 'bar',
      data: {
        labels: data.byJurisdiction.map((j) => j.jurisdiction),
        datasets: [
          {
            label: 'Assets',
            data: data.byJurisdiction.map((j) => j.count),
            backgroundColor: COLORS.tertiary,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    }),
    [data.byJurisdiction],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <KpiCard label="Total Assets" value={numberFmt.format(data.totalAssets)} />
        <KpiCard label="Pending Review" value={numberFmt.format(data.pendingReview)} />
        <KpiCard
          label="Indexing Success Rate"
          value={`${data.indexingSuccessRate.toFixed(1)}%`}
        />
      </div>

      <Panel title="Assets by jurisdiction">
        {data.byJurisdiction.length === 0 ? (
          <div style={{ fontSize: 14, color: '#9ca3af' }}>No assets yet.</div>
        ) : (
          <ChartBlock config={chart} />
        )}
      </Panel>

      <Panel title="Top used assets">
        {data.topUsedAssets.length === 0 ? (
          <div style={{ fontSize: 14, color: '#9ca3af' }}>
            Asset usage tracking not enabled yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.topUsedAssets.map((a) => (
              <div
                key={a.title}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: '#f9fafb',
                  borderRadius: 8,
                  fontSize: 14,
                }}
              >
                <span>{a.title}</span>
                <span style={{ fontWeight: 600 }}>{numberFmt.format(a.uses)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function PerformanceTab({ data }: { data: PerformanceAnalytics }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <KpiCard
          label="API Response Time (p95)"
          value={`${numberFmt.format(data.apiResponseTimeP95)} ms`}
        />
        <KpiCard label="Error Rate" value={`${data.errorRate.toFixed(2)}%`} />
        <KpiCard
          label="Active WS Sessions"
          value={numberFmt.format(data.activeWebSocketSessions)}
        />
        <KpiCard
          label="AI Backend Latency"
          value={`${numberFmt.format(data.aiBackendLatency)} ms`}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Panel title="Email queue depth">
          <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
            {numberFmt.format(data.bullQueueDepths.emailQueue)}
          </div>
        </Panel>
        <Panel title="AI queue depth">
          <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
            {numberFmt.format(data.bullQueueDepths.aiQueue)}
          </div>
        </Panel>
      </div>

      <Panel title="Storage used">
        <div
          style={{
            height: 14,
            background: '#f3f4f6',
            borderRadius: 999,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, data.storageUsedPercent))}%`,
              height: '100%',
              background: COLORS.primary,
            }}
          />
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
          {data.storageUsedPercent.toFixed(1)}% used
        </div>
      </Panel>
    </div>
  );
}

// ─── Page shell ────────────────────────────────────────────────────────────
export default function AdminAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [selectedPeriod, setSelectedPeriod] = useState<AnalyticsPeriod>('30d');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics', activeTab, selectedPeriod],
    queryFn: () => adminService.getAnalytics(activeTab, selectedPeriod),
    retry: 1,
  });

  const handleExport = () => {
    if (!data) {
      toast.error('No data to export yet');
      return;
    }
    const csv = buildCsvForTab(activeTab, data);
    if (!csv) {
      toast.error('Nothing to export for this tab');
      return;
    }
    downloadCsv(activeTab, csv);
    toast.success('Report downloaded');
  };

  const renderBody = () => {
    if (isLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      );
    }
    if (isError || !data) {
      return (
        <div
          style={{
            background: '#fff',
            border: '1px solid #fca5a5',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 14, color: '#b91c1c', marginBottom: 12 }}>
            Failed to load analytics for this tab.
          </div>
          <button
            onClick={() => refetch()}
            style={{
              background: COLORS.primary,
              color: '#fff',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    switch (activeTab) {
      case 'overview':
        return <OverviewTab data={data as OverviewAnalytics} />;
      case 'subscriptions':
        return <SubscriptionsTab data={data as SubscriptionsAnalytics} />;
      case 'users':
        return <UsersTab data={data as UsersAnalytics} />;
      case 'contracts':
        return <ContractsTab data={data as ContractsAnalytics} />;
      case 'knowledge':
        return <KnowledgeTab data={data as KnowledgeAnalytics} />;
      case 'performance':
        return <PerformanceTab data={data as PerformanceAnalytics} />;
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>
            System Analytics Dashboard
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: '6px 0 0' }}>
            Comprehensive system usage and performance analytics
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value as AnalyticsPeriod)}
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: '#111827',
              cursor: 'pointer',
            }}
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleExport}
            style={{
              background: '#fff',
              border: `1px solid ${COLORS.primary}`,
              color: COLORS.primary,
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Export Reports
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: 6,
          background: '#f3f4f6',
          borderRadius: 999,
          width: 'fit-content',
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        {TABS.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                background: active ? '#fff' : 'transparent',
                color: active ? '#111827' : '#6b7280',
                border: 'none',
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : undefined,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {renderBody()}
    </div>
  );
}
