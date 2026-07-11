import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Contract } from '@/types';

/**
 * Multi-tier T0b — the PARENT-CONTRACT picker for the create-contract flow.
 *
 * Shown in the create modal's 'details' step ONLY when the chosen relationship
 * type's registry parent_link_rule is 'required' or 'optional' (the parent step
 * is hidden entirely for 'none' types like MAIN / USUFRUCT). The `contracts`
 * prop is ALREADY filtered by the parent (to the type's allowed_parent_types,
 * scoped to the project/org) — this component only renders + selects.
 *
 * `required` = the rule is 'required' → the caller blocks "Create" until a
 * parent is chosen and NO "no parent" row is offered. When not required
 * (the 'optional' rule), a "No parent" row lets the user leave it unlinked.
 *
 * Controlled: the parent owns `value` (a contract id, or null = no parent) and
 * is notified via `onChange`. Searchable by name (dir=auto, Arabic-safe).
 */
interface Props {
  contracts: Contract[];
  value: string | null;
  onChange: (id: string | null) => void;
  required: boolean;
}

export default function ParentContractPicker({
  contracts,
  value,
  onChange,
  required,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contracts;
    return contracts.filter((c) => c.name.toLowerCase().includes(q));
  }, [contracts, query]);

  if (contracts.length === 0) {
    // No eligible parents in this project yet. For a 'required' type the caller
    // also keeps "Create" disabled (value stays null); this is the explainer.
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center">
        <p className="text-sm text-gray-500" dir="auto">
          {t('relationshipType.parent.noneAvailable')}
        </p>
      </div>
    );
  }

  const rowBase =
    'flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-start transition-all';
  const rowSelected = 'border-primary bg-primary/5 ring-2 ring-primary/30';
  const rowIdle = 'border-gray-200 hover:border-primary/50 hover:bg-gray-50';

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('relationshipType.parent.searchPlaceholder')}
        dir="auto"
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />

      <div className="max-h-56 space-y-2 overflow-y-auto">
        {/* 'optional' rule → allow explicitly choosing "no parent". */}
        {!required && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            className={`${rowBase} ${value === null ? rowSelected : rowIdle}`}
          >
            <span className="text-sm font-medium text-gray-600">
              {t('relationshipType.parent.none')}
            </span>
          </button>
        )}

        {filtered.map((c) => {
          const selected = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              aria-pressed={selected}
              className={`${rowBase} ${selected ? rowSelected : rowIdle}`}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-semibold text-gray-900"
                  dir="auto"
                >
                  {c.name}
                </span>
                <span className="mt-0.5 block text-[11px] uppercase tracking-wide text-gray-400">
                  {(c.status || '').replace(/_/g, ' ')}
                </span>
              </span>
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  selected
                    ? 'border-primary bg-primary text-white'
                    : 'border-gray-300 bg-white'
                }`}
              >
                {selected && (
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                )}
              </span>
            </button>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-1 py-2 text-xs text-gray-400" dir="auto">
            {t('relationshipType.parent.noMatches')}
          </p>
        )}
      </div>
    </div>
  );
}
