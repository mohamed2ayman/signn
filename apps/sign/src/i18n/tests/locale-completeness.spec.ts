import { describe, it, expect } from 'vitest';
import en from '../locales/en/common.json';
import ar from '../locales/ar/common.json';
import fr from '../locales/fr/common.json';
import { SUPPORTED_LANGUAGES } from '../index';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject { [key: string]: JsonValue }

function collectKeys(obj: JsonValue, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  const out: string[] = [];
  for (const k of Object.keys(obj as JsonObject)) {
    const child = (obj as JsonObject)[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      out.push(...collectKeys(child, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe('i18n locale completeness', () => {
  const enKeys = collectKeys(en as JsonValue).sort();
  const arKeys = collectKeys(ar as JsonValue).sort();
  const frKeys = collectKeys(fr as JsonValue).sort();

  it('FR locale has every key that EN has', () => {
    const missingInFr = enKeys.filter((k) => !frKeys.includes(k));
    expect(missingInFr).toEqual([]);
  });

  it('FR locale has no keys that EN is missing', () => {
    const extraInFr = frKeys.filter((k) => !enKeys.includes(k));
    expect(extraInFr).toEqual([]);
  });

  it('AR locale has every key that EN has', () => {
    const missingInAr = enKeys.filter((k) => !arKeys.includes(k));
    expect(missingInAr).toEqual([]);
  });

  it('AR locale has no keys that EN is missing', () => {
    const extraInAr = arKeys.filter((k) => !enKeys.includes(k));
    expect(extraInAr).toEqual([]);
  });

  it('i18n config registers en, ar, and fr in SUPPORTED_LANGUAGES', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(['ar', 'en', 'fr']);
  });
});
