import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import { RootState } from '@/store';
import useAuth from '@/hooks/useAuth';
import { notificationService } from '@/services/api/notificationService';
import LanguageToggle from '@/components/common/LanguageToggle';
import { ManagexMark } from '@/components/common/ManagexLogo';

interface TopBarProps {
  sidebarCollapsed?: boolean;
  // ── Phase 6.4 Step 1 — opens the mobile sidebar drawer (< md only) ────
  // Optional so existing call sites that don't pass it (none in-tree, but
  // future ones) keep compiling; the hamburger no-ops if undefined.
  onMobileMenuOpen?: () => void;
}

export default function TopBar({ sidebarCollapsed = false, onMobileMenuOpen }: TopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const user = useSelector((state: RootState) => state.auth.user);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const manageXUrl = import.meta.env.VITE_MANAGEX_URL || 'http://localhost:5175';

  // ── Phase 7.1 Step 4 — Unread count via React Query ────────────────
  // Shared queryKey ['notifications', 'unread-count'] with AdminLayout so
  // both bell badges read from the same cache. NotificationsPage mutations
  // invalidate the 'notifications' prefix; this badge updates instantly.
  // refetchIntervalInBackground: false pauses polling when the tab is
  // hidden so we don't hammer the API for inactive users.
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationService.getUnreadCount(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const unreadCount = unreadData?.count ?? 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/auth/login');
  };

  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`;

  return (
    <header
      className={`fixed top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200/80 bg-white/80 backdrop-blur-md px-6 transition-all duration-300 left-0 right-0 ${
        // Default (mobile, any direction): full-width via `left-0 right-0`.
        // Desktop: pin the sidebar-side edge to the sidebar's inner offset.
        // The far edge stays at 0 (inherited from the base classes).
        sidebarCollapsed
          ? 'md:ltr:left-[68px] md:rtl:right-[68px]'
          : 'md:ltr:left-[240px] md:rtl:right-[240px]'
      }`}
    >
      {/* Left section */}
      <div className="flex items-center gap-4">
        {/*
          Mobile hamburger — opens the sidebar drawer below md.
          Hidden on desktop (md+) where the sidebar is permanently visible.
          44×44 touch target per WCAG / iOS HIG minimum.
        */}
        <button
          type="button"
          onClick={onMobileMenuOpen}
          aria-label={t('nav.openMenu', 'Open menu')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 transition-colors hover:bg-gray-100 md:hidden ltr:-ml-2 rtl:-mr-2"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        {/* MANAGEX back-link — also hidden < 768 via .managex-backlink CSS (styles/index.css:112) */}
        <a href={manageXUrl} className="managex-backlink" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} aria-label="Back to ManageX">
          <ManagexMark size={16} onLight={true} />
          <span>&larr; MANAGEX</span>
        </a>

        {/* Search — hidden on mobile; the 288px input would overflow a 375px viewport */}
        <div className="relative hidden md:block">
          <input
            type="text"
            placeholder={t('common.search')}
            className="w-72 rounded-lg border border-gray-200 bg-gray-50/80 py-[7px] text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 ltr:pl-9 ltr:pr-4 rtl:pr-9 rtl:pl-4 transition"
          />
          <svg
            className="absolute top-[9px] h-4 w-4 text-gray-400 ltr:left-3 rtl:right-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1">
        <LanguageToggle />

        {/* Notifications */}
        <button
          onClick={() => navigate('/app/notifications')}
          className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white ltr:right-1 rtl:left-1">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Separator */}
        <div className="mx-2 h-6 w-px bg-gray-200" />

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-gray-800 leading-tight">
                {user?.first_name} {user?.last_name}
              </p>
            </div>
            <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showUserMenu && (
            <div className="absolute mt-1.5 w-52 rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg ltr:right-0 rtl:left-0">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
              <div className="py-1">
                <button
                  onClick={() => { navigate('/app/profile'); setShowUserMenu(false); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  {t('nav.profile')}
                </button>
                <button
                  onClick={() => { navigate('/app/settings/billing'); setShowUserMenu(false); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                  </svg>
                  Billing
                </button>
                <button
                  onClick={() => { navigate('/app/onboarding'); setShowUserMenu(false); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l2.121-2.122" />
                  </svg>
                  Restart Tour
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
      </div>
    </header>
  );
}
