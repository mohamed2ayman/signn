import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import ChatPanel from '@/components/chat/ChatPanel';
import ContractStatusDot from '@/components/contracts/ContractStatusDot';
import ContractTypeSelector from '@/components/contracts/ContractTypeSelector';
import RelationshipTypeSelector from '@/components/contracts/RelationshipTypeSelector';
import ParentContractPicker from '@/components/contracts/ParentContractPicker';
import ProjectHealthBar from '@/components/project/ProjectHealthBar';
import ProjectAttentionZone from '@/components/project/ProjectAttentionZone';
import ProjectAnalyticsRow from '@/components/project/ProjectAnalyticsRow';
import ProjectPartiesDirectory from '@/components/project/ProjectPartiesDirectory';
import { ContractType, LicenseOrganization } from '@/types';
import type { Project } from '@/types';

// ── 7.20 slice 1 — tabbed shell ─────────────────────────────────
type ProjectTab = 'dashboard' | 'contracts' | 'parties';

const TABS: ReadonlyArray<{ id: ProjectTab; labelKey: string }> = [
  { id: 'dashboard', labelKey: 'projectDashboard.tabs.dashboard' },
  { id: 'contracts', labelKey: 'projectDashboard.tabs.contracts' },
  { id: 'parties', labelKey: 'projectDashboard.tabs.partiesTeam' },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProjectTab>('dashboard');
  const [showCreateContract, setShowCreateContract] = useState(false);
  const [createStep, setCreateStep] = useState<'type' | 'details'>('type');
  const [selectedType, setSelectedType] = useState<ContractType | null>(null);
  // Multi-tier T0a.2 — relationship-type CODE (registry code, e.g. MAIN).
  // Required for new contracts (backend column stays nullable for legacy).
  const [relationshipType, setRelationshipType] = useState<string | null>(null);
  // Multi-tier T0b — parent-contract link (null = no parent). Captured only
  // when the chosen type's parent_link_rule is 'required' or 'optional'.
  const [parentContractId, setParentContractId] = useState<string | null>(null);
  const [contractForm, setContractForm] = useState({ name: '', party_type: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    // Project fetch — pre-existing pattern, untouched in the 7.20 tab slice.
    projectService
      .getById(id)
      .then(setProject)
      .catch((err) => {
        console.error('Failed to load project:', err);
        setError('project');
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Contracts via React Query (lesson #105). Shared queryKey with
  // ProjectHealthBar and later 7.20 slices — React Query dedupes the fetch
  // across components on the same key. A failure here still renders the
  // page (contracts fall back to an empty array, matching prior behaviour).
  const contractsQ = useQuery({
    queryKey: ['project-contracts', id],
    queryFn: () => contractService.getAll(id!),
    enabled: !!id,
  });
  const contracts = contractsQ.data ?? [];

  // Multi-tier T0b — relationship-type registry metadata for the create-flow
  // parent step. SAME queryKey as RelationshipTypeSelector — React Query
  // dedupes, so this reuses the picker's fetch (no redundant request).
  const relTypesQ = useQuery({
    queryKey: ['relationship-types'],
    queryFn: () => contractService.getRelationshipTypes(true),
    staleTime: 1000 * 60 * 60,
  });
  const selectedRelType =
    (relTypesQ.data ?? []).find((rt) => rt.code === relationshipType) ?? null;
  const parentRule = selectedRelType?.parent_link_rule ?? 'none';
  const allowedParentTypes = selectedRelType?.allowed_parent_types ?? [];
  // Eligible parents: contracts in THIS project whose relationship_type is in
  // the child type's allowed_parent_types (e.g. only MAIN for a SUBCONTRACT).
  const eligibleParents = contracts.filter(
    (c) =>
      !!c.relationship_type && allowedParentTypes.includes(c.relationship_type),
  );

  const isStandardForm = (ct: ContractType) => ct !== ContractType.ADHOC && ct !== ContractType.UPLOADED;

  // Localized label for the chosen FORM in the "… selected" subtitle. Standard
  // forms keep their proper-noun humanized name (FIDIC/NEC editions are not
  // translated); the non-standard codes get real translations.
  const formLabel = (ct: ContractType | null): string => {
    if (!ct) return '';
    if (ct === ContractType.ADHOC) return t('contractCreate.formName.ADHOC');
    if (ct === ContractType.UPLOADED) return t('contractCreate.formName.UPLOADED');
    return (ct as string).replace(/_/g, ' ');
  };

  const getLicenseOrg = (ct: ContractType): LicenseOrganization | undefined => {
    const s = ct as string;
    if (s.startsWith('FIDIC_')) return LicenseOrganization.FIDIC;
    if (s.startsWith('NEC') || s === 'FAC_1' || s === 'TAC_1') return LicenseOrganization.NEC;
    return undefined;
  };

  const handleTypeSelected = (type: ContractType) => {
    setSelectedType(type);
    setCreateStep('details');
  };

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    // Relationship type is required for new contracts (submit is also disabled
    // until one is chosen — this guard is the safety net). T0b: a 'required'
    // parent rule also blocks submit until a parent is chosen.
    if (!id || !selectedType || !relationshipType) return;
    if (parentRule === 'required' && !parentContractId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const contract = await contractService.create({
        project_id: id,
        name: contractForm.name,
        contract_type: selectedType,
        relationship_type: relationshipType,
        // Multi-tier T0b — only send a parent when one is chosen. 'none' types
        // never show the picker (parentContractId stays null → omitted).
        parent_contract_id: parentContractId ?? undefined,
        party_type: contractForm.party_type || undefined,
        license_acknowledged: isStandardForm(selectedType) ? true : undefined,
        license_organization: isStandardForm(selectedType) ? getLicenseOrg(selectedType) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['project-contracts', id] });
      setShowCreateContract(false);
      setCreateStep('type');
      setSelectedType(null);
      setRelationshipType(null);
      setParentContractId(null);
      setContractForm({ name: '', party_type: '' });
      navigate(`/app/contracts/${contract.id}`);
    } catch (err) {
      // Surface a clean message (e.g. an unknown/inactive relationship code
      // rejected by the backend as a 400) — never a raw stack / 500.
      console.error('Failed to create contract:', err);
      setCreateError(t('relationshipType.createError'));
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (!project) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-gray-400">
        <svg className="mb-3 h-12 w-12" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <p className="text-sm font-medium">
          {error ? 'Failed to load project' : 'Project not found'}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {error
            ? 'There was an error loading this project. Please try again or go back to your projects.'
            : 'This project may have been deleted or you don\'t have access.'}
        </p>
        <button
          onClick={() => navigate('/app/projects')}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-600"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Go to Projects
        </button>
      </div>
    );
  }

  const contractsByStatus = {
    active: contracts.filter(c => ['ACTIVE', 'APPROVED'].includes(c.status)),
    draft: contracts.filter(c => c.status === 'DRAFT'),
    other: contracts.filter(c => !['ACTIVE', 'APPROVED', 'DRAFT'].includes(c.status)),
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400">
        <button onClick={() => navigate('/app/projects')} className="transition-colors hover:text-primary">
          Projects
        </button>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="font-medium text-gray-700">{project.name}</span>
      </nav>

      {/* Project Header Card */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-card">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
              {project.objective && (
                <p className="mt-1 max-w-2xl text-sm text-gray-500">{project.objective}</p>
              )}
              <div className="mt-3 flex items-center gap-4">
                {project.country && (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                    </svg>
                    {project.country}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  Created {new Date(project.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Phase 7.1 Step 2 — direct link to the project's obligations page.
                Route /app/projects/:id/obligations already exists in App.tsx
                (renders ProjectObligationsPage) but was previously unreachable
                from the UI. */}
            <button
              onClick={() => navigate(`/app/projects/${id}/obligations`)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('project.viewObligations')}
            </button>
            <button
              onClick={() => navigate(`/app/projects/${id}/permissions`)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              Permissions
            </button>
            <button
              onClick={() => setShowCreateContract(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('contractCreate.addContract')}
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-6 grid grid-cols-4 gap-4 border-t border-gray-100 pt-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Total Contracts</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{contracts.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{contractsByStatus.active.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Drafts</p>
            <p className="mt-1 text-2xl font-bold text-gray-500">{contractsByStatus.draft.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Team Members</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{project.members?.length ?? 0}</p>
          </div>
        </div>
      </div>

      {/* ── Tabs (7.20 slice 1) — tab STATE, not URL routes ── */}
      <div role="tablist" aria-label={t('project.title')} className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* ── Dashboard tab (default) ── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <ProjectHealthBar
            projectId={id!}
            onNavigateToTab={() => setActiveTab('contracts')}
          />
          {/* Slice 2 — "Needs your attention" zone (Rev 02 control-center model). */}
          <ProjectAttentionZone
            projectId={id!}
            onNavigateToTab={() => setActiveTab('contracts')}
          />
          {/* Slice 3 — supporting analytics row (risk mix / obligations /
              contracts-by-status via the 12→6 fold / directory summary).
              Slice 5 — customize mode (reorder/hide/restore, localStorage
              per-user-and-project). key={id} remounts on project switch so the
              new project's saved layout loads via the useState initializer and
              the stored layout never crosses projects. */}
          <ProjectAnalyticsRow
            key={id}
            projectId={id!}
            onNavigateToTab={() => setActiveTab('parties')}
          />
        </div>
      )}

      {/* ── Parties & Team tab — full directory (7.20 slice 4a, display-only;
          invite/write actions are Slice 4b) ── */}
      {activeTab === 'parties' && <ProjectPartiesDirectory projectId={id!} />}

      {/* ── Contracts tab — the pre-existing contracts card, moved verbatim ── */}
      {activeTab === 'contracts' && (
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <h2 className="text-[15px] font-semibold text-gray-900">Contracts</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{contracts.length}</span>
          </div>
        </div>

        {contracts.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {contracts.map((contract) => (
              <div
                key={contract.id}
                onClick={() => navigate(`/app/contracts/${contract.id}`)}
                className="group flex cursor-pointer items-center justify-between px-6 py-4 transition-colors hover:bg-gray-50/80"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50">
                    <svg className="h-4.5 w-4.5 text-navy-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                      {contract.name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {contract.contract_type.replace(/_/g, ' ')} · v{contract.current_version}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ContractStatusDot status={contract.status} />
                  <svg className="h-4 w-4 text-gray-300 transition-colors group-hover:text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gray-50">
              <svg className="h-6 w-6 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-gray-500">No contracts yet</p>
            <p className="mt-1 text-xs text-gray-400">Add your first contract to get started</p>
            <button
              onClick={() => setShowCreateContract(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('contractCreate.addContract')}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Create Contract Modal — Multi-step */}
      {showCreateContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200/50 bg-white p-6 shadow-elevated">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {createStep === 'type' ? t('contractCreate.newContract') : t('contractCreate.contractDetails')}
                </h2>
                <p className="mt-0.5 text-sm text-gray-400" dir="auto">
                  {createStep === 'type'
                    ? t('contractCreate.chooseForm')
                    : t('contractCreate.formSelected', { form: formLabel(selectedType) })}
                </p>
              </div>
              <button
                onClick={() => { setShowCreateContract(false); setCreateStep('type'); setSelectedType(null); setRelationshipType(null); setParentContractId(null); setCreateError(null); setContractForm({ name: '', party_type: '' }); }}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {createStep === 'type' && (
              <ContractTypeSelector
                onSelect={handleTypeSelected}
              />
            )}

            {createStep === 'details' && (
              <form onSubmit={handleCreateContract} className="space-y-4">
                {selectedType && isStandardForm(selectedType) && (
                  <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
                      (selectedType as string).startsWith('FIDIC_')
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-teal-100 text-teal-700'
                    }`}>
                      {(selectedType as string).startsWith('FIDIC_') ? 'FIDIC' : 'NEC'}
                    </span>
                    <span className="text-gray-500" dir="auto">{t('contractCreate.prePopulatedNote')}</span>
                    <div className="relative ml-auto group">
                      <svg className="h-4 w-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 0v.75m0-2.577c0-.828.705-1.466 1.45-1.827.24-.116.467-.263.67-.442 1.172-1.025 1.172-2.687 0-3.712-1.171-1.025-3.071-1.025-4.242 0" /></svg>
                      <div className="absolute bottom-full right-0 mb-2 hidden w-64 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg group-hover:block z-10" dir="auto">
                        {t('contractCreate.standardFormTooltip')}
                      </div>
                    </div>
                  </div>
                )}

                {/* Multi-tier T0a.2 — RELATIONSHIP type (distinct from the FORM
                    badge above). Required for new contracts. */}
                <div>
                  <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
                    {t('relationshipType.fieldLabel')}
                    <span className="text-red-500">*</span>
                  </label>
                  <p className="mb-2.5 text-xs text-gray-400">{t('relationshipType.fieldHint')}</p>
                  <RelationshipTypeSelector
                    value={relationshipType}
                    onChange={(code) => { setRelationshipType(code); setParentContractId(null); }}
                  />
                </div>

                {/* Multi-tier T0b — conditional PARENT step. Shown only for
                    'required'/'optional' types; hidden entirely for 'none'
                    (MAIN / USUFRUCT). Parent list is filtered to the type's
                    allowed_parent_types (e.g. only MAIN for a SUBCONTRACT). */}
                {relationshipType && parentRule !== 'none' && (
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
                      {t('relationshipType.parent.label')}
                      {parentRule === 'required' && <span className="text-red-500">*</span>}
                    </label>
                    <p className="mb-2.5 text-xs text-gray-400" dir="auto">
                      {parentRule === 'required'
                        ? t('relationshipType.parent.hintRequired')
                        : t('relationshipType.parent.hintOptional')}
                    </p>
                    <ParentContractPicker
                      contracts={eligibleParents}
                      value={parentContractId}
                      onChange={setParentContractId}
                      required={parentRule === 'required'}
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">{t('contractCreate.contractName')}</label>
                  <input
                    type="text"
                    value={contractForm.name}
                    onChange={(e) => setContractForm({ ...contractForm, name: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder={t('contractCreate.contractNamePlaceholder')}
                    dir="auto"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">{t('contractCreate.partyType')} <span className="text-gray-400 font-normal">{t('contractCreate.optional')}</span></label>
                  <input
                    type="text"
                    value={contractForm.party_type}
                    onChange={(e) => setContractForm({ ...contractForm, party_type: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder={t('contractCreate.partyTypePlaceholder')}
                    dir="auto"
                  />
                </div>
                {createError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" dir="auto">
                    {createError}
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={() => { setCreateStep('type'); setSelectedType(null); setCreateError(null); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                    {t('contractCreate.back')}
                  </button>
                  <button
                    type="submit"
                    disabled={creating || !relationshipType || (parentRule === 'required' && !parentContractId)}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating && <LoadingSpinner size="sm" />}
                    {t('contractCreate.create')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Floating AI Assistant Button */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        className={`fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition-all ${
          chatOpen
            ? 'bg-primary text-white hover:bg-primary-600'
            : 'bg-primary text-white hover:bg-primary-600'
        }`}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
        AI Assistant
      </button>

      {/* AI Chat Panel */}
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
