import { useTranslation } from 'react-i18next';

export default function ContractorDashboardPage() {
  const { t } = useTranslation();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('contractorPortal.dashboard')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('contractorPortal.subtitle')}</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('contractorPortal.pendingContracts')}</p>
          <p className="mt-1 text-3xl font-bold text-yellow-600">0</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('contractorPortal.activeContracts')}</p>
          <p className="mt-1 text-3xl font-bold text-primary">0</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('contractorPortal.completedContracts')}</p>
          <p className="mt-1 text-3xl font-bold text-green-600">0</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('contractorPortal.assignedContracts')}</h2>
        </div>
        <div className="px-6 py-12 text-center text-sm text-gray-500">
          {t('contractorPortal.noContracts')}
        </div>
      </div>
    </div>
  );
}
