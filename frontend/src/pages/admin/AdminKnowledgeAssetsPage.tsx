import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { knowledgeAssetService } from '@/services/api/knowledgeAssetService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { KnowledgeAsset } from '@/types';

const reviewStatusColors: Record<string, string> = {
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-700',
  UNDER_REVIEW: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  AUTO_APPROVED: 'bg-emerald-100 text-emerald-700',
};

export default function AdminKnowledgeAssetsPage() {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    loadAssets();
  }, [statusFilter]);

  const loadAssets = async () => {
    try {
      const data = await knowledgeAssetService.getAll({
        review_status: statusFilter || undefined,
      });
      setAssets(data);
    } catch (err) {
      console.error('Failed to load assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (id: string, status: string) => {
    try {
      await knowledgeAssetService.review(id, status);
      setAssets(assets.map(a => a.id === id ? { ...a, review_status: status as any } : a));
    } catch (err) {
      console.error('Failed to review asset:', err);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('knowledgeAsset.reviewTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('knowledgeAsset.reviewSubtitle')}</p>
      </div>

      <div className="mb-4 flex space-x-2">
        {['', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              statusFilter === status ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status ? status.replace(/_/g, ' ') : t('common.all')}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">{t('common.title')}</th>
              <th className="px-6 py-3">{t('common.type')}</th>
              <th className="px-6 py-3">{t('common.status')}</th>
              <th className="px-6 py-3">{t('knowledgeAsset.uploadedBy')}</th>
              <th className="px-6 py-3">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {assets.map((asset) => (
              <tr key={asset.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <p className="font-medium text-gray-900">{asset.title}</p>
                  <p className="text-xs text-gray-400">{asset.description || t('common.noDescription')}</p>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{asset.asset_type}</td>
                <td className="px-6 py-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${reviewStatusColors[asset.review_status] || 'bg-gray-100'}`}>
                    {asset.review_status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {asset.creator?.first_name} {asset.creator?.last_name}
                </td>
                <td className="px-6 py-4">
                  {asset.review_status === 'PENDING_REVIEW' && (
                    <div className="flex space-x-2">
                      <button onClick={() => handleReview(asset.id, 'APPROVED')} className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-200">{t('common.approve')}</button>
                      <button onClick={() => handleReview(asset.id, 'REJECTED')} className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200">{t('common.reject')}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {assets.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-500">{t('knowledgeAsset.noAssetsFound')}</div>
        )}
      </div>
    </div>
  );
}
