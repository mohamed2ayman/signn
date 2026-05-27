import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { adminService, type WaitlistEntry } from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const PRODUCTS = ['VENDRIX', 'SPANTEC', 'CLAIMX', 'GUARDIA', 'DOXEN'] as const;

function toCsv(rows: WaitlistEntry[]): string {
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const headers = ['Product', 'Email', 'Signed Up'];
  const lines = rows.map((r) => [
    r.product_name,
    r.email,
    r.created_at,
  ].map(escape).join(','));
  return [headers.map(escape).join(','), ...lines].join('\n');
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminWaitlistPage() {
  const { t } = useTranslation();
  const [productFilter, setProductFilter] = useState<string>('');
  const [exporting, setExporting] = useState(false);

  const { data: entries = [], isLoading, isError } = useQuery<WaitlistEntry[]>({
    queryKey: ['admin', 'waitlist', productFilter],
    queryFn: () => adminService.getWaitlist(productFilter || undefined),
  });

  async function handleExport() {
    setExporting(true);
    try {
      const rows = await adminService.exportWaitlist(productFilter || undefined);
      const ts = format(new Date(), 'yyyyMMdd');
      downloadCsv(toCsv(rows), `managex-waitlist-${ts}.csv`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('admin.waitlist.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('admin.waitlist.subtitle')}</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || entries.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {exporting ? t('admin.waitlist.exporting') : t('admin.waitlist.export')}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">{t('admin.waitlist.filter.all')}</option>
          {PRODUCTS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {entries.length > 0 && (
          <span className="text-sm text-gray-500">
            {t('admin.waitlist.total', { count: entries.length })}
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          Failed to load waitlist entries.
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <svg className="mx-auto mb-3 h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          <p className="text-sm text-gray-400">{t('admin.waitlist.empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto w-full rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('admin.waitlist.columns.product')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('admin.waitlist.columns.email')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('admin.waitlist.columns.signedUp')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <ProductBadge name={entry.product_name} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{entry.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {format(new Date(entry.created_at), 'dd MMM yyyy, HH:mm')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Product badge ────────────────────────────────────────────────────────────

const PRODUCT_COLORS: Record<string, { bg: string; text: string }> = {
  VENDRIX:  { bg: 'bg-orange-100', text: 'text-orange-700' },
  SPANTEC:  { bg: 'bg-sky-100',    text: 'text-sky-700' },
  CLAIMX:   { bg: 'bg-purple-100', text: 'text-purple-700' },
  GUARDIA:  { bg: 'bg-green-100',  text: 'text-green-700' },
  DOXEN:    { bg: 'bg-yellow-100', text: 'text-yellow-700' },
};

function ProductBadge({ name }: { name: string }) {
  const c = PRODUCT_COLORS[name] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.bg} ${c.text}`}>
      {name}
    </span>
  );
}
