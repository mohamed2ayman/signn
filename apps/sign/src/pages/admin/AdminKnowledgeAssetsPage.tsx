import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { knowledgeAssetService, ProcessingStatus, DuplicateCheckResult } from '@/services/api/knowledgeAssetService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { KnowledgeAsset } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSET_TYPES = [
  'LAW',
  'INTERNATIONAL_STANDARD',
  'ORGANIZATION_POLICY',
  'CONTRACT_TEMPLATE',
  'KNOWLEDGE',
] as const;

const JURISDICTIONS = [
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'AE', label: 'UAE' },
  { code: 'EG', label: 'Egypt' },
  { code: 'QA', label: 'Qatar' },
  { code: 'KW', label: 'Kuwait' },
  { code: 'BH', label: 'Bahrain' },
  { code: 'OM', label: 'Oman' },
  { code: 'JO', label: 'Jordan' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'INT', label: 'International' },
] as const;

const SUGGESTED_TAGS = [
  'FIDIC', 'NEC', 'Labor Law', 'Environmental', 'Health & Safety',
  'Data Protection', 'Tax', 'Procurement', 'Construction', 'Risk',
  'Compliance', 'Finance', 'IP', 'Dispute Resolution', 'Arbitration',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png'];
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const reviewStatusColors: Record<string, string> = {
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-700',
  UNDER_REVIEW: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  AUTO_APPROVED: 'bg-emerald-100 text-emerald-700',
};

const embeddingStatusConfig: Record<string, { label: string; cls: string }> = {
  PENDING:    { label: 'Queued',      cls: 'bg-gray-100 text-gray-600' },
  PROCESSING: { label: 'Processing',  cls: 'bg-blue-100 text-blue-700' },
  INDEXED:    { label: 'Indexed',     cls: 'bg-green-100 text-green-700' },
  FAILED:     { label: 'Failed',      cls: 'bg-red-100 text-red-700' },
  SKIPPED:    { label: 'Skipped',     cls: 'bg-gray-100 text-gray-500' },
};

const ocrStatusConfig: Record<string, { label: string; cls: string }> = {
  PENDING:    { label: 'OCR Queued',      cls: 'bg-gray-100 text-gray-600' },
  PROCESSING: { label: 'OCR Running',     cls: 'bg-blue-100 text-blue-700' },
  COMPLETED:  { label: 'OCR Done',        cls: 'bg-green-100 text-green-700' },
  FAILED:     { label: 'OCR Failed',      cls: 'bg-red-100 text-red-700' },
  SKIPPED:    { label: 'No File',         cls: 'bg-gray-100 text-gray-500' },
};

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmbeddingBadge({ status }: { status: string }) {
  const cfg = embeddingStatusConfig[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {status === 'PROCESSING' && (
        <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      )}
      {cfg.label}
    </span>
  );
}

function OcrBadge({ status }: { status: string }) {
  const cfg = ocrStatusConfig[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function LanguageBadge({ lang }: { lang: string }) {
  return (
    <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
      {lang.toUpperCase()}
    </span>
  );
}

function FlagBadge({ label, active }: { label: string; active: boolean }) {
  if (!active) return null;
  return (
    <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">
      {label}
    </span>
  );
}

// ─── 5-Step Upload Modal ──────────────────────────────────────────────────────

interface ModalProps {
  onClose: () => void;
  onSuccess: (asset: KnowledgeAsset) => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

interface FormState {
  // Step 1
  title: string;
  description: string;
  asset_type: string;
  jurisdiction: string;
  // Step 2
  file: File | null;
  fileHash: string | null;
  dupResult: DuplicateCheckResult | null;
  // Step 3
  tags: string[];
  tagInput: string;
  // Step 4
  include_in_risk_analysis: boolean;
  include_in_citations: boolean;
}

const initialFormState: FormState = {
  title: '',
  description: '',
  asset_type: '',
  jurisdiction: '',
  file: null,
  fileHash: null,
  dupResult: null,
  tags: [],
  tagInput: '',
  include_in_risk_analysis: true,
  include_in_citations: true,
};

function UploadModal({ onClose, onSuccess }: ModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hashingFile, setHashingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Cleanup poll on unmount ──
  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  // ── File validation + hashing ──
  const processFile = useCallback(async (file: File) => {
    setFileError(null);
    setForm(f => ({ ...f, dupResult: null, fileHash: null, file: null }));

    // Format check
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Only PDF, DOCX, JPG, and PNG files are accepted.');
      return;
    }
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setFileError('Only PDF, DOCX, JPG, and PNG files are accepted.');
      return;
    }

    // Hash + duplicate check
    setHashingFile(true);
    try {
      const hash = await computeSha256(file);
      const dup = await knowledgeAssetService.checkDuplicate(hash);
      setForm(f => ({ ...f, file, fileHash: hash, dupResult: dup }));
    } catch {
      setForm(f => ({ ...f, file, fileHash: null, dupResult: null }));
    } finally {
      setHashingFile(false);
    }
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  // ── Tag helpers ──
  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !form.tags.includes(trimmed)) {
      setForm(f => ({ ...f, tags: [...f.tags, trimmed], tagInput: '' }));
    }
  };

  const removeTag = (tag: string) =>
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));

  // ── Navigation ──
  const canProceed = (s: Step): boolean => {
    if (s === 1) return form.title.trim() !== '' && form.asset_type !== '';
    if (s === 2) return true; // file is optional; user can proceed without it
    if (s === 3) return true; // tags optional
    if (s === 4) return form.include_in_risk_analysis || form.include_in_citations;
    return true;
  };

  // ── Submit on Step 4 → 5 ──
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const fd = new FormData();
      fd.append('title', form.title.trim());
      if (form.description.trim()) fd.append('description', form.description.trim());
      fd.append('asset_type', form.asset_type);
      if (form.jurisdiction) fd.append('jurisdiction', form.jurisdiction);
      // Send as JSON string — the backend DTO normalises it via @Transform
      if (form.tags.length > 0) fd.append('tags', JSON.stringify(form.tags));
      // class-transformer converts 'true'/'false' strings via @Transform
      fd.append('include_in_risk_analysis', String(form.include_in_risk_analysis));
      fd.append('include_in_citations', String(form.include_in_citations));
      if (form.file) fd.append('file', form.file);

      const created = await knowledgeAssetService.create(fd);
      setStep(5);
      onSuccess(created);

      // Start polling
      const id = setInterval(async () => {
        try {
          const status = await knowledgeAssetService.getProcessingStatus(created.id);
          setProcessingStatus(status);
          if (
            (status.ocrStatus === 'COMPLETED' || status.ocrStatus === 'FAILED' || status.ocrStatus === 'SKIPPED') &&
            (status.embeddingStatus === 'INDEXED' || status.embeddingStatus === 'FAILED' || status.embeddingStatus === 'SKIPPED')
          ) {
            clearInterval(id);
            setPollInterval(null);
          }
        } catch {
          // ignore transient errors
        }
      }, 3000);
      setPollInterval(id);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to create knowledge asset.';
      setSubmitError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const STEPS = ['Details', 'File', 'Tags', 'AI Flags', 'Processing'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Knowledge Asset</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-3">
          {STEPS.map((label, idx) => {
            const num = (idx + 1) as Step;
            const done = num < step;
            const active = num === step;
            return (
              <div key={label} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
                      ${done ? 'bg-green-500 text-white' : active ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'}`}
                  >
                    {done ? '✓' : num}
                  </div>
                  <span className={`mt-1 text-xs ${active ? 'text-primary font-medium' : 'text-gray-400'}`}>
                    {label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`mx-1 mb-4 flex-1 border-t-2 ${done ? 'border-green-400' : 'border-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">

          {/* ── Step 1: Details ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="e.g. Saudi Labour Law 2024"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="Brief summary of this asset..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Asset Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.asset_type}
                    onChange={e => setForm(f => ({ ...f, asset_type: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  >
                    <option value="">Select type…</option>
                    {ASSET_TYPES.map(t => (
                      <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Jurisdiction</label>
                  <select
                    value={form.jurisdiction}
                    onChange={e => setForm(f => ({ ...f, jurisdiction: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  >
                    <option value="">Select jurisdiction…</option>
                    {JURISDICTIONS.map(j => (
                      <option key={j.code} value={j.code}>{j.label} ({j.code})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: File Upload ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Accepted formats: <strong>PDF, DOCX, JPG, PNG</strong>. Files are hashed on selection to detect duplicates.
              </p>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition
                  ${dragging ? 'border-primary bg-primary/5' : 'border-gray-300 bg-gray-50 hover:border-primary/60 hover:bg-primary/5'}`}
              >
                <svg className="mb-3 h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {form.file ? (
                  <p className="text-sm font-medium text-gray-800">{form.file.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-700">Drop file here or click to browse</p>
                    <p className="mt-1 text-xs text-gray-400">Max size: 50 MB</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.jpg,.jpeg,.png"
                  onChange={handleFileInput}
                />
              </div>

              {hashingFile && (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <LoadingSpinner size="sm" /> Checking for duplicates…
                </p>
              )}

              {fileError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {fileError}
                </div>
              )}

              {form.dupResult?.exists && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-medium text-amber-800">⚠ Duplicate file detected</p>
                  <p className="mt-1 text-sm text-amber-700">
                    This file already exists as "<strong>{form.dupResult.assetTitle}</strong>".
                    You can still proceed to create a new record, or go back to select a different file.
                  </p>
                </div>
              )}

              {form.file && !form.dupResult?.exists && !hashingFile && !fileError && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
                  ✓ No duplicates found — file is unique.
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Tags ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Add tags to make this asset easier to find. Click a suggestion or type your own.
              </p>

              {/* Chip input */}
              <div className="flex flex-wrap gap-2 rounded-lg border border-gray-300 p-2 focus-within:border-primary">
                {form.tags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-1 text-primary/60 hover:text-primary"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={form.tagInput}
                  onChange={e => setForm(f => ({ ...f, tagInput: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(form.tagInput);
                    }
                  }}
                  placeholder={form.tags.length === 0 ? 'Type a tag and press Enter…' : ''}
                  className="min-w-[120px] flex-1 bg-transparent text-sm outline-none"
                />
              </div>

              {/* Suggestions */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">Suggestions</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_TAGS.filter(t => !form.tags.includes(t)).map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addTag(tag)}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-primary hover:text-primary"
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: AI Flags ── */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Choose how the AI should use this asset. At least one option must be enabled.
              </p>

              <div className="space-y-3">
                {/* Risk Analysis toggle */}
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 p-4 hover:border-primary/40">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Include in Risk Analysis</p>
                    <p className="text-xs text-gray-500">AI will reference this asset when scoring contract risks.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, include_in_risk_analysis: !f.include_in_risk_analysis }))}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors
                      ${form.include_in_risk_analysis ? 'bg-primary' : 'bg-gray-200'}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform
                        ${form.include_in_risk_analysis ? 'translate-x-5' : 'translate-x-0.5'}`}
                    />
                  </button>
                </label>

                {/* Citations toggle */}
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 p-4 hover:border-primary/40">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Include in Citations</p>
                    <p className="text-xs text-gray-500">AI will cite this asset when generating clause recommendations.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, include_in_citations: !f.include_in_citations }))}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors
                      ${form.include_in_citations ? 'bg-primary' : 'bg-gray-200'}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform
                        ${form.include_in_citations ? 'translate-x-5' : 'translate-x-0.5'}`}
                    />
                  </button>
                </label>
              </div>

              {!form.include_in_risk_analysis && !form.include_in_citations && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                  At least one AI flag must be enabled.
                </p>
              )}

              {submitError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {submitError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 5: Processing Status ── */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-sm font-medium text-green-800">✓ Asset created successfully</p>
                <p className="mt-0.5 text-xs text-green-600">
                  The file is now queued for OCR text extraction and AI embedding. This may take a few minutes.
                </p>
              </div>

              {processingStatus ? (
                <div className="space-y-4">
                  {/* Progress bar */}
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-gray-500">
                      <span>Processing progress</span>
                      <span>{processingStatus.processingProgress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${processingStatus.processingProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* Status grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">OCR Status</p>
                      <OcrBadge status={processingStatus.ocrStatus} />
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">Embedding Status</p>
                      <EmbeddingBadge status={processingStatus.embeddingStatus} />
                    </div>
                  </div>

                  {processingStatus.detectedLanguages && processingStatus.detectedLanguages.length > 0 && (
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">Detected Languages</p>
                      <div className="flex flex-wrap gap-1.5">
                        {processingStatus.detectedLanguages.map(l => (
                          <LanguageBadge key={l} lang={l} />
                        ))}
                      </div>
                    </div>
                  )}

                  {processingStatus.processingProgress < 100 && (
                    <p className="flex items-center gap-2 text-sm text-gray-500">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                      Processing in the background. You can close this dialog — the asset is already saved.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <LoadingSpinner size="sm" />
                  Fetching processing status…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <button
            onClick={step === 1 || step === 5 ? onClose : () => setStep((s) => (s - 1) as Step)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            {step === 5 ? 'Close' : step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < 4 && (
            <button
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={!canProceed(step)}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}

          {step === 4 && (
            <button
              onClick={handleSubmit}
              disabled={submitting || !canProceed(4)}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <LoadingSpinner size="sm" />}
              {submitting ? 'Creating…' : 'Create Asset'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminKnowledgeAssetsPage() {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [embeddingFilter, setEmbeddingFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadAssets();
  }, [statusFilter, embeddingFilter, searchQuery]);

  const loadAssets = async () => {
    setLoading(true);
    try {
      const data = await knowledgeAssetService.getAll({
        review_status: statusFilter || undefined,
        embedding_status: embeddingFilter || undefined,
        search: searchQuery || undefined,
      });
      setAssets(data);
    } catch (err) {
      console.error('Failed to load assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleReview = async (id: string, status: string) => {
    try {
      await knowledgeAssetService.review(id, status);
      setAssets(assets.map(a => a.id === id ? { ...a, review_status: status as any } : a));
      showToast(`Asset ${status.toLowerCase().replace(/_/g, ' ')}.`);
    } catch (err) {
      console.error('Failed to review asset:', err);
      showToast('Failed to update review status.', 'error');
    }
  };

  const handleRetryOcr = async (id: string) => {
    setRetryingId(id);
    try {
      await knowledgeAssetService.retryOcr(id);
      setAssets(assets.map(a =>
        a.id === id ? { ...a, ocr_status: 'PENDING', embedding_status: 'PENDING' } : a
      ));
      showToast('OCR and embedding re-queued.');
    } catch {
      showToast('Failed to retry OCR.', 'error');
    } finally {
      setRetryingId(null);
    }
  };

  const handleAssetCreated = (asset: KnowledgeAsset) => {
    // Prepend new asset to the list
    setAssets(prev => [asset, ...prev]);
    showToast('Knowledge asset created successfully.');
  };

  const reviewFilterButtons = ['', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_APPROVED'];
  const embeddingFilterButtons = ['', 'PENDING', 'PROCESSING', 'INDEXED', 'FAILED'];

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg
          ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Upload modal */}
      {showModal && (
        <UploadModal
          onClose={() => setShowModal(false)}
          onSuccess={handleAssetCreated}
        />
      )}

      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('knowledgeAsset.reviewTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('knowledgeAsset.reviewSubtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Knowledge Asset
        </button>
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by title or description…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Filter rows */}
      <div className="mb-3 space-y-2">
        {/* Review status */}
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-medium text-gray-400">Review</span>
          <div className="flex flex-wrap gap-1.5">
            {reviewFilterButtons.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  statusFilter === status ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {status ? status.replace(/_/g, ' ') : 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* AI processing status */}
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-medium text-gray-400">AI Index</span>
          <div className="flex flex-wrap gap-1.5">
            {embeddingFilterButtons.map((s) => (
              <button
                key={s}
                onClick={() => setEmbeddingFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  embeddingFilter === s ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3">Asset</th>
                <th className="px-6 py-3">Type / Jurisdiction</th>
                <th className="px-6 py-3">Review Status</th>
                <th className="px-6 py-3">AI Processing</th>
                <th className="px-6 py-3">Flags</th>
                <th className="px-6 py-3">Uploaded By</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assets.map((asset) => (
                <tr key={asset.id} className="hover:bg-gray-50">
                  {/* Asset */}
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{asset.title}</p>
                    <p className="mt-0.5 max-w-xs truncate text-xs text-gray-400">
                      {asset.description || 'No description'}
                    </p>
                    {asset.tags && asset.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {asset.tags.slice(0, 3).map(tag => (
                          <span
                            key={tag}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                          >
                            {tag}
                          </span>
                        ))}
                        {asset.tags.length > 3 && (
                          <span className="text-xs text-gray-400">+{asset.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Type / Jurisdiction */}
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-700">{asset.asset_type.replace(/_/g, ' ')}</p>
                    {asset.jurisdiction && (
                      <span className="mt-1 inline-block rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-500">
                        {asset.jurisdiction}
                      </span>
                    )}
                  </td>

                  {/* Review status */}
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${reviewStatusColors[asset.review_status] || 'bg-gray-100'}`}>
                      {asset.review_status.replace(/_/g, ' ')}
                    </span>
                  </td>

                  {/* AI Processing */}
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <EmbeddingBadge status={asset.embedding_status} />
                      {asset.ocr_status && asset.ocr_status !== 'SKIPPED' && (
                        <OcrBadge status={asset.ocr_status} />
                      )}
                    </div>
                    {/* Language badges */}
                    {asset.detected_languages && asset.detected_languages.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {asset.detected_languages.map(l => (
                          <LanguageBadge key={l} lang={l} />
                        ))}
                      </div>
                    )}
                  </td>

                  {/* Flags */}
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <FlagBadge label="Risk" active={asset.include_in_risk_analysis} />
                      <FlagBadge label="Cite" active={asset.include_in_citations} />
                    </div>
                  </td>

                  {/* Uploaded by */}
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {asset.creator
                      ? `${asset.creator.first_name} ${asset.creator.last_name}`.trim() || '—'
                      : '—'}
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1.5">
                      {/* Retry OCR */}
                      {(asset.ocr_status === 'FAILED' || asset.embedding_status === 'FAILED') && (
                        <button
                          onClick={() => handleRetryOcr(asset.id)}
                          disabled={retryingId === asset.id}
                          className="rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-200 disabled:opacity-50"
                        >
                          {retryingId === asset.id ? 'Retrying…' : 'Retry OCR'}
                        </button>
                      )}
                      {/* Approve / Reject */}
                      {asset.review_status === 'PENDING_REVIEW' && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleReview(asset.id, 'APPROVED')}
                            className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-200"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReview(asset.id, 'REJECTED')}
                            className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {assets.length === 0 && (
            <div className="py-12 text-center">
              <svg className="mx-auto mb-3 h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-gray-500">No assets found matching the current filters.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
