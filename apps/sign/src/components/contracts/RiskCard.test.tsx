import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RiskCard from './RiskCard';
import { CLAUSE_TYPE_LABELS } from '@/components/review/ClauseReviewCard';
import type { RiskAnalysis } from '@/types';

// react-i18next mock: t() returns the defaultValue when provided (the component
// always passes the English label/enum as defaultValue), else the key — mirrors
// the app's other component tests and lets us assert on the English display.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The category dropdown reuses the SAME 17 clause-type labels.
const LABELS = Object.values(CLAUSE_TYPE_LABELS); // General, Payment, ... Other

const baseRisk = (): RiskAnalysis =>
  ({
    id: 'risk-1',
    contract_id: 'ct-1',
    contract_clause_id: null,
    risk_category: 'Uncategorized', // an AI free-text value, not one of the 17
    risk_level: 'HIGH',
    description: 'Some risk description',
    recommendation: null,
    citation_source: null,
    citation_excerpt: null,
    status: 'OPEN',
    handled_by: null,
    handled_at: null,
    created_at: '',
  }) as unknown as RiskAnalysis;

describe('RiskCard — editable level + category (Phase 8.3)', () => {
  it('renders the current level, category and description', () => {
    render(<RiskCard risk={baseRisk()} onAnnotate={vi.fn()} />);
    expect(screen.getByTitle(/change risk level/i)).toHaveTextContent('HIGH');
    expect(screen.getByTitle(/change category/i)).toHaveTextContent('Uncategorized');
    expect(screen.getByText('Some risk description')).toBeInTheDocument();
  });

  it('level dropdown offers exactly HIGH/MEDIUM/LOW and saves via onAnnotate', async () => {
    const onAnnotate = vi.fn().mockResolvedValue(undefined);
    render(<RiskCard risk={baseRisk()} onAnnotate={onAnnotate} />);

    fireEvent.click(screen.getByTitle(/change risk level/i));
    expect(screen.getByRole('button', { name: 'LOW' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MEDIUM' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'LOW' }));
    await waitFor(() =>
      expect(onAnnotate).toHaveBeenCalledWith('risk-1', { risk_level: 'LOW' }),
    );
    expect(screen.getByTitle(/change risk level/i)).toHaveTextContent('LOW');
  });

  it('category dropdown offers all 17 clause-type labels and saves the picked label', async () => {
    const onAnnotate = vi.fn().mockResolvedValue(undefined);
    render(<RiskCard risk={baseRisk()} onAnnotate={onAnnotate} />);

    fireEvent.click(screen.getByTitle(/change category/i));
    // All 17 clause-type labels render as options.
    expect(LABELS).toHaveLength(17);
    LABELS.forEach((label) =>
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Payment' }));
    await waitFor(() =>
      expect(onAnnotate).toHaveBeenCalledWith('risk-1', { risk_category: 'Payment' }),
    );
    expect(screen.getByTitle(/change category/i)).toHaveTextContent('Payment');
  });

  it('reverts the optimistic level update when the save fails', async () => {
    const onAnnotate = vi.fn().mockRejectedValue(new Error('boom'));
    render(<RiskCard risk={baseRisk()} onAnnotate={onAnnotate} />);

    fireEvent.click(screen.getByTitle(/change risk level/i));
    fireEvent.click(screen.getByRole('button', { name: 'LOW' }));

    await waitFor(() =>
      expect(screen.getByTitle(/change risk level/i)).toHaveTextContent('HIGH'),
    );
    expect(screen.getByText(/failed to update/i)).toBeInTheDocument();
  });
});
