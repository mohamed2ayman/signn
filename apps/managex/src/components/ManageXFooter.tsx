const SIGN_URL = import.meta.env.VITE_SIGN_APP_URL || 'http://localhost:5173';

/**
 * MANAGEX minimal legal footer. One-line layout. All links point
 * to SIGN's legal pages — SIGN owns the policies; MANAGEX is the
 * brand surface that links to them.
 */
export default function ManageXFooter() {
  return (
    <div className="mx-legal-footer" role="contentinfo">
      <span>© 2026 SIGN Technologies LLC</span>
      <span aria-hidden="true">·</span>
      <a href={`${SIGN_URL}/legal/privacy`} target="_blank" rel="noopener noreferrer">
        Privacy Policy
      </a>
      <span aria-hidden="true">·</span>
      <a href={`${SIGN_URL}/legal/terms`} target="_blank" rel="noopener noreferrer">
        Terms
      </a>
      <span aria-hidden="true">·</span>
      <a href={`${SIGN_URL}/legal/cookies`} target="_blank" rel="noopener noreferrer">
        Cookie Settings
      </a>
    </div>
  );
}
