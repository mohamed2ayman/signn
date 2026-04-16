export default function AdminStoreAnalyticsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Store Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Referral and download analytics for the Contract Store.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100">
          <span className="text-2xl">📊</span>
        </div>
        <h2 className="text-base font-semibold text-gray-700">Coming Soon</h2>
        <p className="mt-2 text-sm text-gray-400">
          Store analytics will be available in a future release. This will include download counts,
          referral sources, and conversion metrics for Contract Store templates.
        </p>
      </div>
    </div>
  );
}
