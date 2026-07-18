/**
 * Contract status pill — a rounded pill with a leading 6px dot, colored by
 * contract status. Promoted VERBATIM from the private in-file helper in
 * ProjectDetailPage.tsx (7.20 Contracts tab) when "Shared with me" (#8b)
 * became its second consumer — behavior is byte-identical: same color map,
 * same DRAFT fallback for unknown statuses, same underscores→spaces label.
 */
const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  DRAFT: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' },
  PENDING_APPROVAL: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ACTIVE: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  TERMINATED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  CHANGES_REQUESTED: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
};

export default function ContractStatusDot({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}
