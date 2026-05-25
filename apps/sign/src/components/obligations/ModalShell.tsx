import { useEffect } from 'react';

/**
 * Shared centered-card modal shell used by every obligation modal
 * (AddEdit, MarkActioned, Assign).
 *
 * - White rounded card centred over a black/50 backdrop.
 * - Click-outside + Escape close.
 * - Max-width opt-in per modal (default = max-w-lg).
 * - Mobile responsive: full-width with edge padding at < sm.
 *
 * Design pattern lifted from the codebase's existing modals
 * (e.g. ProjectDetailPage's "Create Contract" multi-step modal)
 * but consolidated so every obligation modal looks identical.
 */
export default function ModalShell({
  isOpen,
  onClose,
  title,
  subtitle,
  size = 'md',
  children,
  footer,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Escape-to-close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Lock body scroll while open — prevents background from scrolling
  // behind a long modal on mobile.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClass =
    size === 'sm'
      ? 'max-w-md'
      : size === 'md'
      ? 'max-w-lg'
      : size === 'lg'
      ? 'max-w-2xl'
      : 'max-w-4xl';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[calc(100vh-2rem)] w-full ${sizeClass} flex-col overflow-hidden rounded-xl bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="modal-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            {subtitle && (
              <p
                className="mt-0.5 text-sm text-gray-600"
                dir="auto"
                style={{ unicodeBidi: 'plaintext' }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Footer (optional) */}
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
