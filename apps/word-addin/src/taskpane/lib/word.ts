/// <reference types="office-js" />

import type { ParseDocxClause, RiskLevel } from './types';

export interface RiskHighlight {
  clause_ref: string;
  risk_level: RiskLevel;
}

const HIGHLIGHT_COLORS: Record<RiskLevel, Word.HighlightColor> = {
  LOW: 'BrightGreen' as Word.HighlightColor,
  MEDIUM: 'Yellow' as Word.HighlightColor,
  HIGH: 'Red' as Word.HighlightColor,
};

const TAG_PREFIX = 'sign:clause:';

/**
 * Read the full document text via the Word JS API.
 */
export async function readDocumentText(): Promise<string> {
  return Word.run(async (ctx) => {
    const body = ctx.document.body;
    body.load('text');
    await ctx.sync();
    return body.text;
  });
}

/**
 * Wrap each parsed clause in a Content Control with tag `sign:clause:{clause_ref}`.
 * Idempotent — existing controls with the same tag are reused.
 *
 * Anchors highlights to ranges that survive document edits, per Feature A.
 */
export async function anchorClauses(
  clauses: ParseDocxClause[],
): Promise<void> {
  await Word.run(async (ctx) => {
    const body = ctx.document.body;
    body.load('text');
    await ctx.sync();
    const fullText = body.text;

    for (const clause of clauses) {
      // Skip if a content control already exists for this clause_ref
      const existing = ctx.document.contentControls.getByTag(
        `${TAG_PREFIX}${clause.clause_ref}`,
      );
      existing.load('items');
      await ctx.sync();
      if (existing.items.length > 0) continue;

      const range = await findRangeForClause(ctx, body, fullText, clause);
      if (!range) continue;

      const cc = range.insertContentControl();
      cc.tag = `${TAG_PREFIX}${clause.clause_ref}`;
      cc.title = clause.clause_ref;
      cc.appearance = 'BoundingBox' as Word.ContentControlAppearance;
      cc.color = '#4F6EF7';
    }
    await ctx.sync();
  });
}

/**
 * Apply traffic-light highlights to anchored clauses.
 * Always clears existing highlights first to prevent accumulation across runs (Feature A).
 */
export async function applyRiskHighlights(
  highlights: RiskHighlight[],
): Promise<void> {
  await Word.run(async (ctx) => {
    await clearAllSignHighlightsInternal(ctx);

    for (const h of highlights) {
      const cc = ctx.document.contentControls.getByTag(
        `${TAG_PREFIX}${h.clause_ref}`,
      );
      cc.load('items');
      await ctx.sync();
      if (cc.items.length === 0) continue;
      const item = cc.items[0];
      item.load('font');
      await ctx.sync();
      item.font.highlightColor = HIGHLIGHT_COLORS[h.risk_level];
    }
    await ctx.sync();
  });
}

export async function clearAllSignHighlights(): Promise<void> {
  await Word.run(async (ctx) => {
    await clearAllSignHighlightsInternal(ctx);
    await ctx.sync();
  });
}

async function clearAllSignHighlightsInternal(
  ctx: Word.RequestContext,
): Promise<void> {
  const all = ctx.document.contentControls;
  all.load('items/tag');
  await ctx.sync();
  for (const item of all.items) {
    if (item.tag && item.tag.startsWith(TAG_PREFIX)) {
      item.font.highlightColor = null as any;
    }
  }
}

/**
 * Replace the text inside a clause's content control with new text.
 * Returns the original text so the caller can log it to NegotiationEvent.
 */
export async function replaceClauseText(
  clauseRef: string,
  newText: string,
): Promise<string> {
  return Word.run(async (ctx) => {
    const cc = ctx.document.contentControls.getByTag(
      `${TAG_PREFIX}${clauseRef}`,
    );
    cc.load('items');
    await ctx.sync();
    if (cc.items.length === 0) {
      throw new Error(`No content control for clause ${clauseRef}`);
    }
    const item = cc.items[0];
    item.load('text');
    await ctx.sync();
    const originalText = item.text;
    item.insertText(newText, 'Replace' as Word.InsertLocation);
    await ctx.sync();
    return originalText;
  });
}

/**
 * Insert text at the current selection. Used by Chat "Copy suggestion to document".
 */
export async function insertAtSelection(text: string): Promise<void> {
  await Word.run(async (ctx) => {
    const sel = ctx.document.getSelection();
    sel.insertText(text, 'Replace' as Word.InsertLocation);
    await ctx.sync();
  });
}

/**
 * Read currently selected text. Empty string if nothing selected.
 */
export async function readSelection(): Promise<string> {
  return Word.run(async (ctx) => {
    const sel = ctx.document.getSelection();
    sel.load('text');
    await ctx.sync();
    return sel.text || '';
  });
}

/**
 * Scroll the first matching content control into view.
 */
export async function scrollToClause(clauseRef: string): Promise<void> {
  await Word.run(async (ctx) => {
    const cc = ctx.document.contentControls.getByTag(
      `${TAG_PREFIX}${clauseRef}`,
    );
    cc.load('items');
    await ctx.sync();
    if (cc.items.length === 0) return;
    cc.items[0].select();
    await ctx.sync();
  });
}

/* ─── Internal: clause-range resolution ──────────────────── */

async function findRangeForClause(
  ctx: Word.RequestContext,
  body: Word.Body,
  fullText: string,
  clause: ParseDocxClause,
): Promise<Word.Range | null> {
  // Word's search is the most reliable way to locate ranges; the AI's
  // returned char offsets may drift if the user has edited since.
  const needle = clause.text.slice(0, 240).trim();
  if (!needle) return null;

  const escaped = escapeForSearch(needle);
  const results = body.search(escaped, {
    matchCase: false,
    matchWholeWord: false,
  });
  results.load('items');
  await ctx.sync();
  if (results.items.length === 0) return null;
  return results.items[0];
}

function escapeForSearch(text: string): string {
  // Word search treats `?`, `*`, `~` and brackets specially. Strip newlines.
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 240);
}
