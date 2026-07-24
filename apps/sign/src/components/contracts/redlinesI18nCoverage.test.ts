import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import en from '@/i18n/locales/en/common.json';
import ar from '@/i18n/locales/ar/common.json';
import fr from '@/i18n/locales/fr/common.json';

/**
 * 7.19 Slice 3 — i18n COVERAGE GUARD (the missing-keys class cannot recur).
 *
 * The shipped blocker: the card buttons rendered raw keys
 * ("redlines.actions.accept" …) because the `redlines.actions.*` group was
 * never added to any locale — every automated gate stayed green because
 * nothing asserted that used keys EXIST. This test closes the class:
 *
 *  1. STATIC keys — every `t('…')` string literal in the redline-slice
 *     component sources is extracted and asserted present in en, ar AND fr.
 *  2. DYNAMIC key families — template usages (`t(`redlines.${kind}.title`)`)
 *     can't be source-extracted, so each family is expanded over its FULL
 *     enum domain below. Adding a new status/action without locale entries
 *     fails here; adding a new dynamic family to the components without
 *     registering it below is caught by the sibling static scan the moment
 *     any literal from the family is used, and by review of this list.
 *
 * A missing key in ANY locale names the key + the locale(s) in the failure.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The redline-slice component sources under guard. */
const SOURCES = [
  resolve(here, './RedlinesTab.tsx'),
  resolve(here, '../sharedWithMe/SharedContractRowItem.tsx'),
  resolve(here, '../../pages/guest/SharedContractViewerPage.tsx'),
];

/** Dynamic template families expanded over their full domains. */
const DYNAMIC_KEYS: string[] = [
  ...['accept', 'reject', 'counter', 'withdraw'].flatMap((kind) => [
    `redlines.${kind}.title`,
    `redlines.${kind}.body`,
    `redlines.${kind}.confirm`,
    `redlines.${kind}.success`,
    `redlines.actions.${kind}`,
  ]),
  ...['PROPOSED', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN', 'STALE'].map(
    (s) => `redlines.status.${s}`,
  ),
  ...['DRAFT', 'SHARED', 'UNDER_REVIEW', 'AGREED', 'READY_TO_SIGN'].map(
    (s) => `redlines.negotiation.${s}`,
  ),
  ...['agree', 'readyToSign'].flatMap((a) => [
    `redlines.negotiation.${a}Title`,
    `redlines.negotiation.${a}Body`,
    `redlines.negotiation.${a}Confirm`,
    `redlines.negotiation.${a}Success`,
  ]),
];

function extractStaticKeys(source: string): string[] {
  // t('some.key') / t("some.key") — literal usages only.
  const out: string[] = [];
  const re = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function flatten(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      for (const nested of flatten(v as Record<string, unknown>, `${prefix}${k}.`)) {
        keys.add(nested);
      }
    } else {
      keys.add(`${prefix}${k}`);
    }
  }
  return keys;
}

describe('redline slice i18n coverage (en/ar/fr)', () => {
  const locales: Array<[string, Set<string>]> = [
    ['en', flatten(en as unknown as Record<string, unknown>)],
    ['ar', flatten(ar as unknown as Record<string, unknown>)],
    ['fr', flatten(fr as unknown as Record<string, unknown>)],
  ];

  const staticKeys = SOURCES.flatMap((p) => extractStaticKeys(readFileSync(p, 'utf-8')));
  const allKeys = [...new Set([...staticKeys, ...DYNAMIC_KEYS])].sort();

  it('extracts a sane number of keys (the scan itself works)', () => {
    // If the regex or paths break, this fails loudly instead of a silent
    // zero-key pass rendering the whole guard inert.
    expect(staticKeys.length).toBeGreaterThan(30);
    expect(allKeys.length).toBeGreaterThan(60);
  });

  it('every used key exists in every locale', () => {
    const missing: string[] = [];
    for (const key of allKeys) {
      for (const [loc, keys] of locales) {
        if (!keys.has(key)) missing.push(`${key} [${loc}]`);
      }
    }
    expect(missing, `missing i18n entries:\n${missing.join('\n')}`).toEqual([]);
  });
});
