import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { useAuth } from '@/hooks/useAuth';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import AppFooter from './AppFooter';
import LiveChatWidget from '@/components/support-chat/LiveChatWidget';

interface AppLayoutProps {
  navItems: { label: string; path: string; icon: string }[];
}

export default function AppLayout({ navItems }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // ── Mobile drawer state (Phase 6.4 Step 1 — < md only) ────────────────
  // Desktop (≥768px) ignores this entirely; CSS overrides the transform.
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { token, user } = useSelector((state: RootState) => state.auth);
  const { refreshUserProfile } = useAuth();

  // Restore user profile from token on page refresh.
  // The token is persisted in localStorage but state.user resets to null
  // on every page load — this re-hydrates it once from GET /auth/profile.
  useEffect(() => {
    if (token && !user) {
      refreshUserProfile();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close the mobile sidebar whenever the route changes ───────────────
  // Pure UX nicety on mobile; on desktop the sidebar isn't a drawer so this
  // is a no-op (mobileOpen stays false at all times above md).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      {/*
        Mobile overlay backdrop — only renders when the mobile drawer is open.
        Sits below the sidebar (z-30 vs z-40) but above main content.
        Hidden on md+ via Tailwind so the backdrop never appears on desktop
        even if `mobileOpen` were somehow true after a viewport resize.
      */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        items={navItems}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        onMobileMenuOpen={() => setMobileOpen(true)}
      />
      <main
        className={`pt-14 transition-all duration-300 ml-0 ${
          sidebarCollapsed
            ? 'md:ltr:ml-[68px] md:rtl:mr-[68px]'
            : 'md:ltr:ml-[240px] md:rtl:mr-[240px]'
        }`}
      >
        <div className="p-6 lg:p-8">
          <Outlet />
        </div>
        <AppFooter />
      </main>
      {/*
        Live Chat Support — floating bottom-right launcher. Visible on every
        /app/* page; the component itself hides for SYSTEM_ADMIN / OPERATIONS
        users (who use /admin/operations) and for unauthenticated states.
      */}
      <LiveChatWidget />
    </div>
  );
}
