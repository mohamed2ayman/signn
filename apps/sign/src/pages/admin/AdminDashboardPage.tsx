import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { adminService } from '@/services/api/adminService';
import { knowledgeAssetService } from '@/services/api/knowledgeAssetService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { User, KnowledgeAsset } from '@/types';

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [pendingAssets, setPendingAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminService.getUsers().catch(() => []),
      adminService.getPendingAssets().catch(() => []),
    ]).then(([usersData, assetsData]) => {
      setUsers(usersData);
      setPendingAssets(assetsData);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('admin.dashboard')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('admin.subtitle')}</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('admin.totalUsers')}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{users.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('admin.activeUsers')}</p>
          <p className="mt-1 text-3xl font-bold text-green-600">
            {users.filter(u => u.is_active).length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('admin.pendingReviews')}</p>
          <p className="mt-1 text-3xl font-bold text-yellow-600">{pendingAssets.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('admin.systemStatus')}</p>
          <p className="mt-1 text-lg font-bold text-green-600">✓ {t('admin.healthy')}</p>
        </div>
      </div>

      {/* Pending Reviews */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('admin.pendingKnowledgeAssetReviews')}</h2>
          <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-700">
            {t('admin.pendingCount', { count: pendingAssets.length })}
          </span>
        </div>
        <div className="divide-y divide-gray-100">
          {pendingAssets.slice(0, 5).map((asset) => (
            <div key={asset.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-medium text-gray-900">{asset.title}</p>
                <p className="text-xs text-gray-500">{asset.asset_type} • {asset.creator?.first_name} {asset.creator?.last_name}</p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={async () => {
                    await knowledgeAssetService.review(asset.id, 'APPROVED');
                    setPendingAssets(pendingAssets.filter(a => a.id !== asset.id));
                  }}
                  className="rounded-lg bg-green-100 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-200"
                >
                  {t('common.approve')}
                </button>
                <button
                  onClick={async () => {
                    await knowledgeAssetService.review(asset.id, 'REJECTED');
                    setPendingAssets(pendingAssets.filter(a => a.id !== asset.id));
                  }}
                  className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
                >
                  {t('common.reject')}
                </button>
              </div>
            </div>
          ))}
          {pendingAssets.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-500">{t('admin.noPendingReviews')}</div>
          )}
        </div>
      </div>

      {/* Recent Users */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('admin.recentUsers')}</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">{t('common.name')}</th>
              <th className="px-6 py-3">{t('common.email')}</th>
              <th className="px-6 py-3">{t('common.role')}</th>
              <th className="px-6 py-3">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.slice(0, 10).map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-sm font-medium text-gray-900">
                  {user.first_name} {user.last_name}
                </td>
                <td className="px-6 py-3 text-sm text-gray-500">{user.email}</td>
                <td className="px-6 py-3">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {user.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {user.is_active ? t('common.active') : t('common.inactive')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
