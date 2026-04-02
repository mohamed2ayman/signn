import { DataSource } from 'typeorm';
import { KnowledgeAsset, AssetType, AssetReviewStatus } from '../entities';

/**
 * Standard Forms of Contract — Template Seed Data
 *
 * Each record populates knowledge_assets with:
 * - CONTRACT_TEMPLATE asset type
 * - Clause structure stored in content field as JSON
 * - Licensed content placeholders (text = "")
 *
 * IMPORTANT: Actual clause text is protected by copyright.
 * The text field is left empty with a note.
 */

const LICENSED_TEXT_NOTE = 'Licensed content — to be populated upon license acquisition';

interface SubClause {
  sub_clause_number: string;
  sub_clause_title: string;
  text: string;
}

interface ClauseStructure {
  clause_number: string;
  clause_title: string;
  text: string;
  sub_clauses: SubClause[];
}

interface TemplateRecord {
  title: string;
  organization: string;
  contract_type_code: string;
  edition: string;
  color_name: string | null;
  description: string;
  image_url: string | null;
  clause_structure: ClauseStructure[];
}

// ─── Official Book Cover Image URLs ────────────────────────
// Images are the intellectual property of FIDIC and NEC respectively.
// Displayed only for informational/referral purposes consistent with
// fair use for product identification. Always loaded from original source.
const IMAGE_URLS: Record<string, string> = {
  // FIDIC
  FIDIC_RED_BOOK_2017: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/RED_reprint_3D_NO_LABEL_0.png',
  FIDIC_YELLOW_BOOK_2017: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/YELLOW_reprint_3D_NO_LABEL.png',
  FIDIC_SILVER_BOOK_2017: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/SILVER_reprint_3D_NO_LABEL.png',
  FIDIC_WHITE_BOOK_2017: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/WB5-cover-3D-2.png',
  FIDIC_GREEN_BOOK_2021: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/2021_green_book_2_3D_NO%20LABEL.png',
  FIDIC_EMERALD_BOOK_2019: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/emerald_2023_reprint_3D_2labels.png',
  FIDIC_RED_BOOK_1999: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/RED_reprint_3D_NO_LABEL_0.png',
  FIDIC_YELLOW_BOOK_1999: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/YELLOW_reprint_3D_NO_LABEL.png',
  FIDIC_SILVER_BOOK_1999: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/SILVER_reprint_3D_NO_LABEL.png',
  FIDIC_SUBCONTRACT_YELLOW_2019: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/subcontract_3D_0.png',
  FIDIC_PINK_BOOK: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/RED_reprint_3D_NO_LABEL_0.png',
  FIDIC_BLUE_GREEN_BOOK_2016: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/RED_reprint_3D_NO_LABEL_0.png',
  // NEC4
  NEC4_ECC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/40839106-7ba5-4bf7-9584-70f75222de24/NEC4-ECC.jpg?width=234',
  NEC4_PSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/e96d4e53-a21b-4ba6-a224-fc8061fc8d8f/NEC4-PSC.jpg?width=234',
  NEC4_TSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/039e4640-8dfa-4c4d-ab2b-ad8a52e94f8d/NEC4-TSC.jpg?width=234',
  NEC4_SC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/0ee1e75e-2d90-467a-a9bc-0ea0f01598e6/NEC4-SC.jpg?width=234',
  NEC4_FC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5115d192-5c25-4525-be40-e9cbce6f375a/NEC4-FC.jpg?width=234',
  NEC4_DBOC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/bbd74f95-6fb9-48fc-93e5-c8d83660bed2/NEC4-DBOC.jpg?width=234',
  NEC4_FMC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/9508474e-91a1-4b6f-8996-43a14c461f05/Front-cover-FMC.jpg?width=234',
  NEC4_ALC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/9d1f7d6e-148a-49df-974c-4960ea43708f/NEC4-ALC.jpg?width=234',
  NEC4_DRSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/94c5d3d0-e920-4cf2-ae84-324fdebfad81/NEC4-DRSC.jpg?width=234',
  // NEC3
  NEC3_ECC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/d3f26b9a-78f6-416e-a5ac-47856ed89c53/ECC-2013AW.jpg?width=234',
  NEC3_PSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/b23b41ef-8790-4c53-a20f-f76959a7a3cd/PSC-2013AW.jpg?width=234',
  NEC3_TSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5c2a49bf-91e5-4c42-bcd6-f29ce0a40017/TSC-2013AW.jpg?width=234',
  NEC3_SC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/b78a7ac9-b692-4bd9-916d-a1d37092357c/SC-2013AW.jpg?width=234',
  NEC3_FC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/2d2bbb3b-a133-4c57-affc-71707a050de2/FC-2013AW.jpg?width=234',
  NEC3_AC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5619ed58-5542-4cb4-b201-04a238e4db88/AC-2013AW.jpg?width=234',
  // NEC HK
  NEC_ECC_HK: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/d3f26b9a-78f6-416e-a5ac-47856ed89c53/ECC-2013AW.jpg?width=234',
  NEC_TSC_HK: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5c2a49bf-91e5-4c42-bcd6-f29ce0a40017/TSC-2013AW.jpg?width=234',
  // FAC/TAC
  FAC_1: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getattachment/d539b43f-aed1-468d-bc28-8a3ec0ae024b/FAC1-1.jpg?width=234',
  TAC_1: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getattachment/d539b43f-aed1-468d-bc28-8a3ec0ae024b/FAC1-1.jpg?width=234',
};

// ─────────────────────────────────────────────────────────────
// FIDIC Red Book 2017 — Conditions of Contract for Construction
// ─────────────────────────────────────────────────────────────
const FIDIC_RED_2017: TemplateRecord = {
  title: 'Conditions of Contract for Construction',
  organization: 'FIDIC',
  contract_type_code: 'FIDIC_RED_BOOK_2017',
  edition: '2nd Edition 2017',
  color_name: 'Red Book',
  description: 'For building and engineering works designed by the Employer (or by the Engineer).',
  image_url: IMAGE_URLS.FIDIC_RED_BOOK_2017,
  clause_structure: [
    { clause_number: '1', clause_title: 'General Provisions', text: '', sub_clauses: [
      { sub_clause_number: '1.1', sub_clause_title: 'Definitions', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.2', sub_clause_title: 'Interpretation', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.3', sub_clause_title: 'Notices and Other Communications', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.4', sub_clause_title: 'Law and Language', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.5', sub_clause_title: 'Priority of Documents', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.6', sub_clause_title: 'Contract Agreement', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.7', sub_clause_title: 'Assignment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.8', sub_clause_title: 'Care and Supply of Documents', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.9', sub_clause_title: 'Delayed Drawings or Instructions', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.10', sub_clause_title: 'Employer\'s Use of Contractor\'s Documents', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.11', sub_clause_title: 'Contractor\'s Use of Employer\'s Documents', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.12', sub_clause_title: 'Confidential Details', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.13', sub_clause_title: 'Compliance with Laws', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.14', sub_clause_title: 'Joint and Several Liability', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.15', sub_clause_title: 'Limitation of Liability', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '1.16', sub_clause_title: 'Contract in Full Force and Effect', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '2', clause_title: 'The Employer', text: '', sub_clauses: [
      { sub_clause_number: '2.1', sub_clause_title: 'Right of Access to the Site', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '2.2', sub_clause_title: 'Assistance', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '2.3', sub_clause_title: 'Employer\'s Personnel and Other Contractors', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '2.4', sub_clause_title: 'Employer\'s Financial Arrangements', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '2.5', sub_clause_title: 'Employer\'s Claims', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '2.6', sub_clause_title: 'Employer\'s Equipment, Free-Issue Materials and Access Routes', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '3', clause_title: 'The Engineer', text: '', sub_clauses: [
      { sub_clause_number: '3.1', sub_clause_title: 'The Engineer\'s Duties and Authority', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '3.2', sub_clause_title: 'The Engineer\'s Representative', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '3.3', sub_clause_title: 'The Engineer\'s Instructions', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '3.4', sub_clause_title: 'Replacement of the Engineer', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '3.5', sub_clause_title: 'Engineer\'s Determinations', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '3.6', sub_clause_title: 'Meetings', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '3.7', sub_clause_title: 'Agreement or Determination', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '4', clause_title: 'The Contractor', text: '', sub_clauses: [
      { sub_clause_number: '4.1', sub_clause_title: 'Contractor\'s General Obligations', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.2', sub_clause_title: 'Performance Security', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.3', sub_clause_title: 'Contractor\'s Representative', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.4', sub_clause_title: 'Subcontractors', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.5', sub_clause_title: 'Nominated Subcontractors', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.6', sub_clause_title: 'Co-operation', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.7', sub_clause_title: 'Setting Out', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.8', sub_clause_title: 'Health and Safety Obligations', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.9', sub_clause_title: 'Quality Management and Compliance Verification Systems', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.10', sub_clause_title: 'Use of Site Data', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.11', sub_clause_title: 'Sufficiency of the Accepted Contract Amount', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.12', sub_clause_title: 'Unforeseeable Physical Conditions', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.13', sub_clause_title: 'Rights of Way and Facilities', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.14', sub_clause_title: 'Avoidance of Interference', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.15', sub_clause_title: 'Access Route', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.16', sub_clause_title: 'Transport of Goods', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.17', sub_clause_title: 'Contractor\'s Equipment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.18', sub_clause_title: 'Protection of the Environment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.19', sub_clause_title: 'Temporary Utilities', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.20', sub_clause_title: 'Progress Reports', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.21', sub_clause_title: 'Security of the Site', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.22', sub_clause_title: 'Contractor\'s Operations on Site', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '4.23', sub_clause_title: 'Archaeological and Geological Findings', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '5', clause_title: 'Design', text: '', sub_clauses: [
      { sub_clause_number: '5.1', sub_clause_title: 'General Design Obligations', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '5.2', sub_clause_title: 'Contractor\'s Documents', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '5.3', sub_clause_title: 'Contractor\'s Undertaking', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '5.4', sub_clause_title: 'Technical Standards and Regulations', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '5.5', sub_clause_title: 'Training', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '5.6', sub_clause_title: 'As-Built Documents', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '5.7', sub_clause_title: 'Operation and Maintenance Manuals', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '5.8', sub_clause_title: 'Design Error', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '6', clause_title: 'Staff and Labour', text: '', sub_clauses: [
      { sub_clause_number: '6.1', sub_clause_title: 'Engagement of Staff and Labour', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.2', sub_clause_title: 'Rates of Wages and Conditions of Labour', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.3', sub_clause_title: 'Persons in the Service of Employer', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.4', sub_clause_title: 'Labour Laws', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.5', sub_clause_title: 'Working Hours', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.6', sub_clause_title: 'Facilities for Staff and Labour', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.7', sub_clause_title: 'Health and Safety', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.8', sub_clause_title: 'Contractor\'s Superintendence', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.9', sub_clause_title: 'Contractor\'s Personnel', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '6.10', sub_clause_title: 'Records of Contractor\'s Personnel and Equipment', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '7', clause_title: 'Plant, Materials and Workmanship', text: '', sub_clauses: [
      { sub_clause_number: '7.1', sub_clause_title: 'Manner of Execution', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '7.2', sub_clause_title: 'Samples', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '7.3', sub_clause_title: 'Inspection', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '7.4', sub_clause_title: 'Testing', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '7.5', sub_clause_title: 'Rejection', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '7.6', sub_clause_title: 'Remedial Work', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '7.7', sub_clause_title: 'Ownership of Plant and Materials', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '7.8', sub_clause_title: 'Royalties', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '8', clause_title: 'Commencement, Delays and Suspension', text: '', sub_clauses: [
      { sub_clause_number: '8.1', sub_clause_title: 'Commencement of Works', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.2', sub_clause_title: 'Time for Completion', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.3', sub_clause_title: 'Programme', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.4', sub_clause_title: 'Extension of Time for Completion', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.5', sub_clause_title: 'Delays Caused by Authorities', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.6', sub_clause_title: 'Rate of Progress', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.7', sub_clause_title: 'Delay Damages', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.8', sub_clause_title: 'Suspension of Work', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.9', sub_clause_title: 'Consequences of Suspension', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.10', sub_clause_title: 'Payment for Plant and Materials in Event of Suspension', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.11', sub_clause_title: 'Prolonged Suspension', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '8.12', sub_clause_title: 'Resumption of Work', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '9', clause_title: 'Tests on Completion', text: '', sub_clauses: [
      { sub_clause_number: '9.1', sub_clause_title: 'Contractor\'s Obligations', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '9.2', sub_clause_title: 'Delayed Tests', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '9.3', sub_clause_title: 'Retesting', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '9.4', sub_clause_title: 'Failure to Pass Tests on Completion', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '10', clause_title: 'Employer\'s Taking Over', text: '', sub_clauses: [
      { sub_clause_number: '10.1', sub_clause_title: 'Taking Over of the Works and Sections', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '10.2', sub_clause_title: 'Taking Over of Parts of the Works', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '10.3', sub_clause_title: 'Interference with Tests on Completion', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '10.4', sub_clause_title: 'Surfaces Requiring Reinstatement', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '11', clause_title: 'Defects after Taking Over', text: '', sub_clauses: [
      { sub_clause_number: '11.1', sub_clause_title: 'Completion of Outstanding Work and Remedying Defects', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.2', sub_clause_title: 'Cost of Remedying Defects', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.3', sub_clause_title: 'Extension of Defects Notification Period', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.4', sub_clause_title: 'Failure to Remedy Defects', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.5', sub_clause_title: 'Removal of Defective Work', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.6', sub_clause_title: 'Further Tests', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.7', sub_clause_title: 'Right of Access', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.8', sub_clause_title: 'Contractor to Search', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.9', sub_clause_title: 'Performance Certificate', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.10', sub_clause_title: 'Unfulfilled Obligations', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '11.11', sub_clause_title: 'Clearance of Site', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '12', clause_title: 'Measurement and Evaluation', text: '', sub_clauses: [
      { sub_clause_number: '12.1', sub_clause_title: 'Works to be Measured', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '12.2', sub_clause_title: 'Method of Measurement', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '12.3', sub_clause_title: 'Evaluation', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '12.4', sub_clause_title: 'Omissions', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '13', clause_title: 'Variations and Adjustments', text: '', sub_clauses: [
      { sub_clause_number: '13.1', sub_clause_title: 'Right to Vary', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '13.2', sub_clause_title: 'Value Engineering', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '13.3', sub_clause_title: 'Variation Procedure', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '13.4', sub_clause_title: 'Provisional Sums', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '13.5', sub_clause_title: 'Daywork', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '13.6', sub_clause_title: 'Adjustments for Changes in Legislation', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '13.7', sub_clause_title: 'Adjustments for Changes in Cost', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '14', clause_title: 'Contract Price and Payment', text: '', sub_clauses: [
      { sub_clause_number: '14.1', sub_clause_title: 'The Contract Price', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.2', sub_clause_title: 'Advance Payment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.3', sub_clause_title: 'Application for Interim Payment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.4', sub_clause_title: 'Schedule of Payments', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.5', sub_clause_title: 'Plant and Materials intended for the Works', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.6', sub_clause_title: 'Interim Payments', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.7', sub_clause_title: 'Payment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.8', sub_clause_title: 'Delayed Payment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.9', sub_clause_title: 'Payment of Retention Money', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.10', sub_clause_title: 'Statement at Completion', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.11', sub_clause_title: 'Application for Final Payment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.12', sub_clause_title: 'Discharge', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.13', sub_clause_title: 'Final Payment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.14', sub_clause_title: 'Cessation of Employer\'s Liability', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '14.15', sub_clause_title: 'Currencies of Payment', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '15', clause_title: 'Termination by Employer', text: '', sub_clauses: [
      { sub_clause_number: '15.1', sub_clause_title: 'Notice to Correct', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '15.2', sub_clause_title: 'Termination for Contractor\'s Default', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '15.3', sub_clause_title: 'Valuation after Termination for Contractor\'s Default', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '15.4', sub_clause_title: 'Payment after Termination for Contractor\'s Default', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '15.5', sub_clause_title: 'Termination for Employer\'s Convenience', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '15.6', sub_clause_title: 'Corrupt or Fraudulent Practices', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '16', clause_title: 'Suspension and Termination by Contractor', text: '', sub_clauses: [
      { sub_clause_number: '16.1', sub_clause_title: 'Contractor\'s Entitlement to Suspend Work', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '16.2', sub_clause_title: 'Termination by Contractor', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '16.3', sub_clause_title: 'Cessation of Work and Removal of Contractor\'s Equipment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '16.4', sub_clause_title: 'Payment on Termination by Contractor', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '17', clause_title: 'Care of the Works and Indemnities', text: '', sub_clauses: [
      { sub_clause_number: '17.1', sub_clause_title: 'Responsibility for Care of the Works', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '17.2', sub_clause_title: 'Contractor\'s Care of the Works', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '17.3', sub_clause_title: 'Employer\'s Risks', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '17.4', sub_clause_title: 'Consequences of Employer\'s Risks', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '17.5', sub_clause_title: 'Intellectual and Industrial Property Rights', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '17.6', sub_clause_title: 'Limitation of Liability', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '18', clause_title: 'Insurance', text: '', sub_clauses: [
      { sub_clause_number: '18.1', sub_clause_title: 'General Requirements for Insurances', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '18.2', sub_clause_title: 'Insurance for Works and Contractor\'s Equipment', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '18.3', sub_clause_title: 'Insurance against Injury to Persons and Damage to Property', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '18.4', sub_clause_title: 'Insurance for Contractor\'s Personnel', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '19', clause_title: 'Force Majeure', text: '', sub_clauses: [
      { sub_clause_number: '19.1', sub_clause_title: 'Definition of Force Majeure', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '19.2', sub_clause_title: 'Notice of Force Majeure', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '19.3', sub_clause_title: 'Duty to Minimise Delay', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '19.4', sub_clause_title: 'Consequences of Force Majeure', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '19.5', sub_clause_title: 'Force Majeure Affecting Subcontractor', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '19.6', sub_clause_title: 'Optional Termination, Payment and Release', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '19.7', sub_clause_title: 'Release from Performance under the Law', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '20', clause_title: 'Employer\'s and Contractor\'s Claims', text: '', sub_clauses: [
      { sub_clause_number: '20.1', sub_clause_title: 'Claims', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '20.2', sub_clause_title: 'Claims For Payment and/or EOT', text: LICENSED_TEXT_NOTE },
    ]},
    { clause_number: '21', clause_title: 'Disputes and Arbitration', text: '', sub_clauses: [
      { sub_clause_number: '21.1', sub_clause_title: 'Constitution of the DAAB', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '21.2', sub_clause_title: 'Failure to Appoint DAAB Member(s)', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '21.3', sub_clause_title: 'Avoidance of Disputes', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '21.4', sub_clause_title: 'Obtaining DAAB\'s Decision', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '21.5', sub_clause_title: 'Amicable Settlement', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '21.6', sub_clause_title: 'Arbitration', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '21.7', sub_clause_title: 'Failure to Comply with DAAB\'s Decision', text: LICENSED_TEXT_NOTE },
      { sub_clause_number: '21.8', sub_clause_title: 'No DAAB in Place', text: LICENSED_TEXT_NOTE },
    ]},
  ],
};

// Helper to create minimal structure for other forms that share FIDIC 2017 structure
function createFidicStructure(overrides: Partial<TemplateRecord>): TemplateRecord {
  return { ...FIDIC_RED_2017, ...overrides };
}

// ─────────────────────────────────────────────────────────────
// NEC4 ECC — Core Clauses
// ─────────────────────────────────────────────────────────────
const NEC4_ECC_STRUCTURE: ClauseStructure[] = [
  { clause_number: '1', clause_title: 'General', text: '', sub_clauses: [
    { sub_clause_number: '10', sub_clause_title: 'Actions', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '11', sub_clause_title: 'Identified and defined terms', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '12', sub_clause_title: 'Interpretation and the law', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '13', sub_clause_title: 'Communications', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '14', sub_clause_title: 'The Project Manager and the Supervisor', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '15', sub_clause_title: 'Early warning and risk reduction meetings', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '16', sub_clause_title: 'Preventing corruption and improving standards', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '17', sub_clause_title: 'Ambiguities and inconsistencies', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '18', sub_clause_title: 'Health and safety', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '19', sub_clause_title: 'Prevention', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '2', clause_title: 'The Contractor\'s main responsibilities', text: '', sub_clauses: [
    { sub_clause_number: '20', sub_clause_title: 'Providing the Works', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '21', sub_clause_title: 'The Contractor\'s design', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '22', sub_clause_title: 'Using the Contractor\'s design', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '23', sub_clause_title: 'Design of equipment', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '24', sub_clause_title: 'People', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '25', sub_clause_title: 'Working with the Client and Others', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '26', sub_clause_title: 'Subcontracting', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '27', sub_clause_title: 'Other responsibilities', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '28', sub_clause_title: 'The Contractor and the law', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '3', clause_title: 'Time', text: '', sub_clauses: [
    { sub_clause_number: '30', sub_clause_title: 'Starting and the completion date', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '31', sub_clause_title: 'The programme', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '32', sub_clause_title: 'Revising the programme', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '33', sub_clause_title: 'Access to and use of the Site', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '34', sub_clause_title: 'Instructions to stop or not to start work', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '35', sub_clause_title: 'Take over', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '36', sub_clause_title: 'Acceleration', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '4', clause_title: 'Quality', text: '', sub_clauses: [
    { sub_clause_number: '40', sub_clause_title: 'Tests and inspections', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '41', sub_clause_title: 'Testing and inspection before delivery', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '42', sub_clause_title: 'Searching for and notifying Defects', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '43', sub_clause_title: 'Correcting Defects', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '44', sub_clause_title: 'Accepting Defects', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '45', sub_clause_title: 'Uncorrected Defects', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '5', clause_title: 'Payment', text: '', sub_clauses: [
    { sub_clause_number: '50', sub_clause_title: 'Assessing the amount due', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '51', sub_clause_title: 'Payment', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '52', sub_clause_title: 'Defined Cost', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '53', sub_clause_title: 'The Contractor\'s share', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '6', clause_title: 'Compensation events', text: '', sub_clauses: [
    { sub_clause_number: '60', sub_clause_title: 'Compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '61', sub_clause_title: 'Notifying compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '62', sub_clause_title: 'Quotations for compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '63', sub_clause_title: 'Assessing compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '64', sub_clause_title: 'The Project Manager\'s assessments', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '65', sub_clause_title: 'Implementing compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '66', sub_clause_title: 'Proceedings of the compensation event process', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '7', clause_title: 'Title', text: '', sub_clauses: [
    { sub_clause_number: '70', sub_clause_title: 'The Client\'s title to objects, materials and Plant', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '71', sub_clause_title: 'Marking, removing and re-delivering Equipment', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '72', sub_clause_title: 'Objects and materials within the Site', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '73', sub_clause_title: 'Intellectual property rights', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '8', clause_title: 'Indemnity, insurance and liability', text: '', sub_clauses: [
    { sub_clause_number: '80', sub_clause_title: 'Client\'s risks', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '81', sub_clause_title: 'The Contractor\'s risks', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '82', sub_clause_title: 'Indemnity', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '83', sub_clause_title: 'Insurance cover', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '84', sub_clause_title: 'Insurance policies', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '85', sub_clause_title: 'Limitation of liability', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '9', clause_title: 'Termination', text: '', sub_clauses: [
    { sub_clause_number: '90', sub_clause_title: 'Termination', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '91', sub_clause_title: 'Reasons for termination', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '92', sub_clause_title: 'Procedures on termination', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '93', sub_clause_title: 'Payment on termination', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: 'W', clause_title: 'Dispute resolution', text: '', sub_clauses: [
    { sub_clause_number: 'W1', sub_clause_title: 'Dispute resolution — Option W1', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: 'W2', sub_clause_title: 'Dispute resolution — Option W2', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: 'W3', sub_clause_title: 'Dispute resolution — Option W3', text: LICENSED_TEXT_NOTE },
  ]},
];

// Simplified NEC PSC structure (core clauses differ)
const NEC_PSC_STRUCTURE: ClauseStructure[] = [
  { clause_number: '1', clause_title: 'General', text: '', sub_clauses: [
    { sub_clause_number: '10', sub_clause_title: 'Actions', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '11', sub_clause_title: 'Identified and defined terms', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '12', sub_clause_title: 'Interpretation and the law', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '13', sub_clause_title: 'Communications', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '2', clause_title: 'The Consultant\'s main responsibilities', text: '', sub_clauses: [
    { sub_clause_number: '20', sub_clause_title: 'Providing the services', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '21', sub_clause_title: 'The Consultant\'s plan', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '22', sub_clause_title: 'Using the Consultant\'s work', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '23', sub_clause_title: 'People', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '24', sub_clause_title: 'Subcontracting', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '25', sub_clause_title: 'Co-operation', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '3', clause_title: 'Time', text: '', sub_clauses: [
    { sub_clause_number: '30', sub_clause_title: 'Starting and completion', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '31', sub_clause_title: 'The programme', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '32', sub_clause_title: 'Instructions to stop or not to start work', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '4', clause_title: 'Quality', text: '', sub_clauses: [
    { sub_clause_number: '40', sub_clause_title: 'Quality management', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '41', sub_clause_title: 'Correcting Defects', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '42', sub_clause_title: 'Accepting Defects', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '5', clause_title: 'Payment', text: '', sub_clauses: [
    { sub_clause_number: '50', sub_clause_title: 'Assessing the amount due', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '51', sub_clause_title: 'Payment', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '6', clause_title: 'Compensation events', text: '', sub_clauses: [
    { sub_clause_number: '60', sub_clause_title: 'Compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '61', sub_clause_title: 'Notifying compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '62', sub_clause_title: 'Quotations for compensation events', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '63', sub_clause_title: 'Implementing compensation events', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '8', clause_title: 'Indemnity, insurance and liability', text: '', sub_clauses: [
    { sub_clause_number: '80', sub_clause_title: 'Indemnity', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '81', sub_clause_title: 'Insurance', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '82', sub_clause_title: 'Limitation of liability', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '9', clause_title: 'Termination', text: '', sub_clauses: [
    { sub_clause_number: '90', sub_clause_title: 'Termination', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '91', sub_clause_title: 'Reasons for termination', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '92', sub_clause_title: 'Procedures on termination', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '93', sub_clause_title: 'Payment on termination', text: LICENSED_TEXT_NOTE },
  ]},
];

// Short-form NEC (SC, FC, etc.)
const NEC_SHORT_STRUCTURE: ClauseStructure[] = [
  { clause_number: '1', clause_title: 'General', text: '', sub_clauses: [
    { sub_clause_number: '10', sub_clause_title: 'Actions', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '11', sub_clause_title: 'Identified and defined terms', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '12', sub_clause_title: 'Interpretation and the law', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '13', sub_clause_title: 'Communications', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '2', clause_title: 'Responsibilities', text: '', sub_clauses: [
    { sub_clause_number: '20', sub_clause_title: 'Providing the goods or services', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '21', sub_clause_title: 'People and subcontracting', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '3', clause_title: 'Time', text: '', sub_clauses: [
    { sub_clause_number: '30', sub_clause_title: 'Starting and delivery', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '31', sub_clause_title: 'Programme', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '4', clause_title: 'Quality', text: '', sub_clauses: [
    { sub_clause_number: '40', sub_clause_title: 'Quality', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '41', sub_clause_title: 'Defects', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '5', clause_title: 'Payment', text: '', sub_clauses: [
    { sub_clause_number: '50', sub_clause_title: 'Payment', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '51', sub_clause_title: 'Defined Cost', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '6', clause_title: 'Compensation events', text: '', sub_clauses: [
    { sub_clause_number: '60', sub_clause_title: 'Compensation events', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '9', clause_title: 'Termination', text: '', sub_clauses: [
    { sub_clause_number: '90', sub_clause_title: 'Termination', text: LICENSED_TEXT_NOTE },
  ]},
];

// FIDIC 1999 Red Book has similar structure to 2017 but 20 clauses
const FIDIC_1999_STRUCTURE: ClauseStructure[] = FIDIC_RED_2017.clause_structure.slice(0, 20);

// FIDIC Green Book — simplified short form
const FIDIC_GREEN_STRUCTURE: ClauseStructure[] = [
  { clause_number: '1', clause_title: 'General Provisions', text: '', sub_clauses: [
    { sub_clause_number: '1.1', sub_clause_title: 'Definitions', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '1.2', sub_clause_title: 'Law and Language', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '1.3', sub_clause_title: 'Notices', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '1.4', sub_clause_title: 'Contract Agreement', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '1.5', sub_clause_title: 'Documents Forming the Contract', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '1.6', sub_clause_title: 'Assignment', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '2', clause_title: 'The Employer', text: '', sub_clauses: [
    { sub_clause_number: '2.1', sub_clause_title: 'Provision of Site', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '2.2', sub_clause_title: 'Financial Arrangements', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '3', clause_title: 'The Employer\'s Representative', text: '', sub_clauses: [
    { sub_clause_number: '3.1', sub_clause_title: 'Employer\'s Representative', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '3.2', sub_clause_title: 'Instructions', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '4', clause_title: 'The Contractor', text: '', sub_clauses: [
    { sub_clause_number: '4.1', sub_clause_title: 'General Obligations', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '4.2', sub_clause_title: 'Performance Security', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '4.3', sub_clause_title: 'Subcontracting', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '5', clause_title: 'Time for Completion', text: '', sub_clauses: [
    { sub_clause_number: '5.1', sub_clause_title: 'Commencement', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '5.2', sub_clause_title: 'Time for Completion', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '5.3', sub_clause_title: 'Programme', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '5.4', sub_clause_title: 'Extension of Time', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '6', clause_title: 'Defects Liability', text: '', sub_clauses: [
    { sub_clause_number: '6.1', sub_clause_title: 'Remedying Defects', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '6.2', sub_clause_title: 'Cost of Remedying', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '7', clause_title: 'Payment', text: '', sub_clauses: [
    { sub_clause_number: '7.1', sub_clause_title: 'Contract Price', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '7.2', sub_clause_title: 'Interim Payments', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '7.3', sub_clause_title: 'Final Payment', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '8', clause_title: 'Variations', text: '', sub_clauses: [
    { sub_clause_number: '8.1', sub_clause_title: 'Right to Vary', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '8.2', sub_clause_title: 'Valuation of Variations', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '9', clause_title: 'Employer\'s and Contractor\'s Claims', text: '', sub_clauses: [
    { sub_clause_number: '9.1', sub_clause_title: 'Claims Procedure', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '10', clause_title: 'Default and Termination', text: '', sub_clauses: [
    { sub_clause_number: '10.1', sub_clause_title: 'Employer\'s Default', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '10.2', sub_clause_title: 'Contractor\'s Default', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '10.3', sub_clause_title: 'Termination for Convenience', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '11', clause_title: 'Risk and Insurance', text: '', sub_clauses: [
    { sub_clause_number: '11.1', sub_clause_title: 'Allocation of Risks', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '11.2', sub_clause_title: 'Insurance', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '11.3', sub_clause_title: 'Force Majeure', text: LICENSED_TEXT_NOTE },
  ]},
  { clause_number: '12', clause_title: 'Dispute Resolution', text: '', sub_clauses: [
    { sub_clause_number: '12.1', sub_clause_title: 'Adjudication', text: LICENSED_TEXT_NOTE },
    { sub_clause_number: '12.2', sub_clause_title: 'Arbitration', text: LICENSED_TEXT_NOTE },
  ]},
];

// ─────────────────────────────────────────────────────────────
// Complete template registry
// ─────────────────────────────────────────────────────────────
export const CONTRACT_TEMPLATES: TemplateRecord[] = [
  // FIDIC 2017 Rainbow Suite
  FIDIC_RED_2017,
  createFidicStructure({
    title: 'Conditions of Contract for Plant and Design-Build',
    contract_type_code: 'FIDIC_YELLOW_BOOK_2017',
    edition: '2nd Edition 2017',
    color_name: 'Yellow Book',
    description: 'For electrical and mechanical plant and for building and engineering works designed by the Contractor.',
    image_url: IMAGE_URLS.FIDIC_YELLOW_BOOK_2017,
  }),
  createFidicStructure({
    title: 'Conditions of Contract for EPC/Turnkey Projects',
    contract_type_code: 'FIDIC_SILVER_BOOK_2017',
    edition: '2nd Edition 2017',
    color_name: 'Silver Book',
    description: 'For EPC/Turnkey projects where the Contractor takes total responsibility for design and execution.',
    image_url: IMAGE_URLS.FIDIC_SILVER_BOOK_2017,
  }),
  {
    title: 'Client/Consultant Model Services Agreement',
    organization: 'FIDIC',
    contract_type_code: 'FIDIC_WHITE_BOOK_2017',
    edition: '5th Edition 2017',
    color_name: 'White Book',
    description: 'For pre-investment and feasibility studies, designs and administration of construction contracts.',
    image_url: IMAGE_URLS.FIDIC_WHITE_BOOK_2017,
    clause_structure: [
      { clause_number: 'A', clause_title: 'General Provisions', text: '', sub_clauses: [
        { sub_clause_number: 'A.1', sub_clause_title: 'Definitions', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'A.2', sub_clause_title: 'Law and Language', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'A.3', sub_clause_title: 'Priority of Documents', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'A.4', sub_clause_title: 'Assignment', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'A.5', sub_clause_title: 'Notices', text: LICENSED_TEXT_NOTE },
      ]},
      { clause_number: 'B', clause_title: 'Commencement, Completion, Amendment and Termination', text: '', sub_clauses: [
        { sub_clause_number: 'B.1', sub_clause_title: 'Commencement and Completion', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'B.2', sub_clause_title: 'Amendment', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'B.3', sub_clause_title: 'Termination by the Client', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'B.4', sub_clause_title: 'Termination by the Consultant', text: LICENSED_TEXT_NOTE },
      ]},
      { clause_number: 'C', clause_title: 'Obligations of the Consultant', text: '', sub_clauses: [
        { sub_clause_number: 'C.1', sub_clause_title: 'Scope of Services', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'C.2', sub_clause_title: 'Standard of Care', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'C.3', sub_clause_title: 'Consultant\'s Personnel', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'C.4', sub_clause_title: 'Conflict of Interest', text: LICENSED_TEXT_NOTE },
      ]},
      { clause_number: 'D', clause_title: 'Obligations of the Client', text: '', sub_clauses: [
        { sub_clause_number: 'D.1', sub_clause_title: 'Information and Decisions', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'D.2', sub_clause_title: 'Facilities and Free-Issue Items', text: LICENSED_TEXT_NOTE },
      ]},
      { clause_number: 'E', clause_title: 'Payment', text: '', sub_clauses: [
        { sub_clause_number: 'E.1', sub_clause_title: 'Remuneration', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'E.2', sub_clause_title: 'Payment Timing', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'E.3', sub_clause_title: 'Additional Remuneration', text: LICENSED_TEXT_NOTE },
      ]},
      { clause_number: 'F', clause_title: 'Liability and Insurance', text: '', sub_clauses: [
        { sub_clause_number: 'F.1', sub_clause_title: 'Liability', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'F.2', sub_clause_title: 'Insurance', text: LICENSED_TEXT_NOTE },
      ]},
      { clause_number: 'G', clause_title: 'Dispute Resolution', text: '', sub_clauses: [
        { sub_clause_number: 'G.1', sub_clause_title: 'Amicable Settlement', text: LICENSED_TEXT_NOTE },
        { sub_clause_number: 'G.2', sub_clause_title: 'Arbitration', text: LICENSED_TEXT_NOTE },
      ]},
    ],
  },
  {
    title: 'Short Form of Contract',
    organization: 'FIDIC',
    contract_type_code: 'FIDIC_GREEN_BOOK_2021',
    edition: '2nd Edition 2021',
    color_name: 'Green Book',
    description: 'For building and engineering works of relatively small capital value or short duration without complex specialist sub-contract work.',
    image_url: IMAGE_URLS.FIDIC_GREEN_BOOK_2021,
    clause_structure: FIDIC_GREEN_STRUCTURE,
  },
  createFidicStructure({
    title: 'Conditions of Contract for Underground Works',
    contract_type_code: 'FIDIC_EMERALD_BOOK_2019',
    edition: '1st Edition 2019',
    color_name: 'Emerald Book',
    description: 'For tunnelling and underground works including caverns, shafts and associated surface works.',
    image_url: IMAGE_URLS.FIDIC_EMERALD_BOOK_2019,
  }),
  // FIDIC 1999 Rainbow Suite
  {
    title: 'Conditions of Contract for Construction',
    organization: 'FIDIC',
    contract_type_code: 'FIDIC_RED_BOOK_1999',
    edition: '1st Edition 1999',
    color_name: 'Red Book',
    description: 'For building and engineering works designed by the Employer (legacy 1999 edition).',
    image_url: IMAGE_URLS.FIDIC_RED_BOOK_1999,
    clause_structure: FIDIC_1999_STRUCTURE,
  },
  {
    title: 'Conditions of Contract for Plant and Design-Build',
    organization: 'FIDIC',
    contract_type_code: 'FIDIC_YELLOW_BOOK_1999',
    edition: '1st Edition 1999',
    color_name: 'Yellow Book',
    description: 'For plant and design-build projects where the Contractor designs and provides the works (legacy 1999 edition).',
    image_url: IMAGE_URLS.FIDIC_YELLOW_BOOK_1999,
    clause_structure: FIDIC_1999_STRUCTURE,
  },
  {
    title: 'Conditions of Contract for EPC/Turnkey Projects',
    organization: 'FIDIC',
    contract_type_code: 'FIDIC_SILVER_BOOK_1999',
    edition: '1st Edition 1999',
    color_name: 'Silver Book',
    description: 'For EPC/Turnkey projects with greater risk allocation to the Contractor (legacy 1999 edition).',
    image_url: IMAGE_URLS.FIDIC_SILVER_BOOK_1999,
    clause_structure: FIDIC_1999_STRUCTURE,
  },
  // FIDIC Subcontracts
  createFidicStructure({
    title: 'Conditions of Subcontract for Plant and Design-Build',
    contract_type_code: 'FIDIC_SUBCONTRACT_YELLOW_2019',
    edition: '1st Edition 2019',
    color_name: null,
    description: 'Subcontract conditions for use with the FIDIC Yellow Book (1999) as the main contract.',
    image_url: IMAGE_URLS.FIDIC_SUBCONTRACT_YELLOW_2019,
  }),
  // FIDIC MDB
  createFidicStructure({
    title: 'Conditions of Contract for Construction — MDB Harmonised Edition',
    contract_type_code: 'FIDIC_PINK_BOOK',
    edition: 'MDB Harmonised Edition',
    color_name: 'Pink Book',
    description: 'Multilateral Development Banks harmonised edition for construction works funded by MDBs.',
    image_url: IMAGE_URLS.FIDIC_PINK_BOOK,
  }),
  // FIDIC Dredging
  {
    title: 'Conditions of Contract for Dredging and Reclamation Works',
    organization: 'FIDIC',
    contract_type_code: 'FIDIC_BLUE_GREEN_BOOK_2016',
    edition: '2nd Edition 2016',
    color_name: 'Blue-Green Book',
    description: 'For dredging and reclamation works in marine and inland waterway environments.',
    image_url: IMAGE_URLS.FIDIC_BLUE_GREEN_BOOK_2016,
    clause_structure: FIDIC_GREEN_STRUCTURE,
  },
  // NEC4 Suite
  {
    title: 'NEC4 Engineering and Construction Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_ECC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'The primary NEC contract for major engineering and construction works with flexible payment options.',
    image_url: IMAGE_URLS.NEC4_ECC,
    clause_structure: NEC4_ECC_STRUCTURE,
  },
  {
    title: 'NEC4 Professional Service Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_PSC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For the appointment of professional service providers such as engineers, architects and surveyors.',
    image_url: IMAGE_URLS.NEC4_PSC,
    clause_structure: NEC_PSC_STRUCTURE,
  },
  {
    title: 'NEC4 Term Service Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_TSC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For appointing a contractor for a period of time to manage and provide a service.',
    image_url: IMAGE_URLS.NEC4_TSC,
    clause_structure: NEC_PSC_STRUCTURE,
  },
  {
    title: 'NEC4 Supply Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_SC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For procuring high-value goods, materials and related services.',
    image_url: IMAGE_URLS.NEC4_SC,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  {
    title: 'NEC4 Framework Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_FC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For establishing a framework agreement under which packages of work are ordered over time.',
    image_url: IMAGE_URLS.NEC4_FC,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  {
    title: 'NEC4 Design Build and Operate Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_DBOC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For projects where a single contractor designs, builds and subsequently operates the works.',
    image_url: IMAGE_URLS.NEC4_DBOC,
    clause_structure: NEC4_ECC_STRUCTURE,
  },
  {
    title: 'NEC4 Facilities Management Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_FMC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For the management and provision of facilities management services.',
    image_url: IMAGE_URLS.NEC4_FMC,
    clause_structure: NEC_PSC_STRUCTURE,
  },
  {
    title: 'NEC4 Alliance Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_ALC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For multi-party alliance arrangements enabling collaborative working between client and partners.',
    image_url: IMAGE_URLS.NEC4_ALC,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  {
    title: 'NEC4 Dispute Resolution Service Contract',
    organization: 'NEC',
    contract_type_code: 'NEC4_DRSC',
    edition: 'June 2017 (revised January 2023)',
    color_name: null,
    description: 'For appointing dispute resolution professionals including adjudicators and dispute avoidance panels.',
    image_url: IMAGE_URLS.NEC4_DRSC,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  // NEC3 Suite
  {
    title: 'NEC3 Engineering and Construction Contract',
    organization: 'NEC',
    contract_type_code: 'NEC3_ECC',
    edition: 'April 2013',
    color_name: null,
    description: 'The legacy NEC3 primary contract for engineering and construction works.',
    image_url: IMAGE_URLS.NEC3_ECC,
    clause_structure: NEC4_ECC_STRUCTURE,
  },
  {
    title: 'NEC3 Professional Service Contract',
    organization: 'NEC',
    contract_type_code: 'NEC3_PSC',
    edition: 'April 2013',
    color_name: null,
    description: 'Legacy NEC3 contract for appointing professional service providers.',
    image_url: IMAGE_URLS.NEC3_PSC,
    clause_structure: NEC_PSC_STRUCTURE,
  },
  {
    title: 'NEC3 Term Service Contract',
    organization: 'NEC',
    contract_type_code: 'NEC3_TSC',
    edition: 'April 2013',
    color_name: null,
    description: 'Legacy NEC3 contract for term service arrangements.',
    image_url: IMAGE_URLS.NEC3_TSC,
    clause_structure: NEC_PSC_STRUCTURE,
  },
  {
    title: 'NEC3 Supply Contract',
    organization: 'NEC',
    contract_type_code: 'NEC3_SC',
    edition: 'April 2013',
    color_name: null,
    description: 'Legacy NEC3 contract for supply of goods and materials.',
    image_url: IMAGE_URLS.NEC3_SC,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  {
    title: 'NEC3 Framework Contract',
    organization: 'NEC',
    contract_type_code: 'NEC3_FC',
    edition: 'April 2013',
    color_name: null,
    description: 'Legacy NEC3 contract for framework agreements.',
    image_url: IMAGE_URLS.NEC3_FC,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  {
    title: 'NEC3 Adjudicator\'s Contract',
    organization: 'NEC',
    contract_type_code: 'NEC3_AC',
    edition: 'April 2013',
    color_name: null,
    description: 'Legacy NEC3 contract for appointing an adjudicator for dispute resolution.',
    image_url: IMAGE_URLS.NEC3_AC,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  // NEC HK Edition
  {
    title: 'NEC Engineering and Construction Contract Hong Kong Edition',
    organization: 'NEC',
    contract_type_code: 'NEC_ECC_HK',
    edition: 'Hong Kong Edition',
    color_name: null,
    description: 'NEC ECC adapted for Hong Kong construction law and practice.',
    image_url: IMAGE_URLS.NEC_ECC_HK,
    clause_structure: NEC4_ECC_STRUCTURE,
  },
  {
    title: 'NEC Term Service Contract Hong Kong Edition',
    organization: 'NEC',
    contract_type_code: 'NEC_TSC_HK',
    edition: 'Hong Kong Edition',
    color_name: null,
    description: 'NEC TSC adapted for Hong Kong term service arrangements.',
    image_url: IMAGE_URLS.NEC_TSC_HK,
    clause_structure: NEC_PSC_STRUCTURE,
  },
  // FAC/TAC
  {
    title: 'FAC-1 Framework Alliance Contract',
    organization: 'NEC',
    contract_type_code: 'FAC_1',
    edition: '1st Edition',
    color_name: null,
    description: 'Multi-party framework alliance contract for collaborative procurement across multiple projects.',
    image_url: IMAGE_URLS.FAC_1,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
  {
    title: 'TAC-1 Term Alliance Contract',
    organization: 'NEC',
    contract_type_code: 'TAC_1',
    edition: '1st Edition',
    color_name: null,
    description: 'Multi-party term alliance contract for collaborative delivery of ongoing works and services.',
    image_url: IMAGE_URLS.TAC_1,
    clause_structure: NEC_SHORT_STRUCTURE,
  },
];

// ─────────────────────────────────────────────────────────────
// Seed runner
// ─────────────────────────────────────────────────────────────
export async function seedContractTemplates(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(KnowledgeAsset);

  for (const template of CONTRACT_TEMPLATES) {
    // Check if already seeded
    const existing = await repo.findOne({
      where: {
        title: template.title,
        asset_type: AssetType.CONTRACT_TEMPLATE,
      },
    });

    if (existing) {
      // Update content if structure changed
      (existing as any).content = {
        organization: template.organization,
        contract_type_code: template.contract_type_code,
        edition: template.edition,
        color_name: template.color_name,
        image_url: template.image_url,
        clause_structure: template.clause_structure,
      };
      existing.description = template.description;
      existing.tags = [template.organization, template.contract_type_code, template.edition];
      await repo.save(existing);
      continue;
    }

    const asset = repo.create({
      title: template.title,
      description: template.description,
      asset_type: AssetType.CONTRACT_TEMPLATE,
      review_status: AssetReviewStatus.AUTO_APPROVED,
      tags: [template.organization, template.contract_type_code, template.edition],
      include_in_risk_analysis: true,
      include_in_citations: true,
      embedding_status: 'NOT_APPLICABLE',
      content: {
        organization: template.organization,
        contract_type_code: template.contract_type_code,
        edition: template.edition,
        color_name: template.color_name,
        image_url: template.image_url,
        clause_structure: template.clause_structure,
      } as any,
    });

    await repo.save(asset);
  }
}
