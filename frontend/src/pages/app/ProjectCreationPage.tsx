import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { useDocumentProcessing } from '@/hooks/useDocumentProcessing';
import StepIndicator from '@/components/common/StepIndicator';
import FileDropZone from '@/components/common/FileDropZone';
import ProcessingStatusCard from '@/components/common/ProcessingStatusCard';
import Button from '@/components/common/Button';
import type { DocumentUpload } from '@/types';

const DOCUMENT_LABELS = [
  { value: '', label: 'No label' },
  { value: 'Contract Agreement', label: 'Contract Agreement' },
  { value: 'General Conditions', label: 'General Conditions' },
  { value: 'Particular Conditions', label: 'Particular Conditions' },
  { value: 'Appendix', label: 'Appendix' },
  { value: 'Amendment', label: 'Amendment' },
  { value: 'Addendum', label: 'Addendum' },
  { value: 'Schedule', label: 'Schedule' },
  { value: 'Bill of Quantities', label: 'Bill of Quantities' },
  { value: 'Specifications', label: 'Specifications' },
  { value: 'Other', label: 'Other' },
];

interface FileWithMeta {
  file: File;
  label: string;
  priority: number;
}

const WIZARD_STEPS = [
  { label: 'Project Details' },
  { label: 'Choose Path' },
  { label: 'Upload Documents' },
  { label: 'Processing' },
];

export default function ProjectCreationPage() {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Project details
  const [projectData, setProjectData] = useState({
    name: '',
    objective: '',
    country: '',
  });

  // Step 3: File upload
  const [filesWithMeta, setFilesWithMeta] = useState<FileWithMeta[]>([]);
  const [contractName, setContractName] = useState('');

  // Step 4: Processing
  const [contractId, setContractId] = useState<string | null>(null);
  const [documentIds, setDocumentIds] = useState<string[]>([]);

  const { documents, allComplete, anyFailed, overallProgress } =
    useDocumentProcessing(contractId, documentIds);

  // ─── Step 1: Project Details ────────────────────────────────

  const handleProjectDetailsNext = () => {
    if (!projectData.name.trim()) {
      setError('Project name is required');
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
    setFilesWithMeta(
      files.map((file, i) => ({
        file,
        label: '',
        priority: files.length - i, // First file = highest priority
      })),
    );
  }, []);

  const updateFileMeta = (index: number, field: 'label' | 'priority', value: string | number) => {
    setFilesWithMeta((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)),
    );
  };

  const handleStartAnalysis = async () => {
    if (filesWithMeta.length === 0) {
      setError('Please upload at least one document');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      // 1. Create project
      const project = await projectService.create({
        name: projectData.name,
        objective: projectData.objective || undefined,
        country: projectData.country || undefined,
      });

      // 2. Create contract
      const contract = await contractService.create({
        project_id: project.id,
        name: contractName || projectData.name,
        contract_type: 'UPLOADED',
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

      // 4. Move to processing step
      setCurrentStep(3);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setError(
        error.response?.data?.message ||
          'Failed to create project. Please try again.',
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
        <StepIndicator steps={WIZARD_STEPS} currentStep={currentStep} />
      </div>

      {/* Step 1: Project Details */}
      {currentStep === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">
            Create a New Project
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Set up your construction project to start managing contracts.
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Project Name *
              </label>
              <input
                type="text"
                value={projectData.name}
                onChange={(e) =>
                  setProjectData({ ...projectData, name: e.target.value })
                }
                placeholder="e.g., Dubai Metro Extension Phase 3"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Project Objective
              </label>
              <textarea
                value={projectData.objective}
                onChange={(e) =>
                  setProjectData({ ...projectData, objective: e.target.value })
                }
                placeholder="Describe what this project aims to achieve..."
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                rows={3}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Country / Jurisdiction
              </label>
              <input
                type="text"
                value={projectData.country}
                onChange={(e) =>
                  setProjectData({ ...projectData, country: e.target.value })
                }
                placeholder="e.g., UAE, Saudi Arabia, Egypt"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="mt-8 flex justify-end">
            <Button onClick={handleProjectDetailsNext}>Continue</Button>
          </div>
        </div>
      )}

      {/* Step 2: Choose Your Path */}
      {currentStep === 1 && (
        <div>
          <div className="mb-6 text-center">
            <h2 className="text-xl font-semibold text-gray-900">
              How would you like to start?
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Choose how you want to set up your contract documents.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Upload & Analyze Card */}
            <button
              type="button"
              onClick={handleSelectUploadAnalyze}
              className="group rounded-2xl border-2 border-gray-200 bg-white p-8 text-left transition-all hover:border-primary hover:shadow-lg"
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
                Upload & Analyze
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                Upload existing contract documents. Our AI will automatically
                extract clauses, identify risks, and track obligations — no
                manual work required.
              </p>
              <div className="mt-6 flex items-center text-sm font-medium text-primary">
                Upload Documents
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
            <div className="relative rounded-2xl border-2 border-gray-100 bg-gray-50 p-8 text-left opacity-70">
              <div className="absolute right-4 top-4 rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600">
                Coming Soon
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
                Draft from Requirements
              </h3>
              <p className="mt-2 text-sm text-gray-400">
                Describe your project requirements and our AI will draft
                tailored contract conditions for you.
              </p>
              <div className="mt-6 text-sm font-medium text-gray-400">
                Start Drafting
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-start">
            <button
              type="button"
              onClick={() => setCurrentStep(0)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              &larr; Back to project details
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Upload Documents */}
      {currentStep === 2 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">
            Upload Contract Documents
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Upload your contract documents. Our AI will read, extract clauses,
            and analyze them automatically.
          </p>

          {/* Contract Name */}
          <div className="mt-6">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Contract Name
            </label>
            <input
              type="text"
              value={contractName}
              onChange={(e) => setContractName(e.target.value)}
              placeholder="e.g., Main Construction Contract"
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
                Document Hierarchy (Optional)
              </h3>
              <p className="mt-0.5 text-xs text-gray-400">
                Label your documents to define priority. Amendments and
                addenda override general conditions, etc.
              </p>
              <div className="mt-3 space-y-3">
                {filesWithMeta.map((fm, index) => (
                  <div
                    key={`${fm.file.name}-${index}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
                  >
                    <span className="flex-1 truncate text-sm text-gray-700">
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
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Priority:</span>
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
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              &larr; Back
            </button>
            <Button
              onClick={handleStartAnalysis}
              isLoading={isSubmitting}
              disabled={filesWithMeta.length === 0}
            >
              Start Analysis
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
                ? 'Analysis Complete!'
                : anyFailed
                  ? 'Some documents failed to process'
                  : 'Analyzing Your Documents...'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {allComplete
                ? 'All documents have been processed. Review the extracted clauses to continue.'
                : anyFailed
                  ? 'You can retry failed documents or continue with the ones that succeeded.'
                  : 'Our AI is reading and extracting clauses from your documents. This usually takes 1-2 minutes.'}
            </p>
          </div>

          {/* Overall Progress */}
          {!allComplete && !anyFailed && (
            <div className="mx-auto mt-6 max-w-md">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Overall Progress</span>
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
                Review Extracted Clauses
              </Button>
              <p className="mt-2 text-xs text-gray-400">
                Review and approve the clauses before proceeding to risk
                analysis
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
                Continue with Processed Documents
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
