import { useRef } from 'react';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — must mirror server cap
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

interface Props {
  onPick: (file: File) => void;
  disabled?: boolean;
}

/**
 * Tiny "paperclip" file picker for the live-chat composer.
 * Mirrors the server validation (10MB / whitelist) so we fail fast in-browser.
 */
export default function AttachmentButton({ onPick, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_BYTES) {
      alert(`File too large (max 10 MB). Got ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      alert(`File type not allowed: ${file.type || 'unknown'}.`);
      return;
    }
    onPick(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        title="Attach file (max 10 MB)"
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        📎
      </button>
    </>
  );
}
