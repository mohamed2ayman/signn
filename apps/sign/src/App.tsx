import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/common/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';
import AdminLayout from '@/components/layout/AdminLayout';
import { UserRole } from '@/types';

// Landing page (public)
import LandingPage from '@/pages/LandingPage';

// Auth pages
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import AcceptInvitationPage from '@/pages/auth/AcceptInvitationPage';
import PortalSelectPage from '@/pages/auth/PortalSelectPage';

// Client Portal pages
import DashboardPage from '@/pages/app/DashboardPage';
import PortfolioPage from '@/pages/app/PortfolioPage';
import ProjectsPage from '@/pages/app/ProjectsPage';
import SharedWithMePage from '@/pages/app/SharedWithMePage';
import ProjectCreationPage from '@/pages/app/ProjectCreationPage';
import ProjectDetailPage from '@/pages/app/ProjectDetailPage';
import ContractDetailPage from '@/pages/app/ContractDetailPage';
import ClauseReviewPage from '@/pages/app/ClauseReviewPage';
import ClausesPage from '@/pages/app/ClausesPage';
import KnowledgeAssetsPage from '@/pages/app/KnowledgeAssetsPage';
import ObligationsPage from '@/pages/app/ObligationsPage';
import ErpConnectionsPage from '@/pages/app/ErpConnectionsPage';
import ObligationsCalendarPage from '@/pages/app/ObligationsCalendarPage';
import NotificationsPage from '@/pages/app/NotificationsPage';
import OnboardingPage from '@/pages/app/OnboardingPage';
import SupportPage from '@/pages/app/SupportPage';
import BillingPage from '@/pages/app/BillingPage';
import SubscriptionSettingsPage from '@/pages/app/SubscriptionSettingsPage';
import ApprovalsPage from '@/pages/app/ApprovalsPage';
import TeamPage from '@/pages/app/TeamPage';
import ProfilePage from '@/pages/app/ProfilePage';
import MfaSetupPage from '@/pages/app/MfaSetupPage';
import ProjectPermissionsPage from '@/pages/app/ProjectPermissionsPage';
import ContractStorePage from '@/pages/app/ContractStorePage';
import ContractStoreDetailPage from '@/pages/app/ContractStoreDetailPage';

// Admin Portal pages
import AdminDashboardPage from '@/pages/admin/AdminDashboardPage';
import AdminKnowledgeAssetsPage from '@/pages/admin/AdminKnowledgeAssetsPage';
import AdminSupportPage from '@/pages/admin/AdminSupportPage';
import AdminUsersPage from '@/pages/admin/AdminUsersPage';
import AdminSubscriptionsPage from '@/pages/admin/AdminSubscriptionsPage';
import AdminPlansPage from '@/pages/admin/AdminPlansPage';
import AdminPlansComparePage from '@/pages/admin/AdminPlansComparePage';
import PermissionDefaultsPage from '@/pages/admin/PermissionDefaultsPage';
import AdminRiskRulesPage from '@/pages/admin/AdminRiskRulesPage';
import AdminStoreAnalyticsPage from '@/pages/admin/AdminStoreAnalyticsPage';
import AdminAuditLogPage from '@/pages/admin/AdminAuditLogPage';
import AdminOperationsReviewPage from '@/pages/admin/AdminOperationsReviewPage';
import AdminOperationsPage from '@/pages/admin/AdminOperationsPage';
import AdminAnalyticsPage from '@/pages/admin/AdminAnalyticsPage';
import AdminOrganizationsPage from '@/pages/admin/AdminOrganizationsPage';
import AdminBillingPage from '@/pages/admin/AdminBillingPage';
import AdminComingSoonPage from '@/pages/admin/AdminComingSoonPage';
import AdminWaitlistPage from '@/pages/admin/AdminWaitlistPage';
import AdminErpHealthPage from '@/pages/admin/AdminErpHealthPage';
import AdminSecuritySettingsPage from '@/pages/admin/AdminSecuritySettingsPage';
import AdminSecurityDashboardPage from '@/pages/admin/AdminSecurityDashboardPage';
import AdminSecurityAuditPage from '@/pages/admin/AdminSecurityAuditPage';
import MySecurityPage from '@/pages/MySecurityPage';
import ProjectObligationsPage from '@/pages/app/ProjectObligationsPage';
import CommunicationPreferencesPage from '@/pages/app/CommunicationPreferencesPage';

// Guest Portal pages
import ContractorDashboardPage from '@/pages/contractor/ContractorDashboardPage';
import AcceptPartyInvitationPage from '@/pages/contractor/AcceptInvitationPage';

// Guest Portal — external invited-party viewer (public, token-gated)
import GuestViewerPage from '@/pages/guest/GuestViewerPage';
import SharedContractViewerPage from '@/pages/guest/SharedContractViewerPage';
import GuestDashboardPage from '@/pages/guest/GuestDashboardPage';

// Legal pages (public)
import LegalHubPage from '@/pages/legal/LegalHubPage';
import TermsPage from '@/pages/legal/TermsPage';
import PrivacyPage from '@/pages/legal/PrivacyPage';
import CookiePolicyPage from '@/pages/legal/CookiePolicyPage';
import AIPolicyPage from '@/pages/legal/AIPolicyPage';
import IPCopyrightPage from '@/pages/legal/IPCopyrightPage';
import LawEnforcementPage from '@/pages/legal/LawEnforcementPage';
import AcceptableUsePage from '@/pages/legal/AcceptableUsePage';
import CancellationPage from '@/pages/legal/CancellationPage';
import CommunicationsPolicyPage from '@/pages/legal/CommunicationsPolicyPage';
import BCRPage from '@/pages/legal/BCRPage';

// Cookie consent
import CookieConsentBanner from '@/components/common/CookieConsentBanner';
import { CookieConsentProvider } from '@/contexts/CookieConsentContext';

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
const CLIENT_ROLES: UserRole[] = [
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
// Admins can also access the Client Portal via the portal chooser.
const APP_ACCESS_ROLES: UserRole[] = [...CLIENT_ROLES, ...ADMIN_ROLES];

// ─── Navigation items ────────────────────────────────────────
const clientNavItems = [
  { label: 'nav.dashboard', path: '/app/dashboard', icon: '📊' },
  // OWNER_ADMIN-only — Sidebar filters by role (others never see the link).
  { label: 'nav.portfolio', path: '/app/portfolio', icon: '📈', roles: [UserRole.OWNER_ADMIN] },
  { label: 'nav.projects', path: '/app/projects', icon: '📁' },
  { label: 'nav.sharedWithMe', path: '/app/shared-with-me', icon: '🤝' },
  { label: 'nav.clauses', path: '/app/clauses', icon: '📝' },
  { label: 'nav.knowledge', path: '/app/knowledge-assets', icon: '📚' },
  { label: 'nav.obligations', path: '/app/obligations', icon: '📋' },
  { label: 'nav.notifications', path: '/app/notifications', icon: '🔔' },
  { label: 'nav.communications', path: '/app/settings/communications', icon: '📣' },
  { label: 'nav.approvals', path: '/app/approvals', icon: '✅' },
  { label: 'nav.team', path: '/app/team', icon: '👥' },
  { label: 'nav.store', path: '/app/store', icon: '🛒' },
  { label: 'nav.subscription', path: '/app/settings/subscription', icon: '💳' },
  // OWNER_ADMIN-only — Sidebar filters by role (others never see the link).
  { label: 'nav.erpConnections', path: '/app/erp-connections', icon: '🔌', roles: [UserRole.OWNER_ADMIN] },
  { label: 'nav.profile', path: '/app/profile', icon: '👤' },
  { label: 'nav.support', path: '/app/support', icon: '💬' },
];

// ── Admin nav items ──────────────────────────────────────────
// Preserved as a named export for potential reuse (sidebar fallback,
// tests, feature flags). The live Admin Portal nav is defined inside
// AdminLayout.tsx, which uses its own primary/system split.
export const adminNavItems = [
  { label: 'nav.dashboard', path: '/admin/dashboard', icon: '📊' },
  { label: 'nav.knowledgeAssets', path: '/admin/knowledge-assets', icon: '📚' },
  { label: 'nav.plans', path: '/admin/plans', icon: '💳' },
  { label: 'nav.users', path: '/admin/users', icon: '👥' },
  { label: 'nav.riskRules', path: '/admin/risk-rules', icon: '⚠️' },
  { label: 'nav.storeAnalytics', path: '/admin/store-analytics', icon: '🛒' },
  { label: 'nav.permissionDefaults', path: '/admin/permission-defaults', icon: '🛡️' },
  { label: 'nav.support',   path: '/admin/support',     icon: '💬' },
  { label: 'nav.auditLog', path: '/admin/audit-logs',  icon: '📋' },
];

const contractorNavItems = [
  { label: 'nav.dashboard', path: '/contractor/dashboard', icon: '📊' },
];

function App() {
  return (
    <CookieConsentProvider>
      <CookieConsentBanner />
      <Routes>
      {/* Public landing page */}
      <Route path="/" element={<LandingPage />} />

      {/* Legal pages (public — no auth required) */}
      <Route path="/legal" element={<LegalHubPage />} />
      <Route path="/legal/terms" element={<TermsPage />} />
      <Route path="/legal/privacy" element={<PrivacyPage />} />
      <Route path="/legal/cookies" element={<CookiePolicyPage />} />
      <Route path="/legal/ai-policy" element={<AIPolicyPage />} />
      <Route path="/legal/ip" element={<IPCopyrightPage />} />
      <Route path="/legal/law-enforcement" element={<LawEnforcementPage />} />
      <Route path="/legal/acceptable-use" element={<AcceptableUsePage />} />
      <Route path="/legal/cancellation" element={<CancellationPage />} />
      <Route path="/legal/communications" element={<CommunicationsPolicyPage />} />
      <Route path="/legal/bcr" element={<BCRPage />} />

      {/* Auth routes (public) */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/accept-invitation" element={<AcceptInvitationPage />} />

      {/* MFA Setup enforcement page (authenticated, no layout) */}
      <Route
        path="/mfa-setup"
        element={
          <ProtectedRoute>
            <MfaSetupPage />
          </ProtectedRoute>
        }
      />

      {/* Portal chooser — SYSTEM_ADMIN / OPERATIONS only */}
      <Route
        path="/portal-select"
        element={
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <PortalSelectPage />
          </ProtectedRoute>
        }
      />

      {/* Public guest invitation route (no auth) */}
      <Route path="/invitation/accept" element={<AcceptPartyInvitationPage />} />

      {/* ─── Guest Portal viewer (/guest/*) — PUBLIC, token-gated ─── */}
      {/* External invited counterparty: no password to view. The viewer reads
          via an isolated client (Authorization: Viewer <token>); progressive
          identity (set a password to comment) happens inside the page. Kept
          entirely separate from the legacy /contractor/* role stub. */}
      <Route path="/guest/invitation/:token" element={<GuestViewerPage />} />
      <Route path="/guest/view" element={<GuestViewerPage />} />

      {/* ─── Guest Dashboard (#8c) — AUTHED, session-gated ─── */}
      {/* The "home" a signed-in pure guest lands on: every contract shared with
          them across all orgs (their guest_contract_access bindings). Rendered
          in the lighter GuestLayout shell, not the managing AppLayout. Requires
          a real session but no role gate — a pure guest holds bindings, not a
          workspace role. (Guest sign-in — #8c Part 1 — routes here after login;
          that's a separate build.) */}
      <Route
        path="/guest/dashboard"
        element={
          <ProtectedRoute>
            <GuestDashboardPage />
          </ProtectedRoute>
        }
      />

      {/* ─── "Shared with me" viewer entry (#8b) — AUTHED, session-gated ─── */}
      {/* A managing user opening a contract another org shared with them
          (guest_contract_access binding). Same standalone GuestLayout shell —
          honest about the guest-scoped access — but requires a real session
          (any authenticated role can hold bindings; no role gate). */}
      <Route
        path="/guest/shared/:contractId"
        element={
          <ProtectedRoute>
            <SharedContractViewerPage />
          </ProtectedRoute>
        }
      />

      {/* ─── Client Portal (/app/*) ─── */}
      <Route
        path="/app"
        element={
          <ProtectedRoute allowedRoles={APP_ACCESS_ROLES}>
            <AppLayout navItems={clientNavItems} />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        {/* OWNER_ADMIN-only — also enforced by RolesGuard on the API (2a). */}
        <Route
          path="portfolio"
          element={
            <ProtectedRoute allowedRoles={[UserRole.OWNER_ADMIN]}>
              <PortfolioPage />
            </ProtectedRoute>
          }
        />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="shared-with-me" element={<SharedWithMePage />} />
        <Route path="projects/new" element={<ProjectCreationPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="projects/:id/permissions" element={<ProjectPermissionsPage />} />
        <Route path="projects/:id/obligations" element={<ProjectObligationsPage />} />
        <Route path="contracts/:id" element={<ContractDetailPage />} />
        <Route path="contracts/:id/review" element={<ClauseReviewPage />} />
        <Route path="clauses" element={<ClausesPage />} />
        <Route path="knowledge-assets" element={<KnowledgeAssetsPage />} />
        <Route path="obligations" element={<ObligationsPage />} />
        {/* Phase 7.1 Step 3 — calendar view shipped alongside the portfolio page */}
        <Route path="obligations/calendar" element={<ObligationsCalendarPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="store" element={<ContractStorePage />} />
        <Route path="store/contract/:id" element={<ContractStoreDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings/security" element={<MySecurityPage />} />
        <Route path="settings/communications" element={<CommunicationPreferencesPage />} />
        <Route path="settings/billing" element={<BillingPage />} />
        <Route path="settings/subscription" element={<SubscriptionSettingsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        {/* OWNER_ADMIN-only — also enforced by RolesGuard + feature gate on the API (7.28). */}
        <Route
          path="erp-connections"
          element={
            <ProtectedRoute allowedRoles={[UserRole.OWNER_ADMIN]}>
              <ErpConnectionsPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* ─── Admin Portal (/admin/*) — top-nav layout (AdminLayout) ─── */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="knowledge-assets" element={<AdminKnowledgeAssetsPage />} />
        <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
        <Route path="plans" element={<AdminPlansPage />} />
        <Route path="plans/compare" element={<AdminPlansComparePage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="permission-defaults" element={<PermissionDefaultsPage />} />
        <Route path="risk-rules" element={<AdminRiskRulesPage />} />
        <Route path="store-analytics" element={<AdminStoreAnalyticsPage />} />
        <Route path="support"         element={<AdminSupportPage />} />
        <Route path="audit-logs"      element={<AdminAuditLogPage />} />
        <Route path="security"          element={<AdminSecurityDashboardPage />} />
        <Route path="security/settings" element={<AdminSecuritySettingsPage />} />
        <Route path="security/audit"    element={<AdminSecurityAuditPage />} />

        <Route path="operations-review" element={<AdminOperationsReviewPage />} />
        <Route path="operations"        element={<AdminOperationsPage />} />

        {/* Placeholder routes for Phase 3+ admin pages */}
        <Route path="organizations"     element={<AdminOrganizationsPage />} />
        <Route path="analytics"         element={<AdminAnalyticsPage />} />
        <Route path="billing"           element={<AdminBillingPage />} />
        <Route path="waitlist"          element={<AdminWaitlistPage />} />
        <Route path="erp-health"        element={<AdminErpHealthPage />} />
        <Route path="account-settings"  element={<AdminComingSoonPage title="Account Settings" />} />
      </Route>

      {/* ─── Guest Portal (/contractor/*) ─── */}
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
    </CookieConsentProvider>
  );
}

export default App;
