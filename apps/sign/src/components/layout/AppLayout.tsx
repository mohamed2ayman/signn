import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { useAuth } from '@/hooks/useAuth';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import LiveChatWidget from '@/components/support-chat/LiveChatWidget';

interface AppLayoutProps {
  navItems: { label: string; path: string; icon: string }[];
}

export default function AppLayout({ navItems }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        items={navItems}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <TopBar sidebarCollapsed={sidebarCollapsed} />
      <main
        className={`pt-14 transition-all duration-300 ${
          sidebarCollapsed
            ? 'ltr:ml-[68px] rtl:mr-[68px]'
            : 'ltr:ml-[240px] rtl:mr-[240px]'
        }`}
      >
        <div className="p-6 lg:p-8">
          <Outlet />
        </div>
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
