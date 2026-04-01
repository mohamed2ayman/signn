import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import ContractTypeSelector from '@/components/contracts/ContractTypeSelector';
import { ContractType, LicenseOrganization } from '@/types';
import type { Project, Contract } from '@/types';

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  DRAFT: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' },
  PENDING_APPROVAL: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ACTIVE: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  TERMINATED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  CHANGES_REQUESTED: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
};

function ContractStatusDot({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateContract, setShowCreateContract] = useState(false);
  const [createStep, setCreateStep] = useState<'type' | 'details'>('type');
  const [selectedType, setSelectedType] = useState<ContractType | null>(null);
  const [contractForm, setContractForm] = useState({ name: '', party_type: '' });
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    // Fetch project and contracts independently so a failure in one
    // doesn't prevent the other from rendering
    projectService
      .getById(id)
      .then(setProject)
      .catch((err) => {
        console.error('Failed to load project:', err);
        setError('project');
      })
      .finally(() => setLoading(false));

    contractService
      .getAll(id)
      .then(setContracts)
      .catch((err) => {
        console.error('Failed to load contracts:', err);
        // Contracts stay as empty array — page still renders
      });
  }, [id]);

  const isStandardForm = (ct: ContractType) => ct !== ContractType.ADHOC && ct !== ContractType.UPLOADED;

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
    if (!id || !selectedType) return;
    setCreating(true);
    try {
      const contract = await contractService.create({
        project_id: id,
        name: contractForm.name,
        contract_type: selectedType,
        party_type: contractForm.party_type || undefined,
        license_acknowledged: isStandardForm(selectedType) ? true : undefined,
        license_organization: isStandardForm(selectedType) ? getLicenseOrg(selectedType) : undefined,
      });
      setContracts([contract, ...contracts]);
      setShowCreateContract(false);
      setCreateStep('type');
      setSelectedType(null);
      setContractForm({ name: '', party_type: '' });
      navigate(`/app/contracts/${contract.id}`);
    } catch (err) {
      console.error('Failed to create contract:', err);
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
          <div className="flex items-center gap-2">
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
              Add Contract
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

      {/* Contracts List */}
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
              Add Contract
            </button>
          </div>
        )}
      </div>

      {/* Create Contract Modal — Multi-step */}
      {showCreateContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className={`w-full rounded-2xl border border-gray-200/50 bg-white p-6 shadow-elevated ${createStep === 'type' ? 'max-w-2xl' : 'max-w-md'}`}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {createStep === 'type' ? 'New Contract' : 'Contract Details'}
                </h2>
                <p className="mt-0.5 text-sm text-gray-400">
                  {createStep === 'type'
                    ? 'Choose a standard form or create a custom contract'
                    : `${(selectedType as string)?.replace(/_/g, ' ')} selected`}
                </p>
              </div>
              <button
                onClick={() => { setShowCreateContract(false); setCreateStep('type'); setSelectedType(null); setContractForm({ name: '', party_type: '' }); }}
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
                    <span className="text-gray-500">Clauses will be pre-populated from the standard form template</span>
                    <div className="relative ml-auto group">
                      <svg className="h-4 w-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 0v.75m0-2.577c0-.828.705-1.466 1.45-1.827.24-.116.467-.263.67-.442 1.172-1.025 1.172-2.687 0-3.712-1.171-1.025-3.071-1.025-4.242 0" /></svg>
                      <div className="absolute bottom-full right-0 mb-2 hidden w-64 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg group-hover:block z-10">
                        Standard forms provide the internationally recognized clause structure. Customize using Particular Conditions without modifying the General Conditions.
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Contract Name</label>
                  <input
                    type="text"
                    value={contractForm.name}
                    onChange={(e) => setContractForm({ ...contractForm, name: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. Main Construction Agreement"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Party Type <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={contractForm.party_type}
                    onChange={(e) => setContractForm({ ...contractForm, party_type: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. Employer, Contractor"
                  />
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={() => { setCreateStep('type'); setSelectedType(null); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-50"
                  >
                    {creating && <LoadingSpinner size="sm" />}
                    Create Contract
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
