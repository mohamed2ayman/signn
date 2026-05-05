import { DataSource } from 'typeorm';
import {
  AssetReviewStatus,
  AssetType,
  KnowledgeAsset,
} from '../entities';

/**
 * Phase 3.4 — seeds 9 SIGN-platform Knowledge Assets that power the
 * Compliance Monitoring engine. Each asset is `organization_id IS NULL`
 * (platform-wide), `review_status = AUTO_APPROVED`, `source = PLATFORM_SEED`.
 *
 * Idempotent: each insert checks `(title, source) UNIQUE` before adding.
 *
 * The `content` jsonb is structured so the compliance agent can render
 * it cleanly into context (see ComplianceKnowledgeService.formatAssets):
 *   { summary?: string, articles: Array<{ ref?, title?, text?, citation? }> }
 */
export async function seedComplianceKnowledge(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(KnowledgeAsset);

  for (const asset of CATALOG) {
    const existing = await repo.findOne({
      where: { title: asset.title, source: 'PLATFORM_SEED' },
    });
    if (existing) continue;

    await repo.insert({
      organization_id: null as unknown as string,
      title: asset.title,
      description: asset.description,
      asset_type: asset.asset_type,
      review_status: AssetReviewStatus.AUTO_APPROVED,
      jurisdiction: asset.jurisdiction,
      tags: asset.tags,
      include_in_risk_analysis: true,
      include_in_citations: true,
      content: asset.content as any,
      source: 'PLATFORM_SEED',
      ocr_status: 'COMPLETED',
      embedding_status: 'PENDING',
    });
    console.log(`[seed] Knowledge asset created: ${asset.title}`);
  }
}

interface SeedAsset {
  title: string;
  description: string;
  asset_type: AssetType;
  jurisdiction: string;
  tags: string[];
  content: {
    summary?: string;
    articles: Array<{
      ref?: string;
      title?: string;
      text?: string;
      citation?: string;
    }>;
  };
}

const CATALOG: SeedAsset[] = [
  // 1. FIDIC Red Book 2017 reference
  {
    title: 'FIDIC Red Book 2017 — Required Clauses Reference',
    description:
      'SIGN reference of clauses required by FIDIC Red Book 2017 (2nd Edition) Conditions of Contract for Construction.',
    asset_type: AssetType.INTERNATIONAL_STANDARD,
    jurisdiction: 'INTL',
    tags: ['standard:FIDIC_RED_BOOK_2017', 'jurisdiction:INTL', 'type:STANDARD'],
    content: {
      summary:
        'FIDIC Red Book 2017 mandates a specific set of provisions covering employer/contractor risk allocation, claims procedures, dispute resolution, and time-bar mechanisms.',
      articles: [
        {
          ref: '1',
          title: 'General Provisions',
          text:
            'Definitions, interpretation, communications, governing law, language, priority of documents.',
          citation: 'FIDIC Red Book 2017, Sub-Clause 1.1–1.13',
        },
        {
          ref: '4',
          title: 'The Contractor',
          text:
            'Contractor general obligations, performance security (Sub-Clause 4.2 — required ≤28 days from Letter of Acceptance), care of works, programme submission (Sub-Clause 8.3 — within 28 days).',
          citation: 'FIDIC Red Book 2017, Clause 4 & 8',
        },
        {
          ref: '8',
          title: 'Commencement, Delays and Suspension',
          text:
            'Time for Completion is mandatory. Contractor entitled to extension under Sub-Clause 8.5; delay damages capped per Particular Conditions.',
          citation: 'FIDIC Red Book 2017, Clause 8',
        },
        {
          ref: '14',
          title: 'Contract Price and Payment',
          text:
            'Interim Payment Certificates issued by Engineer within 28 days; payment by Employer within 56 days of Statement.',
          citation: 'FIDIC Red Book 2017, Sub-Clauses 14.6–14.7',
        },
        {
          ref: '17',
          title: 'Care of the Works and Indemnities',
          text:
            'Mutual indemnities; contractor responsible for care of works until Taking-Over Certificate.',
          citation: 'FIDIC Red Book 2017, Clause 17',
        },
        {
          ref: '18',
          title: 'Exceptional Events',
          text:
            'Notice of exceptional events within 14 days; entitlement to EOT and cost subject to mitigation duty.',
          citation: 'FIDIC Red Book 2017, Clause 18',
        },
        {
          ref: '19',
          title: 'Insurance',
          text:
            'Insurances of the works, third-party liability, and personnel are MANDATORY. Policies must be in joint names (Employer + Contractor) with cross-liability.',
          citation: 'FIDIC Red Book 2017, Clause 19',
        },
        {
          ref: '20',
          title: 'Employer\'s and Contractor\'s Claims',
          text:
            'Notice of Claim within 28 days of awareness — failure is a TIME-BAR. DAAB referral, Engineer determination, amicable settlement, then arbitration.',
          citation: 'FIDIC Red Book 2017, Clause 20',
        },
        {
          ref: '21',
          title: 'Disputes and Arbitration',
          text:
            'Standing Dispute Avoidance/Adjudication Board (DAAB) established at contract start. Arbitration under ICC Rules unless varied.',
          citation: 'FIDIC Red Book 2017, Clause 21',
        },
      ],
    },
  },

  // 2. FIDIC Yellow Book 2017
  {
    title: 'FIDIC Yellow Book 2017 — Required Clauses Reference',
    description:
      'SIGN reference for FIDIC Yellow Book 2017 — Plant and Design-Build Contract.',
    asset_type: AssetType.INTERNATIONAL_STANDARD,
    jurisdiction: 'INTL',
    tags: [
      'standard:FIDIC_YELLOW_BOOK_2017',
      'jurisdiction:INTL',
      'type:STANDARD',
    ],
    content: {
      summary:
        'Yellow Book 2017 places design responsibility on the Contractor. Same claims/dispute machinery as Red Book but with Contractor design liability and Employer\'s Requirements.',
      articles: [
        {
          ref: '5',
          title: 'Design',
          text:
            'Contractor responsible for design including fitness for purpose obligation (a higher standard than reasonable skill and care). Design submissions require Engineer Notice of No-objection.',
          citation: 'FIDIC Yellow Book 2017, Clause 5',
        },
        {
          ref: '4.1',
          title: "Contractor's General Obligations",
          text:
            'Fitness-for-purpose for the works as defined in the Employer\'s Requirements is mandatory and not capable of exclusion under Sub-Clause 1.15 (Limitation of Liability) save for the agreed cap.',
          citation: 'FIDIC Yellow Book 2017, Sub-Clause 4.1',
        },
        {
          ref: '20',
          title: 'Claims',
          text:
            '28-day notice time-bar applies identically to Red Book.',
          citation: 'FIDIC Yellow Book 2017, Clause 20',
        },
      ],
    },
  },

  // 3. NEC4 ECC reference
  {
    title: 'NEC4 ECC — Core Clause Reference',
    description:
      'SIGN reference of the NEC4 Engineering and Construction Contract core clauses.',
    asset_type: AssetType.INTERNATIONAL_STANDARD,
    jurisdiction: 'INTL',
    tags: ['standard:NEC4_ECC', 'jurisdiction:INTL', 'type:STANDARD'],
    content: {
      summary:
        'NEC4 ECC uses six Main Options (A–F) and a flexible compensation event regime requiring mutual trust and co-operation, with strict early warning and 8-week notification time-bars.',
      articles: [
        {
          ref: '10.1',
          title: 'Mutual trust and co-operation',
          text:
            'Both parties must act in a spirit of mutual trust and co-operation — this is a positive contractual duty, not just a backdrop principle.',
          citation: 'NEC4 ECC Clause 10.1',
        },
        {
          ref: '15',
          title: 'Early warning',
          text:
            'Both parties must give early warning of matters that could increase total cost, delay completion, delay a key date, or impair performance. Failure to warn may bar recovery of cost that could have been avoided.',
          citation: 'NEC4 ECC Clause 15',
        },
        {
          ref: '60',
          title: 'Compensation events',
          text:
            'A defined list of events triggers compensation. The Contractor MUST notify within 8 weeks of becoming aware — missed notification = no compensation.',
          citation: 'NEC4 ECC Clauses 60–65',
        },
        {
          ref: '31',
          title: 'Programme',
          text:
            'Contractor must submit a programme for acceptance showing planned completion, key dates, float, and method statements. Programme is the principal management tool.',
          citation: 'NEC4 ECC Clause 31',
        },
        {
          ref: 'W1/W2/W3',
          title: 'Dispute resolution',
          text:
            'Choice of three options: W1 (adjudication), W2 (statutory adjudication for UK Construction Act compliance), W3 (Dispute Avoidance Board). Tribunal usually arbitration.',
          citation: 'NEC4 ECC Option W',
        },
      ],
    },
  },

  // 4. Egyptian Civil Code construction articles
  {
    title: 'Egyptian Civil Code — Construction Mandatory Articles',
    description:
      'SIGN reference of mandatory provisions in the Egyptian Civil Code (Law 131/1948) governing construction contracts.',
    asset_type: AssetType.LAW,
    jurisdiction: 'EG',
    tags: ['jurisdiction:EG', 'type:MANDATORY_LAW'],
    content: {
      summary:
        'Egyptian law overrides certain FIDIC/NEC clauses. The Civil Code muqawala chapter (Articles 646–667) imposes a 10-year decennial liability for collapse, joint and several liability of contractor and architect, and limits on liability waivers.',
      articles: [
        {
          ref: 'Art. 651',
          title: 'Decennial Liability — 10 years',
          text:
            'The contractor and architect are jointly and severally liable for 10 years for total or partial collapse and any defect threatening the stability or safety of the building. Any clause attempting to exclude or limit this liability is void.',
          citation: 'Egyptian Civil Code Article 651',
        },
        {
          ref: 'Art. 658',
          title: 'Lump-Sum Contract Pricing',
          text:
            'In a lump-sum (jaza\'fi) contract, the contractor cannot demand any increase in price for additional works UNLESS such additions were ordered by the employer and a new price was agreed in writing.',
          citation: 'Egyptian Civil Code Article 658',
        },
        {
          ref: 'Art. 663',
          title: 'Termination for Default',
          text:
            'If the contractor commences work in such a manner that it appears the work will be defective or non-conforming, the employer must serve formal notice (إعذار) granting reasonable time for cure before termination.',
          citation: 'Egyptian Civil Code Article 663',
        },
        {
          ref: 'Art. 224–227',
          title: 'Liquidated Damages',
          text:
            'Egyptian courts have power under Article 224 to reduce a stipulated liquidated damages amount if grossly excessive, OR increase if grossly inadequate. LD clauses are not absolutely binding.',
          citation: 'Egyptian Civil Code Articles 224–227',
        },
      ],
    },
  },

  // 5. Egyptian Public Procurement Law 182/2018
  {
    title: 'Egyptian Public Procurement Law No. 182 of 2018',
    description:
      'Mandatory rules governing contracts awarded by Egyptian public-sector entities.',
    asset_type: AssetType.LAW,
    jurisdiction: 'EG',
    tags: [
      'jurisdiction:EG',
      'type:MANDATORY_LAW',
      'subject:public_procurement',
    ],
    content: {
      summary:
        'Law 182/2018 governs public-sector contracts in Egypt — its provisions override conflicting clauses in FIDIC contracts when the Employer is a public entity.',
      articles: [
        {
          ref: 'Art. 33',
          title: 'Performance Security',
          text:
            'Performance security must be 5% of the contract value, in the form of a final letter of guarantee from a local bank. The form, currency, and validity period are prescribed by the executive regulations.',
          citation: 'Law 182/2018 Article 33',
        },
        {
          ref: 'Art. 80',
          title: 'Time-Bars and Disputes',
          text:
            'Contractor claims arising from contract execution must be made in writing within 60 days of awareness. CRCICA arbitration is the default forum unless otherwise specified, with seat in Cairo.',
          citation: 'Law 182/2018 Article 80',
        },
        {
          ref: 'Art. 36',
          title: 'Variations',
          text:
            'Variations of up to 25% of the original contract value may be ordered without retendering. Beyond 25% requires a new tender process.',
          citation: 'Law 182/2018 Article 36',
        },
      ],
    },
  },

  // 6. UAE Civil Code Muqawala
  {
    title: 'UAE Civil Code — Muqawala Provisions',
    description:
      'Mandatory construction-contract provisions in the UAE Civil Transactions Code (Federal Law 5/1985).',
    asset_type: AssetType.LAW,
    jurisdiction: 'AE',
    tags: ['jurisdiction:AE', 'type:MANDATORY_LAW'],
    content: {
      summary:
        'The Muqawala chapter of the UAE Civil Code (Articles 872–896) sets the legal framework for construction. Key features include 10-year decennial liability and strict joint liability for contractor and architect.',
      articles: [
        {
          ref: 'Art. 880',
          title: 'Decennial Liability — 10 years',
          text:
            'The contractor and the supervising architect are jointly liable for 10 years for any total or partial collapse of the building or installations and for any defect threatening the stability or safety of the structure. Any agreement releasing or restricting this liability is null and void.',
          citation: 'UAE Civil Code Article 880',
        },
        {
          ref: 'Art. 877',
          title: 'Variations / Lump-Sum',
          text:
            'In a lump-sum contract, the contractor may not claim increased price for variations unless the variation was made with the employer\'s written consent.',
          citation: 'UAE Civil Code Article 877',
        },
        {
          ref: 'Art. 246',
          title: 'Good Faith',
          text:
            'Contracts must be performed in accordance with their contents and in a manner consistent with the requirements of good faith. UAE courts may invoke this to override harsh contractual outcomes.',
          citation: 'UAE Civil Code Article 246',
        },
      ],
    },
  },

  // 7. UK Housing Grants Act
  {
    title: 'UK Housing Grants, Construction and Regeneration Act 1996',
    description:
      'UK Construction Act mandatory provisions on adjudication and payment.',
    asset_type: AssetType.LAW,
    jurisdiction: 'GB',
    tags: ['jurisdiction:GB', 'type:MANDATORY_LAW'],
    content: {
      summary:
        'The Housing Grants Construction Act (as amended by the LDEDC Act 2009) imposes statutory rights to adjudication and a regime of payment notices and pay-less notices that override contradictory contract terms.',
      articles: [
        {
          ref: 's.108',
          title: 'Right to Adjudication',
          text:
            'Every party to a construction contract has a statutory right to refer a dispute to adjudication at any time. Contracts must comply with the adjudication procedure or the Scheme for Construction Contracts is implied.',
          citation: 'Housing Grants Act s.108',
        },
        {
          ref: 's.109',
          title: 'Right to Stage Payments',
          text:
            'Every party is entitled to receive interim or stage payments unless the contract is for works under 45 days duration.',
          citation: 'Housing Grants Act s.109',
        },
        {
          ref: 's.110A',
          title: 'Payment and Pay-Less Notices',
          text:
            'A payer must serve a payment notice within 5 days of the due date, or the payee\'s notified sum becomes the default. To pay less, a pay-less notice must be served before the final date for payment.',
          citation: 'Housing Grants Act s.110A',
        },
        {
          ref: 's.113',
          title: 'Pay-When-Paid Prohibited',
          text:
            'Pay-when-paid clauses are unenforceable except where the third party is insolvent.',
          citation: 'Housing Grants Act s.113',
        },
      ],
    },
  },

  // 8. FIDIC vs Egyptian law conflict guide
  {
    title: 'FIDIC vs Egyptian Law — Conflict Resolution Guide',
    description:
      'Common conflicts between FIDIC Red Book 2017 and Egyptian mandatory law, and recommended Particular Conditions.',
    asset_type: AssetType.KNOWLEDGE,
    jurisdiction: 'EG',
    tags: [
      'jurisdiction:EG',
      'standard:FIDIC_RED_BOOK_2017',
      'type:CONFLICT_GUIDE',
    ],
    content: {
      summary:
        'Egyptian mandatory law overrides several FIDIC provisions. This guide identifies the points of friction and recommends Particular Conditions amendments.',
      articles: [
        {
          ref: 'Conflict 1',
          title: 'Limitation of Liability vs Decennial Liability',
          text:
            'FIDIC Sub-Clause 1.15 caps total liability. Egyptian Civil Code Article 651 imposes mandatory 10-year decennial liability for collapse that cannot be capped or excluded. Recommendation: Particular Condition reciting that Sub-Clause 1.15 does not limit decennial liability.',
          citation: 'FIDIC 1.15 vs Egyptian CC 651',
        },
        {
          ref: 'Conflict 2',
          title: 'Liquidated Damages',
          text:
            'FIDIC delay damages are typically a fixed percentage. Egyptian courts under Article 224 may adjust LD if grossly excessive or inadequate. Recommendation: include factual basis for LD calculation in the Particular Conditions.',
          citation: 'FIDIC 8.8 vs Egyptian CC 224',
        },
        {
          ref: 'Conflict 3',
          title: 'Time-Bars',
          text:
            'FIDIC 28-day notice time-bar may not be enforced strictly by Egyptian courts where the bar would lead to unjust enrichment. Recommendation: ensure the Engineer maintains contemporaneous records to mitigate strict-enforcement risk.',
          citation: 'FIDIC 20.2 vs Egyptian CC general principles',
        },
        {
          ref: 'Conflict 4',
          title: 'Governing Law and Arbitration',
          text:
            'When the Employer is an Egyptian public entity, Law 182/2018 may impose CRCICA arbitration. Recommendation: align FIDIC Sub-Clause 21.6 with Law 182/2018 Article 80 to avoid invalidation.',
          citation: 'FIDIC 21 vs Law 182/2018 Article 80',
        },
      ],
    },
  },

  // 9. FIDIC vs UAE law conflict guide
  {
    title: 'FIDIC vs UAE Law — Conflict Resolution Guide',
    description:
      'Common conflicts between FIDIC Red Book 2017 and UAE Civil Code, with recommended Particular Conditions.',
    asset_type: AssetType.KNOWLEDGE,
    jurisdiction: 'AE',
    tags: [
      'jurisdiction:AE',
      'standard:FIDIC_RED_BOOK_2017',
      'type:CONFLICT_GUIDE',
    ],
    content: {
      summary:
        'UAE Civil Code Articles 880, 877, and 246 override common FIDIC limitation, variation, and good-faith provisions.',
      articles: [
        {
          ref: 'Conflict 1',
          title: 'Decennial Liability',
          text:
            'FIDIC limitations cannot exclude UAE Civil Code Article 880 decennial liability. Particular Conditions should explicitly carve this out.',
          citation: 'FIDIC 1.15 vs UAE CC 880',
        },
        {
          ref: 'Conflict 2',
          title: 'Lump-Sum Variations',
          text:
            'UAE Article 877 requires written consent for any variation in a lump-sum contract. FIDIC Sub-Clause 13.3 (Variation Procedure) should be aligned with this requirement to avoid unenforceable variations.',
          citation: 'FIDIC 13 vs UAE CC 877',
        },
        {
          ref: 'Conflict 3',
          title: 'Good Faith Override',
          text:
            'UAE Article 246 imposes a duty of good faith that may override harsh contractual outcomes. UAE courts have used this to soften time-bars and forfeiture clauses.',
          citation: 'FIDIC general vs UAE CC 246',
        },
        {
          ref: 'Conflict 4',
          title: 'Dispute Resolution',
          text:
            'For Dubai-based projects, DIAC arbitration is typical; for Abu Dhabi, ADGMAC or onshore courts. FIDIC Sub-Clause 21.6 default of ICC may be inappropriate without amendment.',
          citation: 'FIDIC 21 vs UAE practice',
        },
      ],
    },
  },
];
