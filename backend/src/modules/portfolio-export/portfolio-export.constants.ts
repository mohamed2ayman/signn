/**
 * Phase 7.17 Prompt 2c — single source of truth for the portfolio export
 * TTL and audit retention window.
 *
 * The TTL constant is read by:
 *   - PortfolioExportTokenService.issue() — token's signed expires_at
 *   - The processor (Bucket 2) — mirrored to PortfolioExportJob.expires_at
 *     on COMPLETED so DB and token agree
 *   - PortfolioExportCleanupCron (Bucket 3) — deletes files whose
 *     expires_at < NOW()
 *
 * Coupling files unreachability to file deletability is by design: a token
 * past its expiry is rejected (410 Gone); the file's deletion follows the
 * same moment. Changing the TTL cascades automatically to both paths.
 *
 * Why 1 hour (not 24h, not 30min):
 *   - 24h was rejected at plan review (D1) — the partial-download trap
 *     under flaky MENA mobile networks made nonce-based single-use punish
 *     legitimate users while barely protecting against attackers. Reusable
 *     within a short TTL is the safer trade.
 *   - 1h gives ≈ 4× headroom over the realistic ~15-min download window
 *     for users actively expecting the email, and compresses the
 *     deactivated-user residual exposure window (Edge #7) to <1h.
 *   - 30min would push too many legitimate users into "missed it →
 *     re-export" UX. 1h keeps that uncommon.
 */
export const PORTFOLIO_EXPORT_TTL_HOURS = 1;
export const PORTFOLIO_EXPORT_TTL_MS =
  PORTFOLIO_EXPORT_TTL_HOURS * 60 * 60 * 1000;

/**
 * How long the audit row is kept past file deletion. The file is gone at
 * expires_at; the row stays this many days longer so security-event audit
 * (`portfolio_export.download.*`) can correlate a leaked-URL download
 * attempt to its origin even after the file is unreachable.
 */
export const PORTFOLIO_EXPORT_AUDIT_RETENTION_DAYS = 7;
