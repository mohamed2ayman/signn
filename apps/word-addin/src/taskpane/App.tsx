import * as React from 'react';
import {
  AuthState,
  getStoredAuth,
  refreshIfNeeded,
  logout,
} from './lib/auth';
import { LoginTab } from './tabs/LoginTab';
import { RiskTab } from './tabs/RiskTab';
import { SummaryTab } from './tabs/SummaryTab';
import { LibraryTab } from './tabs/LibraryTab';
import { UploadTab } from './tabs/UploadTab';
import { ChatTab } from './tabs/ChatTab';
import { ReLoginInline } from './components/ReLoginInline';

type TabKey = 'risk' | 'summary' | 'library' | 'upload' | 'chat';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'risk', label: 'Risk' },
  { key: 'summary', label: 'Summary' },
  { key: 'library', label: 'Library' },
  { key: 'upload', label: 'Upload' },
  { key: 'chat', label: 'Chat' },
];

export default function App() {
  const [auth, setAuth] = React.useState<AuthState | null>(null);
  const [bootstrapping, setBootstrapping] = React.useState(true);
  const [reLoginOpen, setReLoginOpen] = React.useState(false);
  const [tab, setTab] = React.useState<TabKey>('risk');

  // Bootstrap: try to use stored auth, refreshing proactively if near expiry.
  React.useEffect(() => {
    (async () => {
      const stored = getStoredAuth();
      if (!stored) {
        setBootstrapping(false);
        return;
      }
      try {
        const fresh = await refreshIfNeeded();
        setAuth(fresh);
      } catch {
        setAuth(null);
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const onAuthLost = React.useCallback(() => {
    setReLoginOpen(true);
  }, []);

  const onReLoginSuccess = (state: AuthState) => {
    setAuth(state);
    setReLoginOpen(false);
  };

  const onSignOut = async () => {
    await logout();
    setAuth(null);
    setTab('risk');
  };

  if (bootstrapping) {
    return (
      <div className="sign-shell">
        <Header />
        <div className="sign-body">
          <div className="sign-progress">Loading…</div>
        </div>
        <CenvoxAttribution />
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="sign-shell">
        <Header />
        <div className="sign-body">
          <LoginTab onAuth={setAuth} />
        </div>
        <CenvoxAttribution />
      </div>
    );
  }

  return (
    <div className="sign-shell">
      <Header user={auth.user.email} onSignOut={onSignOut} />
      <div className="sign-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
            role="tab"
            aria-selected={tab === t.key}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sign-body">
        <TabPanel active={tab === 'risk'}>
          <RiskTab auth={auth} onAuthLost={onAuthLost} />
        </TabPanel>
        <TabPanel active={tab === 'summary'}>
          <SummaryTab auth={auth} onAuthLost={onAuthLost} />
        </TabPanel>
        <TabPanel active={tab === 'library'}>
          <LibraryTab auth={auth} onAuthLost={onAuthLost} />
        </TabPanel>
        <TabPanel active={tab === 'upload'}>
          <UploadTab auth={auth} onAuthLost={onAuthLost} />
        </TabPanel>
        <TabPanel active={tab === 'chat'}>
          <ChatTab auth={auth} onAuthLost={onAuthLost} />
        </TabPanel>
      </div>
      <CenvoxAttribution />
      {reLoginOpen && (
        <ReLoginInline
          onSuccess={onReLoginSuccess}
          reason="Your session expired. Sign in to continue without losing your work."
        />
      )}
    </div>
  );
}

/* Mount all tabs once and toggle visibility — preserves per-tab state
 * (in-flight risk results, chat history, parsed clauses) when the user
 * switches tabs mid-task. Inactive tabs still receive `auth` so they
 * can react to auth changes. */
function TabPanel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return <div style={{ display: active ? 'block' : 'none' }}>{children}</div>;
}

function Header({
  user,
  onSignOut,
}: {
  user?: string;
  onSignOut?: () => void;
}) {
  return (
    <div className="sign-header">
      <div>
        <div className="sign-header__title">SIGN for Word</div>
        <div className="sign-header__sub">
          {user ? user : 'Contract intelligence'}
        </div>
      </div>
      {onSignOut && (
        <button
          className="sign-button sign-button--ghost"
          style={{
            background: 'transparent',
            color: '#fff',
            borderColor: '#fff',
            fontSize: 11,
            padding: '4px 8px',
          }}
          onClick={onSignOut}
        >
          Sign out
        </button>
      )}
    </div>
  );
}

function CenvoxAttribution() {
  return <div className="sign-cenvox-attribution">Powered by CENVOX</div>;
}
