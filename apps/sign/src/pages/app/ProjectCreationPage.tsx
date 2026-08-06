import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { useDocumentProcessing } from '@/hooks/useDocumentProcessing';
import StepIndicator from '@/components/common/StepIndicator';
import FileDropZone from '@/components/common/FileDropZone';
import ProcessingStatusCard from '@/components/common/ProcessingStatusCard';
import PartyRoleSelect from '@/components/contracts/parties/PartyRoleSelect';
import Button from '@/components/common/Button';
import type { DocumentUpload } from '@/types';

/**
 * `value` is the API payload (`document_label`) and drives backend cover-page
 * trimming — it MUST stay English and is never translated. `labelKey` is the
 * display string only.
 */
const DOCUMENT_LABELS = [
  { value: '', labelKey: 'projectCreate.docLabel.none' },
  { value: 'Contract Agreement', labelKey: 'projectCreate.docLabel.contractAgreement' },
  { value: 'General Conditions', labelKey: 'projectCreate.docLabel.generalConditions' },
  { value: 'Particular Conditions', labelKey: 'projectCreate.docLabel.particularConditions' },
  { value: 'Appendix', labelKey: 'projectCreate.docLabel.appendix' },
  { value: 'Amendment', labelKey: 'projectCreate.docLabel.amendment' },
  { value: 'Addendum', labelKey: 'projectCreate.docLabel.addendum' },
  { value: 'Schedule', labelKey: 'projectCreate.docLabel.schedule' },
  { value: 'Bill of Quantities', labelKey: 'projectCreate.docLabel.billOfQuantities' },
  { value: 'Specifications', labelKey: 'projectCreate.docLabel.specifications' },
  { value: 'Other', labelKey: 'projectCreate.docLabel.other' },
];

const MENA_COUNTRIES = [
  'Algeria', 'Bahrain', 'Djibouti', 'Egypt', 'Iran', 'Iraq', 'Israel', 'Jordan',
  'Kuwait', 'Lebanon', 'Libya', 'Malta', 'Morocco', 'Oman', 'Palestine', 'Qatar',
  'Saudi Arabia', 'Syria', 'Tunisia', 'United Arab Emirates', 'Yemen',
];

const AFRICA_COUNTRIES = [
  'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cameroon',
  'Central African Republic', 'Chad', 'Comoros', 'Democratic Republic of the Congo',
  'Equatorial Guinea', 'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon', 'Gambia', 'Ghana',
  'Guinea', 'Guinea-Bissau', 'Ivory Coast', 'Kenya', 'Lesotho', 'Liberia', 'Madagascar',
  'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Mozambique', 'Namibia', 'Niger', 'Nigeria',
  'Republic of the Congo', 'Rwanda', 'São Tomé and Príncipe', 'Senegal', 'Seychelles',
  'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Tanzania', 'Togo',
  'Uganda', 'Zambia', 'Zimbabwe',
];

const MENA_SET = new Set(MENA_COUNTRIES);
const ALL_COUNTRIES = [...MENA_COUNTRIES, ...AFRICA_COUNTRIES].sort((a, b) => a.localeCompare(b));

// Party Foundation Slice 1b — the hardcoded free-text PARTY_OPTIONS list that
// used to live here is GONE. The party question is now answered against the
// party_roles registry via <PartyRoleSelect>, and the chosen CODE is persisted
// (projects.default_party_role_code + contracts.host_party_role_code) instead
// of being collected and silently discarded.
//
// The old list's "Other" free-text follow-up went with it: it had no backend
// column and was never persisted, and the registry's own OTHER code is the
// canonical way to say "none of these".

interface FileWithMeta {
  file: File;
  label: string;
  priority: number;
}

const WIZARD_STEP_KEYS = [
  'projectCreate.steps.details',
  'projectCreate.steps.choosePath',
  'projectCreate.steps.upload',
  'projectCreate.steps.processing',
];

export default function ProjectCreationPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Project details.
  // `party` now holds a party_roles registry CODE (e.g. 'EPC_CONTRACTOR'),
  // not a free-text label — see the PARTY_OPTIONS note above.
  const [projectData, setProjectData] = useState({
    name: '',
    objective: '',
    country: '',
    party: '',
  });

  const wizardSteps = WIZARD_STEP_KEYS.map((k) => ({ label: t(k) }));

  // Country dropdown state
  const [countrySearch, setCountrySearch] = useState('');
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const countryRef = useRef<HTMLDivElement>(null);
  const countryInputRef = useRef<HTMLInputElement>(null);

  const filteredCountries = countrySearch
    ? ALL_COUNTRIES.filter((c) => c.toLowerCase().includes(countrySearch.toLowerCase()))
    : ALL_COUNTRIES;

  // Build grouped list: MENA header, MENA matches, Africa header, Africa matches.
  // Country NAMES are reference data, not UI copy — the selected name is the
  // value POSTed as `country`, and the search filter matches on it — so they
  // are deliberately NOT translated. Only the two group HEADERS are chrome.
  const groupedCountryItems = (() => {
    const mena = filteredCountries.filter((c) => MENA_SET.has(c));
    const africa = filteredCountries.filter((c) => !MENA_SET.has(c));
    const items: { type: 'header' | 'country'; value: string; labelKey?: string }[] = [];
    if (mena.length > 0) {
      items.push({ type: 'header', value: 'MENA', labelKey: 'projectCreate.details.countryGroup.mena' });
      mena.forEach((c) => items.push({ type: 'country', value: c }));
    }
    if (africa.length > 0) {
      items.push({ type: 'header', value: 'Africa', labelKey: 'projectCreate.details.countryGroup.africa' });
      africa.forEach((c) => items.push({ type: 'country', value: c }));
    }
    return items;
  })();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryRef.current && !countryRef.current.contains(e.target as Node)) {
        setCountryDropdownOpen(false);
        if (!projectData.country) setCountrySearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [projectData.country]);

  // Step 3: File upload
  const [filesWithMeta, setFilesWithMeta] = useState<FileWithMeta[]>([]);
  const [contractName, setContractName] = useState('');

  // Step 4: Processing
  const [contractId, setContractId] = useState<string | null>(null);
  const [documentIds, setDocumentIds] = useState<string[]>([]);

  const { documents, allComplete, anyFailed, overallProgress } =
    useDocumentProcessing(contractId, documentIds);

  // Clear the localStorage session marker when analysis finishes
  useEffect(() => {
    if (allComplete) {
      localStorage.removeItem('sign_analysis_session');
    }
  }, [allComplete]);

  // ─── Step 1: Project Details ────────────────────────────────

  const handleProjectDetailsNext = () => {
    if (!projectData.name.trim()) {
      setError(t('projectCreate.errors.nameRequired'));
      return;
    }
    if (!projectData.country) {
      setError(t('projectCreate.errors.countryRequired'));
      return;
    }
    if (!projectData.party) {
      setError(t('projectCreate.errors.partyRequired'));
      return;
    }
    setError('');
    setContractName(projectData.name);
    setCurrentStep(1);
  };

  // ─── Step 2: Choose Path ────────────────────────────────────

  const handleSelectUploadAnalyze = () => {
    setCurrentStep(2);
  };

  // ─── Step 3: File Upload ────────────────────────────────────

  const handleFilesSelected = useCallback((files: File[]) => {
    setFilesWithMeta((prev) => {
      // Build a lookup of existing metadata by filename to preserve user edits
      const existingByName = new Map(prev.map((fm) => [fm.file.name, fm]));
      return files.map((file, i) => {
        const existing = existingByName.get(file.name);
        return existing
          ? { ...existing, file } // Preserve label & priority for previously uploaded files
          : { file, label: '', priority: i + 1 }; // Defaults for newly added files only
      });
    });
  }, []);

  const updateFileMeta = (index: number, field: 'label' | 'priority', value: string | number) => {
    setFilesWithMeta((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)),
    );
  };

  const handleStartAnalysis = async () => {
    if (filesWithMeta.length === 0) {
      setError(t('projectCreate.errors.uploadAtLeastOne'));
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      // 1. Create project.
      // Party Foundation Slice 1b — the party answer PERSISTS. It used to be
      // collected + validated on step 1 and then dropped on the floor here.
      const project = await projectService.create({
        name: projectData.name,
        objective: projectData.objective || undefined,
        country: projectData.country || undefined,
        default_party_role_code: projectData.party || undefined,
      });

      // 2. Create contract.
      // The contract created in this same submit carries the SAME code as its
      // host party role. The backend does NOT inherit the project default
      // automatically (that is Slice 1c), so it is passed explicitly.
      const contract = await contractService.create({
        project_id: project.id,
        name: contractName || projectData.name,
        contract_type: 'UPLOADED',
        host_party_role_code: projectData.party || undefined,
      });

      setContractId(contract.id);

      // 3. Upload all documents
      const uploadPromises = filesWithMeta.map((fm) =>
        documentProcessingService.uploadDocument(contract.id, fm.file, {
          document_label: fm.label || undefined,
          document_priority: fm.priority,
        }),
      );

      const uploadedDocs: DocumentUpload[] = await Promise.all(uploadPromises);
      setDocumentIds(uploadedDocs.map((d) => d.id));

      // 4. Persist analysis session so ProjectsPage can show a resume banner
      localStorage.setItem(
        'sign_analysis_session',
        JSON.stringify({ contractId: contract.id, projectId: project.id }),
      );

      // 5. Move to processing step
      setCurrentStep(3);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setError(
        error.response?.data?.message ||
          t('projectCreate.errors.createFailed'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Step 4: Processing ─────────────────────────────────────

  const handleRetryDocument = async (docId: string) => {
    if (!contractId) return;
    await documentProcessingService.reprocess(contractId, docId);
  };

  const handleReviewClauses = () => {
    if (contractId) {
      navigate(`/app/contracts/${contractId}/review`);
    }
  };

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Step Indicator */}
      <div className="mb-10">
        <StepIndicator steps={wizardSteps} currentStep={currentStep} />
      </div>

      {/* Step 1: Project Details */}
      {currentStep === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">
            {t('projectCreate.details.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t('projectCreate.details.subtitle')}
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('projectCreate.details.nameLabel')}
              </label>
              <input
                type="text"
                value={projectData.name}
                onChange={(e) =>
                  setProjectData({ ...projectData, name: e.target.value })
                }
                placeholder={t('projectCreate.details.namePlaceholder')}
                dir="auto"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('projectCreate.details.objectiveLabel')}
              </label>
              <textarea
                value={projectData.objective}
                onChange={(e) =>
                  setProjectData({ ...projectData, objective: e.target.value })
                }
                placeholder={t('projectCreate.details.objectivePlaceholder')}
                dir="auto"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                rows={3}
              />
            </div>
            {/* The chevron below is physically pinned to the trailing edge, so
                both it and the input's padding mirror under RTL — otherwise
                Arabic text runs underneath it (TopBar.tsx is the precedent). */}
            <div ref={countryRef} className="relative">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('projectCreate.details.countryLabel')}
              </label>
              <input
                ref={countryInputRef}
                type="text"
                value={countryDropdownOpen ? countrySearch : projectData.country}
                onChange={(e) => {
                  setCountrySearch(e.target.value);
                  setProjectData({ ...projectData, country: '' });
                  setCountryDropdownOpen(true);
                }}
                onFocus={() => {
                  setCountryDropdownOpen(true);
                  setCountrySearch('');
                }}
                placeholder={t('projectCreate.details.countryPlaceholder')}
                dir="auto"
                className="w-full rounded-lg border border-gray-300 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ltr:pl-4 ltr:pr-10 rtl:pr-4 rtl:pl-10"
              />
              <svg className="pointer-events-none absolute top-[38px] h-4 w-4 text-gray-400 ltr:right-3 rtl:left-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {countryDropdownOpen && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {groupedCountryItems.length === 0 ? (
                    <li className="px-4 py-2 text-sm text-gray-400">{t('projectCreate.details.countryNone')}</li>
                  ) : (
                    groupedCountryItems.map((item) =>
                      item.type === 'header' ? (
                        <li
                          key={`header-${item.value}`}
                          className="sticky top-0 bg-gray-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"
                        >
                          {item.labelKey ? t(item.labelKey) : item.value}
                        </li>
                      ) : (
                        <li
                          key={item.value}
                          onClick={() => {
                            setProjectData({ ...projectData, country: item.value });
                            setCountrySearch('');
                            setCountryDropdownOpen(false);
                          }}
                          className={`cursor-pointer px-4 py-2 text-sm hover:bg-primary/5 ${
                            projectData.country === item.value ? 'bg-primary/10 font-medium text-primary' : 'text-gray-700'
                          }`}
                        >
                          {item.value}
                        </li>
                      ),
                    )
                  )}
                </ul>
              )}
            </div>

            <div>
              <label
                htmlFor="project-party-role"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {t('projectCreate.details.partyLabel')}
              </label>
              <p className="mb-1.5 text-xs text-gray-400">
                {t('projectCreate.details.partyHint')}
              </p>
              {/*
                Party Foundation Slice 1b — the registry-backed, grouped picker.
                It queries the CONTRACT-scoped role list, which is correct here
                even though the answer is stored on the PROJECT:
                projects.default_party_role_code holds a contract-scoped code by
                design (migration 1776000000001 lines 50-54). Asking for
                applies_to=project would return a different, unusable set.
              */}
              <PartyRoleSelect
                id="project-party-role"
                value={projectData.party}
                onChange={(code) =>
                  setProjectData({ ...projectData, party: code })
                }
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600" dir="auto">
              {error}
            </div>
          )}

          <div className="mt-8 flex justify-end">
            <Button onClick={handleProjectDetailsNext}>
              {t('projectCreate.details.continue')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Choose Your Path */}
      {currentStep === 1 && (
        <div>
          <div className="mb-6 text-center">
            <h2 className="text-xl font-semibold text-gray-900">
              {t('projectCreate.path.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {t('projectCreate.path.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Upload & Analyze Card */}
            <button
              type="button"
              onClick={handleSelectUploadAnalyze}
              className="group rounded-2xl border-2 border-gray-200 bg-white p-8 ltr:text-left rtl:text-right transition-all hover:border-primary hover:shadow-lg"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                <svg
                  className="h-7 w-7 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-gray-900">
                {t('projectCreate.path.uploadTitle')}
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                {t('projectCreate.path.uploadBody')}
              </p>
              <div className="mt-6 flex items-center text-sm font-medium text-primary">
                {t('projectCreate.path.uploadCta')}
                <svg
                  className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </button>

            {/* Draft from Requirements Card */}
            <div className="relative rounded-2xl border-2 border-gray-100 bg-gray-50 p-8 ltr:text-left rtl:text-right opacity-70">
              <div className="absolute top-4 rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 ltr:right-4 rtl:left-4">
                {t('projectCreate.path.comingSoon')}
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-200">
                <svg
                  className="h-7 w-7 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-gray-500">
                {t('projectCreate.path.draftTitle')}
              </h3>
              <p className="mt-2 text-sm text-gray-400">
                {t('projectCreate.path.draftBody')}
              </p>
              <div className="mt-6 text-sm font-medium text-gray-400">
                {t('projectCreate.path.draftCta')}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-start">
            <button
              type="button"
              onClick={() => setCurrentStep(0)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {/* The arrow is a direction glyph, not copy — it must mirror
                  under RTL, so it is rendered outside the translated string. */}
              <span className="inline-block rtl:rotate-180">&larr;</span>{' '}
              {t('projectCreate.path.back')}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Upload Documents */}
      {currentStep === 2 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">
            {t('projectCreate.upload.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t('projectCreate.upload.subtitle')}
          </p>

          {/* Contract Name */}
          <div className="mt-6">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {t('projectCreate.upload.contractNameLabel')}
            </label>
            <input
              type="text"
              value={contractName}
              onChange={(e) => setContractName(e.target.value)}
              placeholder={t('projectCreate.upload.contractNamePlaceholder')}
              dir="auto"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* File Drop Zone */}
          <div className="mt-6">
            <FileDropZone
              onFilesSelected={handleFilesSelected}
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt"
              multiple
              maxFiles={10}
              maxSizeMB={50}
            />
          </div>

          {/* Document Hierarchy Labels */}
          {filesWithMeta.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700">
                {t('projectCreate.upload.hierarchyTitle')}
              </h3>
              <p className="mt-0.5 text-xs text-gray-400">
                {t('projectCreate.upload.hierarchyHint')}
              </p>
              <div className="mt-3 space-y-3">
                {filesWithMeta.map((fm, index) => (
                  <div
                    key={`${fm.file.name}-${index}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
                  >
                    <span
                      className="min-w-0 flex-1 text-sm text-gray-700"
                      title={fm.file.name}
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        direction: 'rtl',
                        textAlign: 'right',
                        unicodeBidi: 'plaintext',
                      }}
                    >
                      {fm.file.name}
                    </span>
                    <select
                      value={fm.label}
                      onChange={(e) =>
                        updateFileMeta(index, 'label', e.target.value)
                      }
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                    >
                      {DOCUMENT_LABELS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">{t('projectCreate.upload.priority')}</span>
                      <input
                        type="number"
                        value={fm.priority}
                        onChange={(e) =>
                          updateFileMeta(
                            index,
                            'priority',
                            parseInt(e.target.value) || 0,
                          )
                        }
                        min={0}
                        max={100}
                        className="w-14 rounded border border-gray-300 px-2 py-1 text-center text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600" dir="auto">
              {error}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              <span className="inline-block rtl:rotate-180">&larr;</span>{' '}
              {t('projectCreate.upload.back')}
            </button>
            <Button
              onClick={handleStartAnalysis}
              isLoading={isSubmitting}
              disabled={filesWithMeta.length === 0}
            >
              {t('projectCreate.upload.start')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Processing */}
      {currentStep === 3 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900">
              {allComplete
                ? t('projectCreate.processing.completeTitle')
                : anyFailed
                  ? t('projectCreate.processing.failedTitle')
                  : t('projectCreate.processing.runningTitle')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {allComplete
                ? t('projectCreate.processing.completeBody')
                : anyFailed
                  ? t('projectCreate.processing.failedBody')
                  : t('projectCreate.processing.runningBody')}
            </p>
          </div>

          {/* Overall Progress */}
          {!allComplete && !anyFailed && (
            <div className="mx-auto mt-6 max-w-md">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{t('projectCreate.processing.overallProgress')}</span>
                <span className="font-medium text-primary">
                  {overallProgress}%
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Document Cards */}
          <div className="mt-8 space-y-3">
            {documents.map((doc) => (
              <ProcessingStatusCard
                key={doc.id}
                document={doc}
                onRetry={() => handleRetryDocument(doc.id)}
              />
            ))}
          </div>

          {/* Review Button */}
          {allComplete && (
            <div className="mt-8 text-center">
              <Button onClick={handleReviewClauses} className="px-8 py-3">
                {t('projectCreate.processing.reviewCta')}
              </Button>
              <p className="mt-2 text-xs text-gray-400">
                {t('projectCreate.processing.reviewHint')}
              </p>
            </div>
          )}

          {/* Partial Success */}
          {anyFailed && !allComplete && documents.some(d => d.processing_status === 'CLAUSES_EXTRACTED') && (
            <div className="mt-8 text-center">
              <Button
                variant="outline"
                onClick={handleReviewClauses}
              >
                {t('projectCreate.processing.continuePartial')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
