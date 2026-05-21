// Locale-aware legal-content resolver.
//
// This module is the single entry point used by the /legal/* pages to load
// policy content. Each policy slug currently has one source file (English,
// auto-generated from /legal-docs/policies/*.docx). When professionally
// translated Arabic and French versions become available, only this resolver
// needs to be updated — no page component changes required.
//
// TODO: add French legal translations (Task 7.11)
// TODO: add Arabic legal translations (Task 7.11)

import type { LegalSection, LegalToc } from './_types';

import {
  termsAndConditionsContentMeta,
  termsAndConditionsContentToc,
  termsAndConditionsContentSections,
} from './terms.content';
import {
  privacyPolicyContentMeta,
  privacyPolicyContentToc,
  privacyPolicyContentSections,
} from './privacy.content';
import {
  cookiePolicyContentMeta,
  cookiePolicyContentToc,
  cookiePolicyContentSections,
} from './cookies.content';
import {
  aiInnovationUsagePolicyContentMeta,
  aiInnovationUsagePolicyContentToc,
  aiInnovationUsagePolicyContentSections,
} from './ai-policy.content';
import {
  ipCopyrightPolicyContentMeta,
  ipCopyrightPolicyContentToc,
  ipCopyrightPolicyContentSections,
} from './ip.content';
import {
  lawEnforcementGuidelinesContentMeta,
  lawEnforcementGuidelinesContentToc,
  lawEnforcementGuidelinesContentSections,
} from './law-enforcement.content';
import {
  acceptableUsePolicyContentMeta,
  acceptableUsePolicyContentToc,
  acceptableUsePolicyContentSections,
} from './acceptable-use.content';
import {
  cancellationDowngradePolicyContentMeta,
  cancellationDowngradePolicyContentToc,
  cancellationDowngradePolicyContentSections,
} from './cancellation.content';
import {
  communicationPreferencesPolicyContentMeta,
  communicationPreferencesPolicyContentToc,
  communicationPreferencesPolicyContentSections,
} from './communications.content';
import {
  bindingCorporateRulesPrivacyCodeContentMeta,
  bindingCorporateRulesPrivacyCodeContentToc,
  bindingCorporateRulesPrivacyCodeContentSections,
} from './bcr.content';

export type LegalLocale = 'en' | 'ar' | 'fr';

export type LegalSlug =
  | 'terms'
  | 'privacy'
  | 'cookies'
  | 'ai-policy'
  | 'ip'
  | 'law-enforcement'
  | 'acceptable-use'
  | 'cancellation'
  | 'communications'
  | 'bcr';

export interface LegalContentMeta {
  title: string;
  effectiveDate: string;
  lastUpdated: string;
  version: string;
}

export interface ResolvedLegalContent {
  meta: LegalContentMeta;
  toc: LegalToc;
  sections: LegalSection[];
}

interface ContentBundle {
  meta: LegalContentMeta;
  toc: LegalToc;
  sections: LegalSection[];
}

const ENGLISH: Record<LegalSlug, ContentBundle> = {
  terms: {
    meta: termsAndConditionsContentMeta,
    toc: termsAndConditionsContentToc,
    sections: termsAndConditionsContentSections,
  },
  privacy: {
    meta: privacyPolicyContentMeta,
    toc: privacyPolicyContentToc,
    sections: privacyPolicyContentSections,
  },
  cookies: {
    meta: cookiePolicyContentMeta,
    toc: cookiePolicyContentToc,
    sections: cookiePolicyContentSections,
  },
  'ai-policy': {
    meta: aiInnovationUsagePolicyContentMeta,
    toc: aiInnovationUsagePolicyContentToc,
    sections: aiInnovationUsagePolicyContentSections,
  },
  ip: {
    meta: ipCopyrightPolicyContentMeta,
    toc: ipCopyrightPolicyContentToc,
    sections: ipCopyrightPolicyContentSections,
  },
  'law-enforcement': {
    meta: lawEnforcementGuidelinesContentMeta,
    toc: lawEnforcementGuidelinesContentToc,
    sections: lawEnforcementGuidelinesContentSections,
  },
  'acceptable-use': {
    meta: acceptableUsePolicyContentMeta,
    toc: acceptableUsePolicyContentToc,
    sections: acceptableUsePolicyContentSections,
  },
  cancellation: {
    meta: cancellationDowngradePolicyContentMeta,
    toc: cancellationDowngradePolicyContentToc,
    sections: cancellationDowngradePolicyContentSections,
  },
  communications: {
    meta: communicationPreferencesPolicyContentMeta,
    toc: communicationPreferencesPolicyContentToc,
    sections: communicationPreferencesPolicyContentSections,
  },
  bcr: {
    meta: bindingCorporateRulesPrivacyCodeContentMeta,
    toc: bindingCorporateRulesPrivacyCodeContentToc,
    sections: bindingCorporateRulesPrivacyCodeContentSections,
  },
};

export function getLegalContent(slug: LegalSlug, locale: LegalLocale): ResolvedLegalContent {
  // FR and AR currently fall back to EN — the legal text requires qualified
  // translation review before any other locale can be served. The resolver
  // signature is locale-aware so adding the translations later is a drop-in.
  void locale;
  return ENGLISH[slug];
}

export function normalizeLegalLocale(lang: string | undefined | null): LegalLocale {
  if (lang === 'ar' || lang === 'fr') return lang;
  return 'en';
}
