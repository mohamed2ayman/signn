import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

interface AppLayoutProps {
  navItems: { label: string; path: string; icon: string }[];
}

export default function AppLayout({ navItems }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
    </div>
  );
}
