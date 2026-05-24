/**
 * Skeleton placeholders for the obligation list while the React Query
 * fetch is in-flight. Five cards is enough to suggest "list is coming"
 * without dominating the viewport.
 */
export default function ObligationLoadingSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="h-4 w-16 rounded bg-gray-200" />
            <div className="h-4 w-20 rounded bg-gray-200" />
            <div className="h-4 w-14 rounded bg-gray-200" />
          </div>
          <div className="mb-2 h-4 w-3/4 rounded bg-gray-200" />
          <div className="h-3 w-1/2 rounded bg-gray-200" />
          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="h-7 w-20 rounded bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );
}
