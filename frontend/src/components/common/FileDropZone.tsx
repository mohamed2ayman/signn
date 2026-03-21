import { useState, useRef, useCallback } from 'react';

interface FileDropZoneProps {
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxSizeMB?: number;
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.ms-powerpoint': 'PPT',
  'text/plain': 'TXT',
};

function getFileTypeLabel(file: File): string {
  return (
    FILE_TYPE_ICONS[file.type] ||
    file.name.split('.').pop()?.toUpperCase() ||
    'FILE'
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileDropZone({
  accept = '.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt',
  multiple = true,
  maxFiles = 10,
  maxSizeMB = 50,
  onFilesSelected,
  disabled = false,
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = useCallback(
    (newFiles: FileList | File[]) => {
      setError('');
      const fileArray = Array.from(newFiles);

      // Check count
      const totalFiles = files.length + fileArray.length;
      if (totalFiles > maxFiles) {
        setError(`Maximum ${maxFiles} files allowed`);
        return;
      }

      // Check size
      const oversized = fileArray.find(
        (f) => f.size > maxSizeMB * 1024 * 1024,
      );
      if (oversized) {
        setError(`${oversized.name} exceeds ${maxSizeMB}MB limit`);
        return;
      }

      const updated = [...files, ...fileArray];
      setFiles(updated);
      onFilesSelected(updated);
    },
    [files, maxFiles, maxSizeMB, onFilesSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      validateAndAddFiles(e.dataTransfer.files);
    },
    [disabled, validateAndAddFiles],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        validateAndAddFiles(e.target.files);
      }
    },
    [validateAndAddFiles],
  );

  const removeFile = useCallback(
    (index: number) => {
      const updated = files.filter((_, i) => i !== index);
      setFiles(updated);
      onFilesSelected(updated);
    },
    [files, onFilesSelected],
  );

  return (
    <div>
      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
          disabled
            ? 'cursor-not-allowed border-gray-200 bg-gray-50'
            : isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-gray-300 bg-white hover:border-primary/50 hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInput}
          className="hidden"
          disabled={disabled}
        />
        <div className="flex flex-col items-center gap-3">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full ${
              isDragOver ? 'bg-primary/10' : 'bg-gray-100'
            }`}
          >
            <svg
              className={`h-7 w-7 ${isDragOver ? 'text-primary' : 'text-gray-400'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">
              {isDragOver
                ? 'Drop files here'
                : 'Drag & drop files here, or click to browse'}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              PDF, Word, Excel, PowerPoint, or Text files (max {maxSizeMB}MB
              each)
            </p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  {getFileTypeLabel(file)}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatFileSize(file.size)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(index);
                }}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
