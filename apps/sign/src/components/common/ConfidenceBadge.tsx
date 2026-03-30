interface ConfidenceBadgeProps {
  score: number;
}

export default function ConfidenceBadge({ score }: ConfidenceBadgeProps) {
  const percentage = Math.round(score * 100);

  let colorClass: string;
  if (score >= 0.85) {
    colorClass = 'bg-green-100 text-green-700';
  } else if (score >= 0.6) {
    colorClass = 'bg-yellow-100 text-yellow-700';
  } else {
    colorClass = 'bg-red-100 text-red-700';
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
      title={`AI confidence: ${percentage}%`}
    >
      {percentage}%
    </span>
  );
}
