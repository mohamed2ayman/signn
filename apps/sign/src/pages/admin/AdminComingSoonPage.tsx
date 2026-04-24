/**
 * Placeholder shown at admin routes whose pages have not been built yet.
 * Matches the header/padding style of AdminDashboardPage so the top-nav
 * layout looks consistent while routes stub in during Phase 3+.
 */
interface AdminComingSoonPageProps {
  title: string;
}

export default function AdminComingSoonPage({ title }: AdminComingSoonPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="mt-1 text-sm text-gray-500">
          This section is under active development
        </p>
      </div>

      <div className="rounded-xl border border-gray-200/70 bg-white p-10 shadow-sm">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary-600">
            <svg
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Coming Soon</h2>
          <p className="mt-2 text-sm text-gray-500">
            This page will be available in the next release.
          </p>
        </div>
      </div>
    </div>
  );
}
