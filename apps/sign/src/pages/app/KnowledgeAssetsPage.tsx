import { useState, useEffect } from 'react';
import { knowledgeAssetService } from '@/services/api/knowledgeAssetService';
import { projectService } from '@/services/api/projectService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { KnowledgeAsset, Project } from '@/types';

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

// Common MENA + UK jurisdictions used in construction contracts.
// Free-text entries in the DB are supported too — they won't appear in the
// dropdown but can still be passed via the API.
const JURISDICTIONS = [
  { code: 'EG', label: 'Egypt (EG)' },
  { code: 'AE', label: 'UAE (AE)' },
  { code: 'SA', label: 'Saudi Arabia (SA)' },
  { code: 'KW', label: 'Kuwait (KW)' },
  { code: 'QA', label: 'Qatar (QA)' },
  { code: 'BH', label: 'Bahrain (BH)' },
  { code: 'OM', label: 'Oman (OM)' },
  { code: 'JO', label: 'Jordan (JO)' },
  { code: 'UK', label: 'United Kingdom (UK)' },
];

export default function KnowledgeAssetsPage() {
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [jurisdictionFilter, setJurisdictionFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState(''); // Phase 7.24e
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  // Phase 7.24e — projects list for the filter dropdown + upload scope selector
  const [projects, setProjects] = useState<Project[]>([]);
  // Expandable details rows — "Used In" + "Version History" tabs
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'usedIn' | 'versions'>('usedIn');
  const [usages, setUsages] = useState<Array<{ context_type: string; context_id: string; used_at: string }>>([]);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [versions, setVersions] = useState<Array<{
    id: string;
    version_number: number;
    changed_by: string | null;
    changer_name: string | null;
    change_summary: string | null;
    created_at: string;
  }>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [snapshotModal, setSnapshotModal] = useState<{
    versionNumber: number;
    data: Record<string, unknown>;
    created_at: string;
  } | null>(null);
  const [snapshotLoadingVersion, setSnapshotLoadingVersion] = useState<number | null>(null);
  // ─── Bulk upload state ────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    description: '',
    asset_type: 'LAW' as string,
    jurisdiction: '',
    tags: '',
    include_in_risk_analysis: false,
    include_in_citations: false,
    // Phase 7.24e — '' means org-wide; a UUID means project-scoped
    project_id: '',
  });

  type FileStatus = 'pending' | 'uploading' | 'created' | 'duplicate' | 'failed';
  interface FileEntry { file: File; status: FileStatus; error?: string }
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [bulkResult, setBulkResult] = useState<{
    created: Array<{ id: string; title: string; filename: string }>;
    duplicates: string[];
    failed: Array<{ filename: string; error: string }>;
  } | null>(null);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    // Phase 7.24e — load projects list once on mount for filter + upload scope.
    projectService.getAll().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    loadAssets();
  }, [search, typeFilter, jurisdictionFilter, projectFilter, activeTags]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAssets = async () => {
    try {
      const data = await knowledgeAssetService.getAll({
        search: search || undefined,
        asset_type: typeFilter || undefined,
        jurisdiction: jurisdictionFilter || undefined,
        project_id: projectFilter || undefined,
        tags: activeTags.length > 0 ? activeTags.join(',') : undefined,
      });
      setAssets(data);
    } catch (err) {
      console.error('Failed to load assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim().replace(/,$/, '');
      if (newTag && !activeTags.includes(newTag)) {
        setActiveTags([...activeTags, newTag]);
      }
      setTagInput('');
    } else if (e.key === 'Backspace' && tagInput === '' && activeTags.length > 0) {
      setActiveTags(activeTags.slice(0, -1));
    }
  };

  const removeTag = (tag: string) => {
    setActiveTags(activeTags.filter((t) => t !== tag));
  };

  const toggleUsages = async (assetId: string) => {
    if (expandedAssetId === assetId) {
      setExpandedAssetId(null);
      return;
    }
    // Reset tab + data when switching to a different row
    setExpandedAssetId(assetId);
    setActiveTab('usedIn');
    setUsages([]);
    setVersions([]);
    setUsagesLoading(true);
    try {
      const data = await knowledgeAssetService.getUsages(assetId);
      setUsages(data);
    } catch {
      setUsages([]);
    } finally {
      setUsagesLoading(false);
    }
  };

  const loadVersions = async (assetId: string) => {
    setVersionsLoading(true);
    setVersions([]);
    try {
      const data = await knowledgeAssetService.getVersions(assetId);
      setVersions(data);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleTabChange = (tab: 'usedIn' | 'versions') => {
    setActiveTab(tab);
    if (tab === 'versions' && expandedAssetId && versions.length === 0 && !versionsLoading) {
      loadVersions(expandedAssetId);
    }
  };

  const openSnapshot = async (assetId: string, versionNumber: number) => {
    setSnapshotLoadingVersion(versionNumber);
    try {
      const data = await knowledgeAssetService.getVersionSnapshot(assetId, versionNumber);
      setSnapshotModal({ versionNumber: data.version_number, data: data.snapshot_data, created_at: data.created_at });
    } catch {
      // silently ignore — no partial modal
    } finally {
      setSnapshotLoadingVersion(null);
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    setFileEntries(picked.map((f) => ({ file: f, status: 'pending' })));
    setBulkResult(null);
    setUploadError('');
  };

  const removeFileEntry = (index: number) => {
    setFileEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const resetModal = () => {
    setShowUploadModal(false);
    setFileEntries([]);
    setBulkResult(null);
    setUploadError('');
    setFormData({ description: '', asset_type: 'LAW', jurisdiction: '', tags: '', include_in_risk_analysis: false, include_in_citations: false, project_id: '' });
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fileEntries.length === 0) {
      setUploadError('Please select at least one file.');
      return;
    }
    setUploading(true);
    setBulkResult(null);
    setUploadError('');
    // Mark all as uploading
    setFileEntries((prev) => prev.map((fe) => ({ ...fe, status: 'uploading' as FileStatus })));

    try {
      const fd = new FormData();
      fd.append('asset_type', formData.asset_type);
      if (formData.description) fd.append('description', formData.description);
      if (formData.jurisdiction) fd.append('jurisdiction', formData.jurisdiction);
      if (formData.tags) fd.append('tags', JSON.stringify(formData.tags.split(',').map((t) => t.trim()).filter(Boolean)));
      // Phase 7.24e — project scope
      if (formData.project_id) fd.append('project_id', formData.project_id);
      fileEntries.forEach((fe) => fd.append('files', fe.file));

      const result = await knowledgeAssetService.bulkCreate(fd);
      setBulkResult(result);

      // Update per-file status from response
      setFileEntries((prev) =>
        prev.map((fe) => {
          if (result.duplicates.includes(fe.file.name)) {
            return { ...fe, status: 'duplicate' as FileStatus };
          }
          const fail = result.failed.find((f) => f.filename === fe.file.name);
          if (fail) return { ...fe, status: 'failed' as FileStatus, error: fail.error };
          const ok = result.created.find((c) => c.filename === fe.file.name);
          if (ok) return { ...fe, status: 'created' as FileStatus };
          return fe;
        }),
      );

      // Refresh the asset list to include newly created entries
      loadAssets();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setUploadError(error.response?.data?.message || 'Failed to upload assets. Please try again.');
      setFileEntries((prev) => prev.map((fe) => ({ ...fe, status: 'pending' as FileStatus })));
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
      <div className="space-y-2.5">
        {/* Row 1: text search + type + jurisdiction */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, description, or content summary…"
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
          <select
            value={jurisdictionFilter}
            onChange={(e) => setJurisdictionFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All jurisdictions</option>
            {JURISDICTIONS.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          {/* Phase 7.24e — project scope filter */}
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All scopes</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Row 2: tag chip input */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 min-h-[42px] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          {activeTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-primary/70 hover:bg-primary/20 hover:text-primary"
                aria-label={`Remove tag ${tag}`}
              >
                <svg viewBox="0 0 12 12" fill="currentColor" className="h-2.5 w-2.5">
                  <path d="M2.22 2.22a.75.75 0 011.06 0L6 4.94l2.72-2.72a.75.75 0 111.06 1.06L7.06 6l2.72 2.72a.75.75 0 11-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 01-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 010-1.06z" />
                </svg>
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagInputKeyDown}
            placeholder={activeTags.length === 0 ? 'Filter by tag — type and press Enter (e.g. type:PLAYBOOK)' : 'Add another tag…'}
            className="flex-1 min-w-[180px] border-none bg-transparent text-sm outline-none placeholder:text-gray-400"
            style={{ font: 'inherit' }}
          />
        </div>
      </div>

      {/* Assets Table */}
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card overflow-hidden">
        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left">
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Type</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">AI Index</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Date</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Scope</th>
              <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {assets.map((asset) => {
              const typeInfo = assetTypeLabels[asset.asset_type] || { label: asset.asset_type, color: 'bg-gray-100 text-gray-700' };
              const statusInfo = reviewStatusConfig[asset.review_status] || reviewStatusConfig.PENDING_REVIEW;
              const embedInfo = embeddingIcons[asset.embedding_status] || { color: 'text-gray-400', label: asset.embedding_status };
              const isExpanded = expandedAssetId === asset.id;
              return (
                <>
                  <tr
                    key={asset.id}
                    onClick={() => toggleUsages(asset.id)}
                    className="cursor-pointer transition-colors hover:bg-gray-50/70"
                  >
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
                    {/* Phase 7.24e — scope indicator */}
                    <td className="px-6 py-4">
                      {asset.project_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                          </svg>
                          {asset.project?.name ?? 'Project'}
                        </span>
                      ) : asset.organization_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                          </svg>
                          Org
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                          </svg>
                          Platform
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <svg
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                        <span>Details</span>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${asset.id}-details`} className="bg-gray-50/40">
                      <td colSpan={7} className="px-8 py-4">
                        {/* Tab bar */}
                        <div className="mb-3 flex items-center gap-0 border-b border-gray-200">
                          {(['usedIn', 'versions'] as const).map((tab) => (
                            <button
                              key={tab}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleTabChange(tab); }}
                              className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                                activeTab === tab
                                  ? 'border-primary text-primary'
                                  : 'border-transparent text-gray-400 hover:text-gray-600'
                              }`}
                            >
                              {tab === 'usedIn' ? 'Used In' : 'Version History'}
                            </button>
                          ))}
                        </div>

                        {/* ── Used In tab ── */}
                        {activeTab === 'usedIn' && (
                          usagesLoading ? (
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <LoadingSpinner size="sm" />
                              <span>Loading usage history…</span>
                            </div>
                          ) : usages.length === 0 ? (
                            <p className="text-xs text-gray-400">Not used in any compliance checks yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="mb-2 text-xs font-semibold text-gray-500">
                                Used in {usages.length} compliance check{usages.length !== 1 ? 's' : ''}
                              </p>
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[480px] text-xs">
                                  <thead>
                                    <tr className="text-left text-gray-400">
                                      <th className="pb-1.5 pr-6 font-medium">Context type</th>
                                      <th className="pb-1.5 pr-6 font-medium">Context ID</th>
                                      <th className="pb-1.5 font-medium">Used at</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {usages.map((u) => (
                                      <tr key={`${u.context_id}-${u.used_at}`} className="text-gray-600">
                                        <td className="py-1.5 pr-6">
                                          <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                                            {u.context_type.replace(/_/g, ' ')}
                                          </span>
                                        </td>
                                        <td className="py-1.5 pr-6 font-mono text-gray-400">
                                          {u.context_id.slice(0, 8)}…{u.context_id.slice(-4)}
                                        </td>
                                        <td className="py-1.5 text-gray-400">
                                          {new Date(u.used_at).toLocaleString()}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )
                        )}

                        {/* ── Version History tab ── */}
                        {activeTab === 'versions' && (
                          versionsLoading ? (
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <LoadingSpinner size="sm" />
                              <span>Loading version history…</span>
                            </div>
                          ) : versions.length === 0 ? (
                            <p className="text-xs text-gray-400">
                              No version history yet. Versions are recorded when the asset is edited.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[560px] text-xs">
                                <thead>
                                  <tr className="text-left text-gray-400">
                                    <th className="pb-1.5 pr-4 font-medium">Version</th>
                                    <th className="pb-1.5 pr-4 font-medium">Changed by</th>
                                    <th className="pb-1.5 pr-4 font-medium">Summary</th>
                                    <th className="pb-1.5 pr-4 font-medium">Date</th>
                                    <th className="pb-1.5 font-medium" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {versions.map((v) => (
                                    <tr key={v.id} className="text-gray-600">
                                      <td className="py-1.5 pr-4">
                                        <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-mono font-medium text-gray-600">
                                          v{v.version_number}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-4 text-gray-500">
                                        {v.changer_name ?? (v.changed_by ? v.changed_by.slice(0, 8) + '…' : 'Unknown')}
                                      </td>
                                      <td className="py-1.5 pr-4 max-w-[200px] truncate text-gray-400" title={v.change_summary ?? ''}>
                                        {v.change_summary ?? <span className="italic text-gray-300">No summary</span>}
                                      </td>
                                      <td className="py-1.5 pr-4 text-gray-400">
                                        {new Date(v.created_at).toLocaleString()}
                                      </td>
                                      <td className="py-1.5">
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); openSnapshot(asset.id, v.version_number); }}
                                          disabled={snapshotLoadingVersion === v.version_number}
                                          className="text-primary text-xs font-medium hover:underline disabled:opacity-50"
                                        >
                                          {snapshotLoadingVersion === v.version_number ? 'Loading…' : 'View snapshot'}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        </div>
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

      {/* ── Version Snapshot Modal ── */}
      {snapshotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200/50 bg-white shadow-elevated">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Version {snapshotModal.versionNumber} Snapshot
                </h2>
                <p className="mt-0.5 text-sm text-gray-400">
                  Captured {new Date(snapshotModal.created_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSnapshotModal(null)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Snapshot data */}
            <div className="p-6">
              <dl className="space-y-3">
                {Object.entries(snapshotModal.data).map(([key, value]) =>
                  value !== null && value !== undefined ? (
                    <div key={key} className="grid grid-cols-[160px_1fr] gap-3 text-sm">
                      <dt className="font-medium capitalize text-gray-500">
                        {key.replace(/_/g, ' ')}
                      </dt>
                      <dd className="break-words text-gray-700" dir="auto">
                        {Array.isArray(value) ? (
                          (value as unknown[]).length > 0 ? (
                            (value as string[]).join(', ')
                          ) : (
                            <span className="italic text-gray-300">none</span>
                          )
                        ) : typeof value === 'boolean' ? (
                          value ? 'Yes' : 'No'
                        ) : typeof value === 'object' ? (
                          <pre className="whitespace-pre-wrap text-xs text-gray-500">
                            {JSON.stringify(value, null, 2)}
                          </pre>
                        ) : (
                          String(value)
                        )}
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-gray-200/50 bg-white shadow-elevated">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Import Knowledge Assets</h2>
                <p className="mt-0.5 text-sm text-gray-400">
                  Upload up to 20 PDF or DOCX files with shared metadata
                </p>
              </div>
              <button
                onClick={resetModal}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Results summary (shown after upload completes) */}
            {bulkResult && (
              <div className="border-b border-gray-100 px-6 py-4 space-y-2">
                <p className="text-sm font-semibold text-gray-700">Import complete</p>
                {bulkResult.created.length > 0 && (
                  <p className="text-sm text-emerald-600">
                    ✓ {bulkResult.created.length} asset{bulkResult.created.length !== 1 ? 's' : ''} imported
                  </p>
                )}
                {bulkResult.duplicates.length > 0 && (
                  <p className="text-sm text-amber-600">
                    ⚠ {bulkResult.duplicates.length} duplicate{bulkResult.duplicates.length !== 1 ? 's' : ''} skipped
                  </p>
                )}
                {bulkResult.failed.length > 0 && (
                  <p className="text-sm text-red-600">
                    ✕ {bulkResult.failed.length} file{bulkResult.failed.length !== 1 ? 's' : ''} failed
                  </p>
                )}
              </div>
            )}

            <form onSubmit={handleUpload} className="space-y-4 p-6">
              {/* Shared metadata */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Asset Type *</label>
                <select
                  value={formData.asset_type}
                  onChange={(e) => setFormData({ ...formData, asset_type: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  disabled={uploading}
                >
                  {Object.entries(assetTypeLabels).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Description <span className="text-gray-400 font-normal">(shared across all files)</span>
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  rows={2}
                  placeholder="Optional shared description…"
                  disabled={uploading}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Jurisdiction</label>
                  <input
                    type="text"
                    value={formData.jurisdiction}
                    onChange={(e) => setFormData({ ...formData, jurisdiction: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. AE, EG"
                    disabled={uploading}
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
                    disabled={uploading}
                  />
                </div>
              </div>

              {/* Phase 7.24e — Scope selector */}
              {projects.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Scope</label>
                  <select
                    value={formData.project_id}
                    onChange={(e) => setFormData({ ...formData, project_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    disabled={uploading}
                  >
                    <option value="">Organization (visible to all projects)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (project-scoped)</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Multi-file picker */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Files <span className="text-gray-400 font-normal">(PDF or DOCX · up to 20 files · 20 MB each)</span>
                </label>
                <div className="rounded-lg border-2 border-dashed border-gray-200 p-4 text-center transition-colors hover:border-primary/40">
                  <input
                    type="file"
                    onChange={handleFilePick}
                    className="hidden"
                    id="bulk-file-upload"
                    accept=".pdf,.docx"
                    multiple
                    disabled={uploading}
                  />
                  <label htmlFor="bulk-file-upload" className={`cursor-pointer ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
                    <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <p className="mt-2 text-sm text-gray-500">
                      {fileEntries.length > 0
                        ? `${fileEntries.length} file${fileEntries.length !== 1 ? 's' : ''} selected — click to change`
                        : 'Click to select files'}
                    </p>
                  </label>
                </div>
              </div>

              {/* Per-file status list */}
              {fileEntries.length > 0 && (
                <ul className="space-y-1.5 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                  {fileEntries.map((fe, idx) => {
                    const statusColor: Record<typeof fe.status, string> = {
                      pending: 'text-gray-400',
                      uploading: 'text-blue-500',
                      created: 'text-emerald-600',
                      duplicate: 'text-amber-600',
                      failed: 'text-red-600',
                    };
                    const statusIcon: Record<typeof fe.status, string> = {
                      pending: '○',
                      uploading: '↑',
                      created: '✓',
                      duplicate: '⚠',
                      failed: '✕',
                    };
                    const statusLabel: Record<typeof fe.status, string> = {
                      pending: 'Pending',
                      uploading: 'Uploading…',
                      created: 'Imported',
                      duplicate: 'Duplicate',
                      failed: fe.error ?? 'Failed',
                    };
                    return (
                      <li key={idx} className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`shrink-0 font-mono ${statusColor[fe.status]}`}>
                            {statusIcon[fe.status]}
                          </span>
                          <span className="truncate text-gray-700" title={fe.file.name}>
                            {fe.file.name}
                          </span>
                          <span className="shrink-0 text-gray-400">
                            ({(fe.file.size / 1024 / 1024).toFixed(1)} MB)
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`${statusColor[fe.status]}`}>{statusLabel[fe.status]}</span>
                          {fe.status === 'pending' && !uploading && (
                            <button
                              type="button"
                              onClick={() => removeFileEntry(idx)}
                              className="text-gray-300 hover:text-red-400 transition-colors"
                              aria-label={`Remove ${fe.file.name}`}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {uploadError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{uploadError}</div>
              )}

              <div className="flex justify-end gap-2.5 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={resetModal}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  {bulkResult ? 'Close' : 'Cancel'}
                </button>
                {!bulkResult && (
                  <button
                    type="submit"
                    disabled={uploading || fileEntries.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-50"
                  >
                    {uploading && <LoadingSpinner size="sm" />}
                    {uploading ? 'Importing…' : `Import ${fileEntries.length > 0 ? `${fileEntries.length} ` : ''}File${fileEntries.length !== 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
