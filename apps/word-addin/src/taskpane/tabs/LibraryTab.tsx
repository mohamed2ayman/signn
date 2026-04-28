import * as React from 'react';
import type { AuthState } from '../lib/auth';
import { api } from '../lib/api';
import { insertAtSelection } from '../lib/word';
import type { KnowledgeAsset } from '../lib/types';

interface Props {
  auth: AuthState;
  onAuthLost: () => void;
}

export function LibraryTab({ onAuthLost }: Props) {
  const [assets, setAssets] = React.useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api<KnowledgeAsset[]>(
          '/knowledge-assets?asset_type=CONTRACT_TEMPLATE',
        );
        if (!cancelled) setAssets(list);
      } catch (e) {
        if (e instanceof Error && e.name === 'AuthRequiredError') {
          onAuthLost();
          return;
        }
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load library');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = React.useMemo(() => {
    if (!filter.trim()) return assets;
    const q = filter.toLowerCase();
    return assets.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [assets, filter]);

  const insert = async (asset: KnowledgeAsset) => {
    try {
      await insertAtSelection(asset.content ?? asset.title);
    } catch (e) {
      if (e instanceof Error && e.name === 'AuthRequiredError') onAuthLost();
    }
  };

  return (
    <div>
      <input
        className="sign-input"
        placeholder="Search clause library…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {loading && <div className="sign-progress">Loading library…</div>}
      {error && <div className="sign-error">{error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="sign-card" style={{ fontSize: 12, color: '#666' }}>
          No matching clauses in your library.
        </div>
      )}
      {filtered.map((asset) => (
        <div className="sign-card" key={asset.id}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
            {asset.title}
          </div>
          {asset.description && (
            <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
              {asset.description}
            </div>
          )}
          {asset.tags && asset.tags.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {asset.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    background: '#eef2ff',
                    color: '#4f6ef7',
                    padding: '2px 6px',
                    borderRadius: 8,
                    marginRight: 4,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <button
            className="sign-button"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => insert(asset)}
          >
            Insert at cursor
          </button>
        </div>
      ))}
    </div>
  );
}
