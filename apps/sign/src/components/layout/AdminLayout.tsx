import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import useAuth from '@/hooks/useAuth';
import { UserRole } from '@/types';
import { notificationService } from '@/services/api/notificationService';
import LanguageToggle from '@/components/common/LanguageToggle';
import SignLogo from '@/components/common/SignLogo';

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AdminLayout — Hybrid layout for the Admin Portal (/admin/*).
 *
 *  Slim 48px top utility bar  +  64px icon-only side rail.
 *    · Top bar holds: logo + "Admin Portal" label · search · language ·
 *      notifications · user menu · CENVOX backlink.
 *    · Side rail holds ONLY navigation — icons with hover tooltips,
 *      grouped with thin dividers. No labels in the rail itself.
 *
 *  Client Portal (/app/*) and Guest Portal (/contractor/*) still use
 *  AppLayout.tsx with their own sidebars; this file doesn't affect them.
 *
 *  Role-based visibility:
 *    SYSTEM_ADMIN sees every nav item.
 *    OPERATIONS hides: Organizations, Plans, Billing, Audit Log.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Heroicons-style stroke SVG wrapper ─────────────────────────────────
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

// ── Icon paths keyed by nav-id ─────────────────────────────────────────
const ICONS = {
  dashboard: (
    <path d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  ),
  operationsReview: (
    <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 3.375 3.375 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  ),
  support: (
    <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
  ),
  operations: (
    <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  ),
  knowledgeAssets: (
    <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  ),
  users: (
    <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  ),
  organizations: (
    <path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
  ),
  plans: (
    <path d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
  ),
  analytics: (
    <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  ),
  billing: (
    <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.172-.879-1.172-2.303 0-3.182.878-.659 2.122-.659 3 0M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  ),
  riskRules: (
    <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  ),
  permissionDefaults: (
    <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  ),
  auditLog: (
    <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  ),
  storeAnalytics: (
    <path d="M13.5 21V11.25a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .414.336.75.75.75z" />
  ),
} as const;

// ── Nav item model ─────────────────────────────────────────────────────
interface AdminNavItem {
  label: string;                    // i18n key
  path: string;                     // absolute path under /admin
  icon: React.ReactNode;            // stroke <path> element
  opsHidden?: boolean;              // hide for UserRole.OPERATIONS
}

// Groups stay equal-importance — dividers are visual breaks, not rank.
const NAV_GROUPS: AdminNavItem[][] = [
  // Group 1 — Operations (daily workflow)
  [
    { label: 'nav.dashboard',        path: '/admin/dashboard',        icon: ICONS.dashboard },
    { label: 'nav.operationsReview', path: '/admin/operations-review', icon: ICONS.operationsReview },
    { label: 'nav.operations',       path: '/admin/operations',       icon: ICONS.operations },
    { label: 'nav.support',          path: '/admin/support',          icon: ICONS.support },
    { label: 'nav.knowledgeAssets',  path: '/admin/knowledge-assets', icon: ICONS.knowledgeAssets },
  ],
  // Group 2 — Management
  [
    { label: 'nav.users',         path: '/admin/users',         icon: ICONS.users },
    { label: 'nav.organizations', path: '/admin/organizations', icon: ICONS.organizations, opsHidden: true },
    { label: 'nav.plans',         path: '/admin/plans',         icon: ICONS.plans,         opsHidden: true },
  ],
  // Group 3 — Insights
  [
    { label: 'nav.analytics', path: '/admin/analytics', icon: ICONS.analytics },
    { label: 'nav.billing',   path: '/admin/billing',   icon: ICONS.billing,   opsHidden: true },
  ],
  // Group 4 — Configuration (pushed to bottom via mt-auto on the group)
  [
    { label: 'nav.riskRules',          path: '/admin/risk-rules',          icon: ICONS.riskRules },
    { label: 'nav.permissionDefaults', path: '/admin/permission-defaults', icon: ICONS.permissionDefaults },
    { label: 'nav.auditLog',           path: '/admin/audit-logs',          icon: ICONS.auditLog,       opsHidden: true },
    { label: 'nav.storeAnalytics',     path: '/admin/store-analytics',     icon: ICONS.storeAnalytics },
  ],
];

function isActivePath(currentPath: string, itemPath: string): boolean {
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/');
}

// ── Tooltip state — tracks hovered path and anchor's viewport top ──────
interface TooltipState {
  label: string;
  top: number; // pixel Y of the anchor's vertical midpoint
}

export default function AdminLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, refreshUserProfile } = useAuth();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  const [unreadCount, setUnreadCount] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const userMenuRef = useRef<HTMLDivElement>(null);

  // ── Re-hydrate user profile from token on page refresh (same as AppLayout) ──
  useEffect(() => {
    if (isAuthenticated && !user) {
      refreshUserProfile();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Show portal chooser for admin users who skipped the login flow ────
  // (e.g. navigating directly to /admin with an existing session)
  useEffect(() => {
    if (!user) return;
    const isAdminRole = user.role === UserRole.SYSTEM_ADMIN || user.role === UserRole.OPERATIONS;
    const alreadyChose = sessionStorage.getItem('portal-chosen') === '1';
    if (isAdminRole && !alreadyChose) {
      navigate('/portal-select', { replace: true });
    }
  }, [user, navigate]);

  // ── Fetch unread notifications once on mount ─────────────────────────
  useEffect(() => {
    notificationService.getUnreadCount()
      .then((data) => setUnreadCount(data.count))
      .catch(() => {});
  }, []);

  // ── Close user dropdown on outside click ─────────────────────────────
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Close user dropdown + tooltip on route change ────────────────────
  useEffect(() => {
    setShowUserMenu(false);
    setTooltip(null);
  }, [location.pathname]);

  // ── Role-based filter ─────────────────────────────────────────────────
  const isOperations = user?.role === UserRole.OPERATIONS;

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS
        .map((group) => (isOperations ? group.filter((i) => !i.opsHidden) : group))
        .filter((group) => group.length > 0),
    [isOperations],
  );

  const handleLogout = async () => {
    sessionStorage.removeItem('portal-chosen');
    await logout();
    navigate('/auth/login', { replace: true });
  };

  const handleNavMouseEnter = (event: React.MouseEvent<HTMLElement>, label: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2 });
  };

  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`;
  const roleLabel = user?.role ? String(user.role).replace(/_/g, ' ') : '';

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      {/* ═══ TOP UTILITY BAR (48px, fixed, full width) ═══ */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex h-12 items-center justify-between bg-[#0f172a] px-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* ── Left: logo + label ── */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link to="/admin/dashboard" className="flex items-center gap-2">
            <SignLogo size="sm" variant="dark" iconOnly />
            <span className="text-[14px] font-medium text-white tracking-wide">
              {t('portal.admin', 'Admin Portal')}
            </span>
          </Link>
          <div
            className="h-5 w-px flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          />
        </div>

        {/* ── Right: search, language, bell, user, CENVOX ── */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Search */}
          <div className="relative hidden md:block">
            <input
              type="text"
              placeholder={t('common.search', 'Search...')}
              className="h-8 w-[200px] rounded-lg bg-white/5 pl-8 pr-3 text-[13px] text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-primary-400/30 transition"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <LanguageToggle />

          {/* Notifications */}
          <button
            type="button"
            onClick={() => navigate('/admin/dashboard')}
            className="relative h-8 w-8 rounded-lg flex items-center justify-center text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title={t('nav.notifications')}
          >
            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* User avatar + dropdown */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setShowUserMenu((s) => !s)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3b82f6] text-[12px] font-semibold text-white transition-colors hover:bg-[#2563eb]"
              title={`${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim()}
            >
              {initials || '?'}
            </button>

            {showUserMenu && (
              <div className="absolute top-full right-0 mt-1.5 min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg z-[60]">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {user?.first_name} {user?.last_name}
                  </p>
                  {roleLabel && (
                    <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-wider text-primary-600 bg-primary/10 px-1.5 py-0.5 rounded">
                      {roleLabel}
                    </span>
                  )}
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { navigate('/admin/account-settings'); setShowUserMenu(false); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {t('nav.accountSettings', 'Account Settings')}
                  </button>
                </div>
                <div className="border-t border-gray-100 pt-1">
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                  >
                    <svg className="h-4 w-4 text-red-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                    </svg>
                    {t('auth.logout')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* CENVOX backlink (small muted, furthest right) */}
          <a
            href="http://localhost:5174"
            className="cenvox-backlink ml-2 text-[12px] transition-colors"
            style={{ color: 'rgba(255,255,255,0.3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
          >
            &larr; CENVOX
          </a>
        </div>
      </header>

      {/* ═══ BODY (sidebar + main) ═══ */}
      <div className="flex flex-1 pt-12">
        {/* ── Icon sidebar (64px, fixed below top bar) ── */}
        <aside
          className="fixed left-0 top-12 bottom-0 z-40 flex w-16 flex-col bg-[#0f172a] py-2"
          style={{ borderRight: '1px solid rgba(255,255,255,0.06)', overflow: 'visible' }}
        >
          {visibleGroups.map((group, groupIdx) => {
            const isLast = groupIdx === visibleGroups.length - 1;
            return (
              <div
                key={groupIdx}
                className={`flex flex-col ${isLast ? 'mt-auto' : ''}`}
              >
                {groupIdx > 0 && (
                  <div
                    className="my-1 mx-3 h-px"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  />
                )}
                {group.map((item) => {
                  const active = isActivePath(location.pathname, item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onMouseEnter={(e) => handleNavMouseEnter(e, t(item.label))}
                      onMouseLeave={() => setTooltip(null)}
                      aria-label={t(item.label)}
                      className={`relative flex h-11 w-full items-center justify-center transition-colors ${
                        active
                          ? 'text-[#60a5fa]'
                          : 'text-white/40 hover:bg-white/5 hover:text-white/80'
                      }`}
                      style={
                        active
                          ? {
                              background: 'rgba(59,130,246,0.15)',
                              borderLeft: '2px solid #3b82f6',
                              borderRadius: 0,
                            }
                          : undefined
                      }
                    >
                      <Icon>{item.icon}</Icon>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </aside>

        {/* ── Tooltip (fixed, renders beside the hovered icon) ── */}
        {tooltip && (
          <div
            className="pointer-events-none fixed rounded bg-[#1e293b] px-2 py-1 text-[12px] text-white whitespace-nowrap shadow-md"
            style={{
              left: 72,                         // 64px rail + 8px gap
              top: tooltip.top,
              transform: 'translateY(-50%)',
              zIndex: 100,
            }}
          >
            {tooltip.label}
          </div>
        )}

        {/* ── Main content (offset by 64px sidebar) ── */}
        <main className="flex-1" style={{ marginLeft: 64, minHeight: 'calc(100vh - 48px)' }}>
          <div className="px-8 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
