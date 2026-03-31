import { useState, useEffect } from 'react';
import { knowledgeAssetService } from '@/services/api/knowledgeAssetService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { KnowledgeAsset } from '@/types';

const assetTypeLabels: Record<string, { label: string; color: string }> = {
  LAW: { label: 'Law', color: 'bg-indigo-50 text-indigo-700' },
  INTERNATIONAL_STANDARD: { label: 'Intl Standard', color: 'bg-purple-50 text-purple-700' },
  ORGANIZATION_POLICY: { label: 'Org Policy', color: 'bg-blue-50 text-blue-700' },
  CONTRACT_TEMPLATE: { label: 'Template', color: 'bg-teal-50 text-teal-700' },
  KNOWLEDGE: { label: 'Knowledge', color: 'bg-gray-100 text-gray-700' },
};

const reviewStatusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  PENDING_REVIEW: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  UNDER_REVIEW: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  REJECTED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  AUTO_APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
};

const embeddingIcons: Record<string, { color: string; label: string }> = {
  COMPLETED: { color: 'text-emerald-500', label: 'Indexed' },
  PENDING: { color: 'text-amber-500', label: 'Pending' },
  PROCESSING: { color: 'text-blue-500', label: 'Processing' },
  FAILED: { color: 'text-red-500', label: 'Failed' },
};

export default function KnowledgeAssetsPage() {
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    asset_type: 'LAW' as string,
    jurisdiction: '',
    tags: '',
    include_in_risk_analysis: false,
    include_in_citations: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    loadAssets();
  }, [search, typeFilter]);

  const loadAssets = async () => {
    try {
      const data = await knowledgeAssetService.getAll({
        search: search || undefined,
        asset_type: typeFilter || undefined,
      });
      setAssets(data);
    } catch (err) {
      console.error('Failed to load assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('title', formData.title);
      fd.append('description', formData.description);
      fd.append('asset_type', formData.asset_type);
      if (formData.jurisdiction) fd.append('jurisdiction', formData.jurisdiction);
      if (formData.tags) fd.append('tags', JSON.stringify(formData.tags.split(',').map((t) => t.trim())));
      fd.append('include_in_risk_analysis', String(formData.include_in_risk_analysis));
      fd.append('include_in_citations', String(formData.include_in_citations));
      if (file) fd.append('file', file);

      const asset = await knowledgeAssetService.create(fd);
      setAssets([asset, ...assets]);
      setShowUploadModal(false);
      setFormData({ title: '', description: '', asset_type: 'LAW', jurisdiction: '', tags: '', include_in_risk_analysis: false, include_in_citations: false });
      setFile(null);
      setUploadError('');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setUploadError(error.response?.data?.message || 'Failed to upload asset. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const stats = {
    total: assets.length,
    approved: assets.filter(a => a.review_status === 'APPROVED' || a.review_status === 'AUTO_APPROVED').length,
    pending: assets.filter(a => a.review_status === 'PENDING_REVIEW' || a.review_status === 'UNDER_REVIEW').length,
    indexed: assets.filter(a => a.embedding_status === 'COMPLETED').length,
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="mt-1 text-sm text-gray-500">Laws, standards, and policies used for AI-powered analysis</p>
        </div>
        <button
          onClick={() => { setShowUploadModal(true); setUploadError(''); }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Upload Asset
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Assets', value: stats.total, color: 'text-gray-900' },
          { label: 'Approved', value: stats.approved, color: 'text-emerald-600' },
          { label: 'Pending Review', value: stats.pending, color: 'text-amber-600' },
          { label: 'AI Indexed', value: stats.indexed, color: 'text-blue-600' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-gray-200/80 bg-white px-4 py-3 shadow-card">
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="mt-0.5 text-xs text-gray-400">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets by title or description..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <svg className="absolute left-3 top-2.5 h-4.5 w-4.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All types</option>
          {Object.entries(assetTypeLabels).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Assets Table */}
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left">
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Type</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">AI Index</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {assets.map((asset) => {
              const typeInfo = assetTypeLabels[asset.asset_type] || { label: asset.asset_type, color: 'bg-gray-100 text-gray-700' };
              const statusInfo = reviewStatusConfig[asset.review_status] || reviewStatusConfig.PENDING_REVIEW;
              const embedInfo = embeddingIcons[asset.embedding_status] || { color: 'text-gray-400', label: asset.embedding_status };
              return (
                <tr key={asset.id} className="transition-colors hover:bg-gray-50/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50">
                        <svg className="h-4.5 w-4.5 text-navy-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{asset.title}</p>
                        <p className="mt-0.5 text-xs text-gray-400 line-clamp-1 max-w-xs">
                          {asset.description || 'No description'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.bg} ${statusInfo.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} />
                      {asset.review_status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${embedInfo.color}`}>
                      {asset.embedding_status === 'COMPLETED' ? (
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      {embedInfo.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">
                    {new Date(asset.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {assets.length === 0 && (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gray-50">
              <svg className="h-6 w-6 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-gray-500">No knowledge assets</p>
            <p className="mt-1 text-xs text-gray-400">Upload laws, standards, or policies to power AI analysis</p>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200/50 bg-white shadow-elevated">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Upload Knowledge Asset</h2>
                <p className="mt-0.5 text-sm text-gray-400">Add a new document to the knowledge base</p>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4 p-6">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. UAE Construction Law No. 24"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  rows={3}
                  placeholder="Brief description of this asset..."
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Asset Type *</label>
                <select
                  value={formData.asset_type}
                  onChange={(e) => setFormData({ ...formData, asset_type: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {Object.entries(assetTypeLabels).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Jurisdiction</label>
                  <input
                    type="text"
                    value={formData.jurisdiction}
                    onChange={(e) => setFormData({ ...formData, jurisdiction: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. UAE, UK"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Tags</label>
                  <input
                    type="text"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="tag1, tag2"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Document</label>
                <div className="rounded-lg border-2 border-dashed border-gray-200 p-4 text-center transition-colors hover:border-gray-300">
                  <input
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="file-upload"
                    accept=".pdf,.docx,.doc,.txt"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    {file ? (
                      <p className="mt-2 text-sm font-medium text-primary">{file.name}</p>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500">
                        Click to upload · <span className="text-xs text-gray-400">PDF, DOCX, TXT</span>
                      </p>
                    )}
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.include_in_risk_analysis}
                    onChange={(e) => setFormData({ ...formData, include_in_risk_analysis: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/20"
                  />
                  Use in Risk Analysis
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.include_in_citations}
                    onChange={(e) => setFormData({ ...formData, include_in_citations: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/20"
                  />
                  Use for Citations
                </label>
              </div>
              {uploadError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{uploadError}</div>
              )}
              <div className="flex justify-end gap-2.5 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-50"
                >
                  {uploading && <LoadingSpinner size="sm" />}
                  Upload
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
