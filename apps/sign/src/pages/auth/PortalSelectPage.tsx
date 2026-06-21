import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { LayoutDashboard, Briefcase, Eye, ChevronDown, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import { createGuestInvitation } from '@/services/api/guestService';

type PreviewContract = { id: string; name: string; status: string; projectName: string };

const GUEST_LANGS = ['en', 'ar', 'fr'];

export default function PortalSelectPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { i18n } = useTranslation();

  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    : '';

  // ── Dev/review-only guest-preview shortcut (NOT a production portal) ──────
  const [devOpen, setDevOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [contracts, setContracts] = useState<PreviewContract[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [minting, setMinting] = useState(false);

  // Gather the admin's org contracts. There is no org-wide contracts endpoint
  // (GET /contracts requires project_id), so we list the org's projects and
  // fan out to the per-project contracts list — both via the admin's own
  // authenticated, org-scoped calls. A per-project failure is swallowed so one
  // bad project never blanks the whole list.
  const loadContracts = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const projects = await projectService.getAll();
      const perProject = await Promise.all(
        projects.map((p) =>
          contractService
            .getAll(p.id)
            .then((cs) =>
              cs.map((c) => ({
                id: c.id,
                name: c.name,
                status: String(c.status),
                projectName: p.name,
              })),
            )
            .catch(() => [] as PreviewContract[]),
        ),
      );
      setContracts(perProject.flat());
      setLoaded(true);
    } catch {
      setLoadError(true);
      toast.error('Could not load your contracts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleDev = () => {
    const next = !devOpen;
    setDevOpen(next);
    if (next && !loaded && !loading) void loadContracts();
  };

  // Mint a real guest invitation for the picked contract using the admin's own
  // authenticated client + permissions (the backend walls minting to contracts
  // the org owns), then open the public guest viewer with the fresh token.
  // We pass the admin's current UI language so the preview opens in that
  // language and doesn't reset the admin's session language on return.
  const openPreview = async () => {
    if (!selectedId || minting) return;
    setMinting(true);
    try {
      const invited_language = GUEST_LANGS.includes(i18n.language)
        ? i18n.language
        : undefined;
      const { token } = await createGuestInvitation({
        contract_id: selectedId,
        invited_email: 'dev-preview@example.com',
        invited_language,
      });
      navigate(`/guest/invitation/${token}`);
    } catch {
      toast.error(
        'Could not open the guest preview. You may not have permission to invite for this contract.',
      );
      setMinting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 flex flex-col items-center gap-6 w-full max-w-md">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <LayoutDashboard className="h-7 w-7 text-primary" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-navy-900">Choose Portal</h1>
          <p className="mt-2 text-sm text-gray-500">
            {displayName ? `Welcome, ${displayName}.` : 'Welcome.'} Where would you like to go?
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          <button
            type="button"
            onClick={() => { sessionStorage.setItem('portal-chosen', '1'); navigate('/admin/dashboard', { replace: true }); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white transition hover:bg-primary-600"
          >
            <LayoutDashboard className="h-4 w-4" />
            Admin Dashboard
          </button>
          <button
            type="button"
            onClick={() => { sessionStorage.setItem('portal-chosen', '1'); navigate('/app/dashboard', { replace: true }); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary py-3 font-semibold text-primary transition hover:bg-primary/5"
          >
            <Briefcase className="h-4 w-4" />
            Client Portal
          </button>
        </div>

        {/*
          Dev/review-only shortcut to the public guest viewer. Intentionally
          styled distinct from the two real portals (dashed muted card + "DEV"
          tag) — it is NOT a production portal entry. Gated behind
          `import.meta.env.DEV` so it renders only in dev builds (npm run dev /
          the :5173 dev container) and is tree-shaken out of production builds.
        */}
        {import.meta.env.DEV && (
        <div className="w-full rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-3">
          <button
            type="button"
            onClick={toggleDev}
            aria-expanded={devOpen}
            className="flex w-full items-center justify-between gap-2 text-sm font-medium text-gray-500 transition hover:text-gray-700"
          >
            <span className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Guest Portal (Dev Preview)
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                Dev
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${devOpen ? 'rotate-180' : ''}`} />
          </button>

          {devOpen && (
            <div className="mt-3 flex flex-col gap-2">
              {loading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading contracts…
                </div>
              ) : loadError ? (
                <p className="py-2 text-sm text-red-600">
                  Could not load your contracts.{' '}
                  <button type="button" onClick={loadContracts} className="font-medium underline">
                    Retry
                  </button>
                </p>
              ) : contracts.length === 0 ? (
                <p className="py-2 text-sm text-gray-400">
                  Your organization has no contracts to preview.
                </p>
              ) : (
                <>
                  <select
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    dir="auto"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none"
                  >
                    <option value="">Select a contract…</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.projectName} [{c.status}]
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={openPreview}
                    disabled={!selectedId || minting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-700 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:opacity-50"
                  >
                    {minting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Opening…
                      </>
                    ) : (
                      <>
                        <Eye className="h-4 w-4" />
                        Open guest viewer
                      </>
                    )}
                  </button>
                  <p className="text-[11px] text-gray-400">
                    Mints a real guest invitation for the selected contract using your own
                    permissions, then opens the public guest viewer.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
