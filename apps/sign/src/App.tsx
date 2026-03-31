import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/common/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';
import { UserRole } from '@/types';

// Landing page (public)
import LandingPage from '@/pages/LandingPage';

// Auth pages
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import AcceptInvitationPage from '@/pages/auth/AcceptInvitationPage';

// Owner portal pages
import DashboardPage from '@/pages/app/DashboardPage';
import ProjectsPage from '@/pages/app/ProjectsPage';
import ProjectCreationPage from '@/pages/app/ProjectCreationPage';
import ProjectDetailPage from '@/pages/app/ProjectDetailPage';
import ContractDetailPage from '@/pages/app/ContractDetailPage';
import ClauseReviewPage from '@/pages/app/ClauseReviewPage';
import ClausesPage from '@/pages/app/ClausesPage';
import KnowledgeAssetsPage from '@/pages/app/KnowledgeAssetsPage';
import ObligationsPage from '@/pages/app/ObligationsPage';
import NotificationsPage from '@/pages/app/NotificationsPage';
import OnboardingPage from '@/pages/app/OnboardingPage';
import SupportPage from '@/pages/app/SupportPage';
import BillingPage from '@/pages/app/BillingPage';
import TeamPage from '@/pages/app/TeamPage';
import ProfilePage from '@/pages/app/ProfilePage';
import ProjectPermissionsPage from '@/pages/app/ProjectPermissionsPage';

// Admin portal pages
import AdminDashboardPage from '@/pages/admin/AdminDashboardPage';
import AdminKnowledgeAssetsPage from '@/pages/admin/AdminKnowledgeAssetsPage';
import AdminSupportPage from '@/pages/admin/AdminSupportPage';
import PermissionDefaultsPage from '@/pages/admin/PermissionDefaultsPage';

// Contractor portal pages
import ContractorDashboardPage from '@/pages/contractor/ContractorDashboardPage';
import AcceptPartyInvitationPage from '@/pages/contractor/AcceptInvitationPage';

// ─── 404 page ────────────────────────────────────────────────
function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <h1 className="text-6xl font-bold text-primary">404</h1>
      <p className="mt-4 text-lg text-gray-600">Page not found</p>
      <a
        href="/"
        className="mt-6 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
      >
        Go Home
      </a>
    </div>
  );
}

// ─── Role groups ─────────────────────────────────────────────
const ADMIN_ROLES: UserRole[] = [UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS];
const OWNER_ROLES: UserRole[] = [
  UserRole.OWNER_ADMIN,
  UserRole.OWNER_CREATOR,
  UserRole.OWNER_REVIEWER,
];
const CONTRACTOR_ROLES: UserRole[] = [
  UserRole.CONTRACTOR_ADMIN,
  UserRole.CONTRACTOR_CREATOR,
  UserRole.CONTRACTOR_REVIEWER,
  UserRole.CONTRACTOR_TENDERING,
];

// ─── Navigation items ────────────────────────────────────────
const ownerNavItems = [
  { label: 'nav.dashboard', path: '/app/dashboard', icon: '📊' },
  { label: 'nav.projects', path: '/app/projects', icon: '📁' },
  { label: 'nav.clauses', path: '/app/clauses', icon: '📝' },
  { label: 'nav.knowledge', path: '/app/knowledge-assets', icon: '📚' },
  { label: 'nav.obligations', path: '/app/obligations', icon: '📋' },
  { label: 'nav.notifications', path: '/app/notifications', icon: '🔔' },
  { label: 'nav.team', path: '/app/team', icon: '👥' },
  { label: 'nav.profile', path: '/app/profile', icon: '👤' },
  { label: 'nav.support', path: '/app/support', icon: '💬' },
];

const adminNavItems = [
  { label: 'nav.dashboard', path: '/admin/dashboard', icon: '📊' },
  { label: 'nav.knowledgeAssets', path: '/admin/knowledge-assets', icon: '📚' },
  { label: 'nav.subscriptions', path: '/admin/subscriptions', icon: '💳' },
  { label: 'nav.users', path: '/admin/users', icon: '👥' },
  { label: 'nav.riskRules', path: '/admin/risk-rules', icon: '⚠️' },
  { label: 'nav.permissionDefaults', path: '/admin/permission-defaults', icon: '🛡️' },
  { label: 'nav.support', path: '/admin/support', icon: '💬' },
];

const contractorNavItems = [
  { label: 'nav.dashboard', path: '/contractor/dashboard', icon: '📊' },
  { label: 'nav.contracts', path: '/contractor/contracts', icon: '📄' },
  { label: 'nav.notifications', path: '/contractor/notifications', icon: '🔔' },
];

function App() {
  return (
    <Routes>
      {/* Public landing page */}
      <Route path="/" element={<LandingPage />} />

      {/* Auth routes (public) */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/accept-invitation" element={<AcceptInvitationPage />} />

      {/* Public contractor invitation route (no auth) */}
      <Route path="/invitation/accept" element={<AcceptPartyInvitationPage />} />

      {/* ─── Owner Portal (/app/*) ─── */}
      <Route
        path="/app"
        element={
          <ProtectedRoute allowedRoles={OWNER_ROLES}>
            <AppLayout navItems={ownerNavItems} />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<ProjectCreationPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="projects/:id/permissions" element={<ProjectPermissionsPage />} />
        <Route path="contracts/:id" element={<ContractDetailPage />} />
        <Route path="contracts/:id/review" element={<ClauseReviewPage />} />
        <Route path="clauses" element={<ClausesPage />} />
        <Route path="knowledge-assets" element={<KnowledgeAssetsPage />} />
        <Route path="obligations" element={<ObligationsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings/billing" element={<BillingPage />} />
      </Route>

      {/* ─── Admin Portal (/admin/*) ─── */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <AppLayout navItems={adminNavItems} />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="knowledge-assets" element={<AdminKnowledgeAssetsPage />} />
        <Route path="permission-defaults" element={<PermissionDefaultsPage />} />
        <Route path="support" element={<AdminSupportPage />} />
      </Route>

      {/* ─── Contractor Portal (/contractor/*) ─── */}
      <Route
        path="/contractor"
        element={
          <ProtectedRoute allowedRoles={CONTRACTOR_ROLES}>
            <AppLayout navItems={contractorNavItems} />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/contractor/dashboard" replace />} />
        <Route path="dashboard" element={<ContractorDashboardPage />} />
      </Route>

      {/* 404 catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
