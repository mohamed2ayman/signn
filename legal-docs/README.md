# SIGN Platform — Legal Documents

This folder contains all 10 legally drafted policy documents for the SIGN Platform,
created specifically for SIGN Technologies LLC, incorporated in Dubai Internet City
Free Zone, Dubai, UAE. These documents are the authoritative source of truth for
all legal content that must be rendered inline on the /legal/* policy pages.

## How Claude Code Should Use These Documents

When implementing the /legal/* policy pages as instructed in the Claude Code prompt,
use the content in these DOCX files as the authoritative source for all policy text.
Each policy page should render the content of the corresponding document inline —
not as a PDF download — structured as HTML sections matching the document's
table of contents.

## Document Index

| File | Route | Sections |
|------|-------|----------|
| SIGN_Terms_and_Conditions_v4.docx | /legal/terms | 25 sections |
| SIGN_Privacy_Policy_v2.docx | /legal/privacy | 18 sections |
| SIGN_Cookie_Policy_v2.docx | /legal/cookies | 12 sections |
| SIGN_AI_Innovation_Usage_Policy_v2.docx | /legal/ai-policy | 17 sections |
| SIGN_IP_Copyright_Policy_v2.docx | /legal/ip | 16 sections |
| SIGN_Law_Enforcement_Policy.docx | /legal/law-enforcement | 19 sections |
| SIGN_Acceptable_Use_Policy.docx | /legal/acceptable-use | 20 sections |
| SIGN_Cancellation_Downgrade_Policy.docx | /legal/cancellation | 19 sections |
| SIGN_Communication_Preferences_Policy.docx | /legal/communications | 19 sections |
| SIGN_BCR_Privacy_Code.docx | /legal/bcr | 3 parts + 7 appendices |

## Key Facts About These Documents

- **Entity:** SIGN Technologies LLC (ساين تكنولوجيز ش.ذ.م.م)
- **Jurisdiction:** Dubai Internet City Free Zone, UAE (DDA regulated)
- **Primary law:** UAE Federal Decree-Law No. 45/2021 (UAE PDPL)
- **Governing law:** UAE law / Dubai Internet City regulations
- **Dispute resolution:** DIAC (Dubai International Arbitration Centre)
- **Languages:** English (primary) + Arabic (legally precedent in EG/SA/UAE)
- **Effective date:** June 1, 2025
- **Contact:** legal@sign.io | privacy@sign.io | ai@sign.io

## Content Architecture for Policy Pages

Each policy page in apps/sign/src/pages/legal/ should:
1. Import the policy content from a structured TypeScript file
   (e.g., src/pages/legal/content/terms.content.ts)
2. The content files should be structured as arrays of sections with
   { id, title, content } matching the document's table of contents
3. The LegalPageLayout component renders the sections with a sticky ToC
4. Content should NOT be fetched from an API — it is static and hardcoded

## Placement Reference

See SIGN_Legal_Placement_Matrix.html for the complete placement matrix showing
where each policy must appear across the user journey — landing page, signup,
onboarding, platform features, account settings, billing, email footers,
and the Word Add-In.

## Implementation Prompt

See SIGN_Claude_Code_Prompt.docx for the complete Claude Code implementation
prompt (18 tasks) that implements the full legal layer.