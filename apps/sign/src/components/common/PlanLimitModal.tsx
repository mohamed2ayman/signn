import { useNavigate } from 'react-router-dom';

interface PlanLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  limitType: 'projects' | 'users' | 'contracts';
  currentCount: number;
  maxCount: number;
}

const LIMIT_MESSAGES = {
  projects: {
    title: 'Project Limit Reached',
    description: 'You\'ve reached the maximum number of projects for your current plan.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  users: {
    title: 'Team Member Limit Reached',
    description: 'You\'ve reached the maximum number of team members for your current plan.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  contracts: {
    title: 'Contract Limit Reached',
    description: 'You\'ve reached the maximum number of contracts per project for your current plan.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
};

export default function PlanLimitModal({ isOpen, onClose, limitType, currentCount, maxCount }: PlanLimitModalProps) {
  const navigate = useNavigate();
  if (!isOpen) return null;

  const info = LIMIT_MESSAGES[limitType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-navy-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-sm p-6 m-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
          {info.icon}
        </div>

        <h2 className="text-lg font-bold text-navy-900 mb-2">{info.title}</h2>
        <p className="text-sm text-gray-500 mb-4">{info.description}</p>

        {/* Usage bar */}
        <div className="bg-gray-100 rounded-full h-2 mb-2 overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${Math.min(100, (currentCount / maxCount) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mb-6">
          {currentCount} / {maxCount} used
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => { onClose(); navigate('/app/settings/billing'); }}
            className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors"
          >
            Upgrade Plan
          </button>
        </div>
      </div>
    </div>
  );
}
