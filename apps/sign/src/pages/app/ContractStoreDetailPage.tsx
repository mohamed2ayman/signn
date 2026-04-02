import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ContractType } from '@/types';
import ChatPanel from '@/components/chat/ChatPanel';

// ─── Clause structure for preview ────────────────────────────

interface ClauseHeading {
  number: string;
  title: string;
  subClauses?: { number: string; title: string }[];
}

// ─── Store contract detail data ──────────────────────────────

interface StoreContractDetail {
  id: string;
  code: ContractType;
  title: string;
  abbreviation: string;
  colorName: string | null;
  edition: string;
  description: string;
  longDescription: string;
  institution: 'FIDIC' | 'NEC';
  imageUrl: string;
  tags: string[];
  clauseHeadings: ClauseHeading[];
  purchaseUrl: string;
}

// ─── Color fallbacks ─────────────────────────────────────────

const FIDIC_COLORS: Record<string, string> = {
  'Red Book': 'bg-red-500',
  'Yellow Book': 'bg-yellow-400',
  'Silver Book': 'bg-gray-400',
  'White Book': 'bg-white border border-gray-300',
  'Green Book': 'bg-emerald-500',
  'Emerald Book': 'bg-emerald-600',
  'Pink Book': 'bg-pink-400',
  'Blue-Green Book': 'bg-teal-500',
};

// ─── Image URLs ──────────────────────────────────────────────

const FIDIC_IMAGES: Record<string, string> = {
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
  FIDIC_BLUE_GREEN_BOOK_2016: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/2021_green_book_2_3D_NO%20LABEL.png',
};

const NEC_IMAGES: Record<string, string> = {
  NEC4_ECC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/40839106-7ba5-4bf7-9584-70f75222de24/NEC4-ECC.jpg?width=234',
  NEC4_PSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/e96d4e53-a21b-4ba6-a224-fc8061fc8d8f/NEC4-PSC.jpg?width=234',
  NEC4_TSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/039e4640-8dfa-4c4d-ab2b-ad8a52e94f8d/NEC4-TSC.jpg?width=234',
  NEC4_SC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/0ee1e75e-2d90-467a-a9bc-0ea0f01598e6/NEC4-SC.jpg?width=234',
  NEC4_FC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5115d192-5c25-4525-be40-e9cbce6f375a/NEC4-FC.jpg?width=234',
  NEC4_DBOC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/bbd74f95-6fb9-48fc-93e5-c8d83660bed2/NEC4-DBOC.jpg?width=234',
  NEC4_FMC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/9508474e-91a1-4b6f-8996-43a14c461f05/Front-cover-FMC.jpg?width=234',
  NEC4_ALC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/9d1f7d6e-148a-49df-974c-4960ea43708f/NEC4-ALC.jpg?width=234',
  NEC4_DRSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/94c5d3d0-e920-4cf2-ae84-324fdebfad81/NEC4-DRSC.jpg?width=234',
  NEC3_ECC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/d3f26b9a-78f6-416e-a5ac-47856ed89c53/ECC-2013AW.jpg?width=234',
  NEC3_PSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/b23b41ef-8790-4c53-a20f-f76959a7a3cd/PSC-2013AW.jpg?width=234',
  NEC3_TSC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5c2a49bf-91e5-4c42-bcd6-f29ce0a40017/TSC-2013AW.jpg?width=234',
  NEC3_SC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/b78a7ac9-b692-4bd9-916d-a1d37092357c/SC-2013AW.jpg?width=234',
  NEC3_FC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/2d2bbb3b-a133-4c57-affc-71707a050de2/FC-2013AW.jpg?width=234',
  NEC3_AC: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5619ed58-5542-4cb4-b201-04a238e4db88/AC-2013AW.jpg?width=234',
  NEC_ECC_HK: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/40839106-7ba5-4bf7-9584-70f75222de24/NEC4-ECC.jpg?width=234',
  NEC_TSC_HK: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/039e4640-8dfa-4c4d-ab2b-ad8a52e94f8d/NEC4-TSC.jpg?width=234',
  FAC_1: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getattachment/d539b43f-aed1-468d-bc28-8a3ec0ae024b/FAC1-1.jpg?width=234',
  TAC_1: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getattachment/d539b43f-aed1-468d-bc28-8a3ec0ae024b/FAC1-1.jpg?width=234',
};

// ─── FIDIC standard clause headings ──────────────────────────

const FIDIC_2017_CLAUSES: ClauseHeading[] = [
  { number: '1', title: 'General Provisions', subClauses: [
    { number: '1.1', title: 'Definitions' }, { number: '1.2', title: 'Interpretation' },
    { number: '1.3', title: 'Notices and Other Communications' }, { number: '1.4', title: 'Law and Language' },
    { number: '1.5', title: 'Priority of Documents' }, { number: '1.6', title: 'Contract Agreement' },
    { number: '1.7', title: 'Assignment' }, { number: '1.8', title: 'Care and Supply of Documents' },
    { number: '1.9', title: 'Delayed Drawings or Instructions' }, { number: '1.10', title: "Employer's Use of Contractor's Documents" },
    { number: '1.11', title: "Contractor's Use of Employer's Documents" }, { number: '1.12', title: 'Confidential Details' },
    { number: '1.13', title: 'Compliance with Laws' }, { number: '1.14', title: 'Joint and Several Liability' },
    { number: '1.15', title: 'Limitation of Liability' }, { number: '1.16', title: 'Contract in Full Force and Effect' },
  ]},
  { number: '2', title: 'The Employer', subClauses: [
    { number: '2.1', title: 'Right of Access to the Site' }, { number: '2.2', title: 'Assistance' },
    { number: '2.3', title: "Employer's Personnel and Other Contractors" }, { number: '2.4', title: "Employer's Financial Arrangements" },
    { number: '2.5', title: "Employer's Claims" }, { number: '2.6', title: "Employer's Equipment, Free-Issue Materials and Access Routes" },
  ]},
  { number: '3', title: 'The Engineer', subClauses: [
    { number: '3.1', title: "The Engineer's Duties and Authority" }, { number: '3.2', title: "The Engineer's Representative" },
    { number: '3.3', title: "The Engineer's Instructions" }, { number: '3.4', title: 'Replacement of the Engineer' },
    { number: '3.5', title: 'Engineer\'s Determinations' }, { number: '3.6', title: 'Meetings' },
    { number: '3.7', title: 'Agreement or Determination' },
  ]},
  { number: '4', title: "The Contractor", subClauses: [
    { number: '4.1', title: "Contractor's General Obligations" }, { number: '4.2', title: 'Performance Security' },
    { number: '4.3', title: "Contractor's Representative" }, { number: '4.4', title: 'Subcontractors' },
  ]},
  { number: '5', title: 'Design' },
  { number: '6', title: 'Staff and Labour' },
  { number: '7', title: 'Plant, Materials and Workmanship' },
  { number: '8', title: 'Commencement, Delays and Suspension' },
  { number: '9', title: 'Tests on Completion' },
  { number: '10', title: "Employer's Taking Over" },
  { number: '11', title: 'Defects after Taking Over' },
  { number: '12', title: 'Measurement and Evaluation' },
  { number: '13', title: 'Variations and Adjustments' },
  { number: '14', title: 'Contract Price and Payment' },
  { number: '15', title: 'Termination by Employer' },
  { number: '16', title: 'Suspension and Termination by Contractor' },
  { number: '17', title: 'Risk and Responsibility' },
  { number: '18', title: 'Insurance' },
  { number: '19', title: 'Force Majeure' },
  { number: '20', title: 'Claims, Disputes and Arbitration' },
  { number: '21', title: 'Disputes and Arbitration' },
];

const NEC4_ECC_CLAUSES: ClauseHeading[] = [
  { number: '1', title: 'General', subClauses: [
    { number: '10', title: 'Actions' }, { number: '11', title: 'Identified and defined terms' },
    { number: '12', title: 'Interpretation and the law' }, { number: '13', title: 'Communications' },
    { number: '14', title: 'The Project Manager and the Supervisor' }, { number: '15', title: 'Adding to the working areas' },
    { number: '16', title: 'Early warning' }, { number: '17', title: 'Ambiguities and inconsistencies' },
    { number: '18', title: 'Illegal and impossible requirements' }, { number: '19', title: 'Prevention' },
  ]},
  { number: '2', title: "The Contractor's main responsibilities" },
  { number: '3', title: 'Time' },
  { number: '4', title: 'Testing and Defects' },
  { number: '5', title: 'Payment' },
  { number: '6', title: 'Compensation events' },
  { number: '7', title: 'Title' },
  { number: '8', title: 'Risks and insurance' },
  { number: '9', title: 'Termination' },
];

// ─── Contract details registry ───────────────────────────────

const CONTRACT_DETAILS: Record<string, StoreContractDetail> = {
  'fidic-red-2017': {
    id: 'fidic-red-2017', code: ContractType.FIDIC_RED_BOOK_2017, title: 'Conditions of Contract for Construction', abbreviation: 'Red Book', colorName: 'Red Book', edition: '2nd Edition 2017', institution: 'FIDIC',
    description: 'For building and engineering works designed by the Employer.',
    longDescription: 'The FIDIC Red Book is the most widely used standard form of construction contract in the world. It is designed for building and engineering works where the Employer is responsible for the design (or the Engineer on behalf of the Employer). The 2017 edition includes significant updates to dispute resolution procedures, introducing the DAAB (Dispute Avoidance/Adjudication Board) as a standing body. It provides a balanced risk allocation framework recognized by employers, contractors, and financiers across over 100 countries.',
    imageUrl: FIDIC_IMAGES.FIDIC_RED_BOOK_2017, tags: ['Construction', 'Employer-designed', 'International projects', 'Most widely used'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-yellow-2017': {
    id: 'fidic-yellow-2017', code: ContractType.FIDIC_YELLOW_BOOK_2017, title: 'Plant and Design-Build Contract', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '2nd Edition 2017', institution: 'FIDIC',
    description: 'For electrical and mechanical plant and design-build works.',
    longDescription: 'The FIDIC Yellow Book is designed for projects where the Contractor is responsible for both the design and construction of the works. It is ideal for plant and design-build contracts, including electrical, mechanical, and process engineering projects. The 2017 edition aligns with the updated Red Book provisions and includes the DAAB mechanism for dispute avoidance and resolution.',
    imageUrl: FIDIC_IMAGES.FIDIC_YELLOW_BOOK_2017, tags: ['Design-Build', 'Plant', 'Contractor-designed', 'Mechanical/Electrical'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-silver-2017': {
    id: 'fidic-silver-2017', code: ContractType.FIDIC_SILVER_BOOK_2017, title: 'EPC/Turnkey Contract', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '2nd Edition 2017', institution: 'FIDIC',
    description: 'For EPC/Turnkey projects with total Contractor responsibility.',
    longDescription: 'The FIDIC Silver Book is intended for Engineering, Procurement and Construction (EPC) or Turnkey projects where the Contractor assumes total responsibility for design and execution. It provides a fixed price, lump sum arrangement where the Contractor bears most of the risk. This form is commonly used in power generation, water treatment, and infrastructure projects funded by international institutions.',
    imageUrl: FIDIC_IMAGES.FIDIC_SILVER_BOOK_2017, tags: ['EPC', 'Turnkey', 'Total responsibility', 'Fixed price'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-white-2017': {
    id: 'fidic-white-2017', code: ContractType.FIDIC_WHITE_BOOK_2017, title: 'Client/Consultant Model Services Agreement', abbreviation: 'White Book', colorName: 'White Book', edition: '5th Edition 2017', institution: 'FIDIC',
    description: 'For professional consultant services and feasibility studies.',
    longDescription: 'The FIDIC White Book provides a model agreement for the engagement of professional consultants. It covers services ranging from feasibility studies and preliminary design to detailed design, project management, and construction supervision. The 5th edition includes updated provisions for intellectual property, liability limitations, and dispute resolution.',
    imageUrl: FIDIC_IMAGES.FIDIC_WHITE_BOOK_2017, tags: ['Consulting', 'Professional services', 'Feasibility', 'Project management'], clauseHeadings: [
      { number: 'A', title: 'General Provisions' }, { number: 'B', title: 'Obligations of the Consultant' },
      { number: 'C', title: 'Obligations of the Client' }, { number: 'D', title: 'Payment' },
      { number: 'E', title: 'Liability and Insurance' }, { number: 'F', title: 'Suspension, Termination and Force Majeure' },
      { number: 'G', title: 'Dispute Resolution' },
    ], purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-green-2021': {
    id: 'fidic-green-2021', code: ContractType.FIDIC_GREEN_BOOK_2021, title: 'Short Form of Contract', abbreviation: 'Green Book', colorName: 'Green Book', edition: '2nd Edition 2021', institution: 'FIDIC',
    description: 'For small value or short duration works.',
    longDescription: 'The FIDIC Green Book is a simplified short form of contract suitable for building or engineering works of relatively small capital value or short duration. It is designed for projects without complex specialist sub-contracts, making it ideal for simple works where speed and simplicity in contract administration are priorities.',
    imageUrl: FIDIC_IMAGES.FIDIC_GREEN_BOOK_2021, tags: ['Short form', 'Small works', 'Simple projects', 'Quick setup'], clauseHeadings: [
      { number: '1', title: 'General Provisions' }, { number: '2', title: 'The Employer' },
      { number: '3', title: 'The Employer\'s Representative' }, { number: '4', title: 'The Contractor' },
      { number: '5', title: 'Design by Contractor' }, { number: '6', title: 'Staff and Labour' },
      { number: '7', title: 'Plant, Materials and Workmanship' }, { number: '8', title: 'Commencement, Delays and Suspension' },
      { number: '9', title: 'Defects' }, { number: '10', title: 'Variations' },
      { number: '11', title: 'Contract Price and Payment' }, { number: '12', title: 'Default and Termination' },
      { number: '13', title: 'Risk and Responsibility' }, { number: '14', title: 'Insurance' },
      { number: '15', title: 'Resolution of Disputes' },
    ], purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-emerald-2019': {
    id: 'fidic-emerald-2019', code: ContractType.FIDIC_EMERALD_BOOK_2019, title: 'Underground Works Contract', abbreviation: 'Emerald Book', colorName: 'Emerald Book', edition: '1st Edition 2019', institution: 'FIDIC',
    description: 'For tunnelling and underground construction works.',
    longDescription: 'The FIDIC Emerald Book is the first standard form specifically designed for tunnelling and underground works. Developed jointly by FIDIC and the International Tunnelling and Underground Space Association (ITA), it includes unique provisions for geotechnical baseline reports, ground risk sharing, and the uncertainties inherent in underground construction.',
    imageUrl: FIDIC_IMAGES.FIDIC_EMERALD_BOOK_2019, tags: ['Underground', 'Tunnelling', 'Specialized', 'Geotechnical'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-red-1999': {
    id: 'fidic-red-1999', code: ContractType.FIDIC_RED_BOOK_1999, title: 'Construction Contract (Legacy)', abbreviation: 'Red Book', colorName: 'Red Book', edition: '1st Edition 1999', institution: 'FIDIC',
    description: 'The original Rainbow Suite construction contract.',
    longDescription: 'The 1999 edition of the FIDIC Red Book established the modern Rainbow Suite and remains widely used, particularly in jurisdictions and projects where the 2017 edition has not yet been adopted. While the 2017 edition is recommended for new projects, many existing contracts and some government procurement frameworks still reference the 1999 edition.',
    imageUrl: FIDIC_IMAGES.FIDIC_RED_BOOK_1999, tags: ['Construction', 'Legacy', 'Employer-designed', 'Widely adopted'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-yellow-1999': {
    id: 'fidic-yellow-1999', code: ContractType.FIDIC_YELLOW_BOOK_1999, title: 'Plant and Design-Build Contract (Legacy)', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '1st Edition 1999', institution: 'FIDIC',
    description: 'Legacy design-build contract for plant and engineering works.',
    longDescription: 'The 1999 Yellow Book provides conditions of contract for plant and design-build works where the Contractor designs and constructs the works. Many international projects continue to use this edition, and it serves as the basis for the FIDIC Subcontract Yellow Book.',
    imageUrl: FIDIC_IMAGES.FIDIC_YELLOW_BOOK_1999, tags: ['Design-Build', 'Legacy', 'Plant', 'International'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-silver-1999': {
    id: 'fidic-silver-1999', code: ContractType.FIDIC_SILVER_BOOK_1999, title: 'EPC/Turnkey Contract (Legacy)', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '1st Edition 1999', institution: 'FIDIC',
    description: 'Legacy EPC/Turnkey contract.',
    longDescription: 'The 1999 Silver Book is the legacy EPC/Turnkey form with total Contractor responsibility. It remains in use for projects where the 2017 edition has not been adopted, particularly in energy and infrastructure sectors.',
    imageUrl: FIDIC_IMAGES.FIDIC_SILVER_BOOK_1999, tags: ['EPC', 'Legacy', 'Turnkey', 'Total responsibility'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-sub-yellow-2019': {
    id: 'fidic-sub-yellow-2019', code: ContractType.FIDIC_SUBCONTRACT_YELLOW_2019, title: 'Subcontract for Plant and Design-Build', abbreviation: 'Sub Yellow', colorName: null, edition: '1st Edition 2019', institution: 'FIDIC',
    description: 'Subcontract aligned with the FIDIC Yellow Book.',
    longDescription: 'The FIDIC Subcontract for Plant and Design-Build provides conditions for subcontracting under the Yellow Book 1999 main contract. It ensures alignment between the main contract and subcontract obligations, providing a consistent framework for multi-tier contract structures.',
    imageUrl: FIDIC_IMAGES.FIDIC_SUBCONTRACT_YELLOW_2019, tags: ['Subcontract', 'Design-Build', 'Yellow Book', 'Multi-tier'], clauseHeadings: [
      { number: '1', title: 'General Provisions' }, { number: '2', title: 'The Main Contractor' },
      { number: '3', title: 'The Subcontractor' }, { number: '4', title: 'Design' },
      { number: '5', title: 'Staff and Labour' }, { number: '6', title: 'Plant, Materials and Workmanship' },
      { number: '7', title: 'Time' }, { number: '8', title: 'Tests' },
      { number: '9', title: 'Main Contractor\'s Taking Over' }, { number: '10', title: 'Defects' },
      { number: '11', title: 'Measurement and Evaluation' }, { number: '12', title: 'Variations' },
      { number: '13', title: 'Price and Payment' }, { number: '14', title: 'Termination' },
      { number: '15', title: 'Risk and Indemnities' }, { number: '16', title: 'Insurance' },
      { number: '17', title: 'Disputes' },
    ], purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-pink': {
    id: 'fidic-pink', code: ContractType.FIDIC_PINK_BOOK, title: 'MDB Harmonised Edition', abbreviation: 'Pink Book', colorName: 'Pink Book', edition: 'MDB Edition', institution: 'FIDIC',
    description: 'For MDB-funded construction projects.',
    longDescription: 'The FIDIC Pink Book (MDB Harmonised Edition) is a version of the Red Book tailored for projects funded by Multilateral Development Banks such as the World Bank, African Development Bank, and Asian Development Bank. It includes specific provisions required by MDB procurement guidelines.',
    imageUrl: FIDIC_IMAGES.FIDIC_PINK_BOOK, tags: ['MDB', 'Development bank', 'International', 'World Bank'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  'fidic-bluegreen-2016': {
    id: 'fidic-bluegreen-2016', code: ContractType.FIDIC_BLUE_GREEN_BOOK_2016, title: 'Dredging and Reclamation Works', abbreviation: 'Blue-Green', colorName: 'Blue-Green Book', edition: '2nd Edition 2016', institution: 'FIDIC',
    description: 'For marine dredging and land reclamation.',
    longDescription: 'The FIDIC Blue-Green Book provides conditions for dredging and reclamation works in marine and inland waterway environments. It addresses the unique aspects of dredging projects including measurement of dredged quantities, environmental protection, and marine-specific risks.',
    imageUrl: FIDIC_IMAGES.FIDIC_BLUE_GREEN_BOOK_2016, tags: ['Dredging', 'Marine', 'Reclamation', 'Waterway'], clauseHeadings: FIDIC_2017_CLAUSES, purchaseUrl: 'https://fidic.org/bookshop',
  },
  // NEC4
  'nec4-ecc': {
    id: 'nec4-ecc', code: ContractType.NEC4_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'Primary NEC contract for major engineering and construction works.',
    longDescription: 'The NEC4 Engineering and Construction Contract (ECC) is the primary NEC contract used for major construction and engineering projects. It is based on principles of good project management, flexibility, and clarity. The ECC uses a unique system of main and secondary option clauses allowing the contract to be tailored to specific project requirements. It promotes early warning, collaboration, and proactive risk management.',
    imageUrl: NEC_IMAGES.NEC4_ECC, tags: ['Construction', 'Major works', 'Primary contract', 'Collaborative'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-psc': {
    id: 'nec4-psc', code: ContractType.NEC4_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'For professional service providers and consultants.',
    longDescription: 'The NEC4 Professional Service Contract (PSC) is designed for appointing professional service providers such as engineers, architects, surveyors, and project managers. It follows the same project management principles as the ECC and integrates well with other NEC contracts in a project suite.',
    imageUrl: NEC_IMAGES.NEC4_PSC, tags: ['Professional services', 'Consulting', 'Design', 'Project management'], clauseHeadings: [
      { number: '1', title: 'General' }, { number: '2', title: 'The Consultant\'s main responsibilities' },
      { number: '3', title: 'Time' }, { number: '4', title: 'Quality' },
      { number: '5', title: 'Payment' }, { number: '6', title: 'Compensation events' },
      { number: '7', title: 'Rights to material' }, { number: '8', title: 'Indemnity, insurance and liability' },
      { number: '9', title: 'Termination' },
    ], purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-tsc': {
    id: 'nec4-tsc', code: ContractType.NEC4_TSC, title: 'Term Service Contract', abbreviation: 'TSC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'For period-based service contracts and maintenance.',
    longDescription: 'The NEC4 Term Service Contract (TSC) is used for engaging contractors to manage and provide a service for a specified period. It is suitable for maintenance, facilities management, and other ongoing service requirements.',
    imageUrl: NEC_IMAGES.NEC4_TSC, tags: ['Term service', 'Maintenance', 'Period-based', 'Ongoing'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-sc': {
    id: 'nec4-sc', code: ContractType.NEC4_SC, title: 'Supply Contract', abbreviation: 'SC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'For procurement of high-value goods and materials.',
    longDescription: 'The NEC4 Supply Contract (SC) is designed for the procurement of high-value goods and materials. It provides a structured approach to supply chain management within the NEC framework.',
    imageUrl: NEC_IMAGES.NEC4_SC, tags: ['Supply', 'Materials', 'Procurement', 'Goods'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-fc': {
    id: 'nec4-fc', code: ContractType.NEC4_FC, title: 'Framework Contract', abbreviation: 'FC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'For framework agreements across work packages.',
    longDescription: 'The NEC4 Framework Contract (FC) establishes terms for appointing a contractor to carry out work on a call-off basis under a framework arrangement. Multiple work packages can be issued under the framework over the contract period.',
    imageUrl: NEC_IMAGES.NEC4_FC, tags: ['Framework', 'Work packages', 'Call-off', 'Multi-project'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-dboc': {
    id: 'nec4-dboc', code: ContractType.NEC4_DBOC, title: 'Design Build and Operate Contract', abbreviation: 'DBOC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'Combines design, construction and operation.',
    longDescription: 'The NEC4 Design Build and Operate Contract (DBOC) combines design, construction and operation responsibilities into a single contract. It is ideal for projects where whole-life value is important and the client wants a single point of responsibility through the full project lifecycle.',
    imageUrl: NEC_IMAGES.NEC4_DBOC, tags: ['Design-Build', 'Operate', 'Lifecycle', 'Single responsibility'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-fmc': {
    id: 'nec4-fmc', code: ContractType.NEC4_FMC, title: 'Facilities Management Contract', abbreviation: 'FMC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'For facilities management services.',
    longDescription: 'The NEC4 Facilities Management Contract (FMC) is specifically designed for facilities management services. It covers building operations, maintenance, cleaning, security, and other FM services within the NEC collaborative framework.',
    imageUrl: NEC_IMAGES.NEC4_FMC, tags: ['Facilities', 'Management', 'Operations', 'Building services'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-alc': {
    id: 'nec4-alc', code: ContractType.NEC4_ALC, title: 'Alliance Contract', abbreviation: 'ALC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'For multi-party alliance arrangements.',
    longDescription: 'The NEC4 Alliance Contract (ALC) provides a framework for multi-party alliance arrangements with shared risk, shared reward, and collaborative decision-making. Partners work together towards common objectives with aligned incentives.',
    imageUrl: NEC_IMAGES.NEC4_ALC, tags: ['Alliance', 'Multi-party', 'Shared risk', 'Collaborative'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec4-drsc': {
    id: 'nec4-drsc', code: ContractType.NEC4_DRSC, title: 'Dispute Resolution Service Contract', abbreviation: 'DRSC', colorName: null, edition: 'June 2017 (revised January 2023)', institution: 'NEC',
    description: 'For appointing dispute resolution panels.',
    longDescription: 'The NEC4 Dispute Resolution Service Contract (DRSC) is used to appoint adjudicators and dispute resolution panels. It provides the terms under which the dispute resolver operates within the NEC contract framework.',
    imageUrl: NEC_IMAGES.NEC4_DRSC, tags: ['Dispute resolution', 'Adjudication', 'Panels', 'Arbitration'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  // NEC3
  'nec3-ecc': {
    id: 'nec3-ecc', code: ContractType.NEC3_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', colorName: null, edition: 'April 2013', institution: 'NEC',
    description: 'Legacy NEC3 primary construction contract.',
    longDescription: 'The NEC3 ECC is the legacy version of the NEC Engineering and Construction Contract. While superseded by NEC4, it remains in use on many existing projects and is still referenced in some government procurement frameworks.',
    imageUrl: NEC_IMAGES.NEC3_ECC, tags: ['Construction', 'Legacy NEC3', 'Major works', 'Engineering'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec3-psc': {
    id: 'nec3-psc', code: ContractType.NEC3_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', colorName: null, edition: 'April 2013', institution: 'NEC',
    description: 'Legacy NEC3 professional services contract.',
    longDescription: 'The NEC3 PSC is the legacy version of the Professional Service Contract for appointing consultants and professional service providers.',
    imageUrl: NEC_IMAGES.NEC3_PSC, tags: ['Professional services', 'Legacy NEC3', 'Consulting'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec3-tsc': {
    id: 'nec3-tsc', code: ContractType.NEC3_TSC, title: 'Term Service Contract', abbreviation: 'TSC', colorName: null, edition: 'April 2013', institution: 'NEC',
    description: 'Legacy NEC3 term service contract.',
    longDescription: 'The NEC3 TSC is the legacy term service contract for period-based service management and maintenance.',
    imageUrl: NEC_IMAGES.NEC3_TSC, tags: ['Term service', 'Legacy NEC3', 'Maintenance'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec3-sc': {
    id: 'nec3-sc', code: ContractType.NEC3_SC, title: 'Supply Contract', abbreviation: 'SC', colorName: null, edition: 'April 2013', institution: 'NEC',
    description: 'Legacy NEC3 supply contract.',
    longDescription: 'The NEC3 SC is the legacy supply contract for the procurement of goods and materials.',
    imageUrl: NEC_IMAGES.NEC3_SC, tags: ['Supply', 'Legacy NEC3', 'Materials'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec3-fc': {
    id: 'nec3-fc', code: ContractType.NEC3_FC, title: 'Framework Contract', abbreviation: 'FC', colorName: null, edition: 'April 2013', institution: 'NEC',
    description: 'Legacy NEC3 framework agreement.',
    longDescription: 'The NEC3 FC is the legacy framework contract for establishing call-off arrangements across multiple work packages.',
    imageUrl: NEC_IMAGES.NEC3_FC, tags: ['Framework', 'Legacy NEC3', 'Agreement'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec3-ac': {
    id: 'nec3-ac', code: ContractType.NEC3_AC, title: "Adjudicator's Contract", abbreviation: 'AC', colorName: null, edition: 'April 2013', institution: 'NEC',
    description: 'Legacy NEC3 adjudicator appointment contract.',
    longDescription: 'The NEC3 AC provides terms for appointing adjudicators under the NEC3 suite of contracts.',
    imageUrl: NEC_IMAGES.NEC3_AC, tags: ['Adjudication', 'Legacy NEC3', 'Dispute'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  // NEC HK
  'nec-ecc-hk': {
    id: 'nec-ecc-hk', code: ContractType.NEC_ECC_HK, title: 'ECC Hong Kong Edition', abbreviation: 'ECC HK', colorName: null, edition: 'HK Edition', institution: 'NEC',
    description: 'NEC ECC adapted for Hong Kong construction law.',
    longDescription: 'The NEC ECC Hong Kong Edition adapts the standard NEC ECC for use under Hong Kong construction law and practice. It includes modifications required for compliance with local legislation and procurement regulations.',
    imageUrl: NEC_IMAGES.NEC_ECC_HK, tags: ['Hong Kong', 'Construction', 'Regional', 'Adapted'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'nec-tsc-hk': {
    id: 'nec-tsc-hk', code: ContractType.NEC_TSC_HK, title: 'TSC Hong Kong Edition', abbreviation: 'TSC HK', colorName: null, edition: 'HK Edition', institution: 'NEC',
    description: 'NEC TSC adapted for Hong Kong term services.',
    longDescription: 'The NEC TSC Hong Kong Edition adapts the standard NEC TSC for use under Hong Kong law for term-based service contracts.',
    imageUrl: NEC_IMAGES.NEC_TSC_HK, tags: ['Hong Kong', 'Term service', 'Regional', 'Adapted'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  // FAC/TAC
  'fac-1': {
    id: 'fac-1', code: ContractType.FAC_1, title: 'Framework Alliance Contract', abbreviation: 'FAC-1', colorName: null, edition: '1st Edition', institution: 'NEC',
    description: 'Multi-party framework alliance contract.',
    longDescription: 'The FAC-1 Framework Alliance Contract is designed for establishing multi-party framework alliances. It enables collaborative working across multiple organizations with shared objectives, integrated systems, and improved value delivery.',
    imageUrl: NEC_IMAGES.FAC_1, tags: ['Alliance', 'Framework', 'Multi-party', 'Collaborative'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
  'tac-1': {
    id: 'tac-1', code: ContractType.TAC_1, title: 'Term Alliance Contract', abbreviation: 'TAC-1', colorName: null, edition: '1st Edition', institution: 'NEC',
    description: 'Multi-party term alliance contract.',
    longDescription: 'The TAC-1 Term Alliance Contract supports long-term collaborative relationships between multiple parties. It is designed for ongoing maintenance, operations, and service delivery within an alliance framework.',
    imageUrl: NEC_IMAGES.TAC_1, tags: ['Alliance', 'Term', 'Multi-party', 'Long-term'], clauseHeadings: NEC4_ECC_CLAUSES, purchaseUrl: 'https://www.neccontract.com/products/contracts',
  },
};

// ─── Book Cover Image Component ──────────────────────────────

function BookCoverImage({ src, alt, colorName, className = '' }: { src: string; alt: string; colorName: string | null; className?: string }) {
  const [imgError, setImgError] = useState(false);

  if (imgError && colorName && FIDIC_COLORS[colorName]) {
    return (
      <div className={`flex items-center justify-center rounded-lg ${FIDIC_COLORS[colorName]} ${className}`}>
        <span className="text-sm font-bold text-white drop-shadow-sm">{colorName}</span>
      </div>
    );
  }

  if (imgError) {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-gray-200 ${className}`}>
        <svg className="h-10 w-10 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`rounded-lg object-cover ${className}`}
      onError={() => setImgError(true)}
    />
  );
}

// ─── Clause Accordion ────────────────────────────────────────

function ClauseAccordion({ clauses }: { clauses: ClauseHeading[] }) {
  const [expandedClause, setExpandedClause] = useState<string | null>(null);

  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      {clauses.map((clause) => (
        <div key={clause.number}>
          <button
            onClick={() => clause.subClauses && setExpandedClause(expandedClause === clause.number ? null : clause.number)}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 ${
              !clause.subClauses ? 'cursor-default' : ''
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
              {clause.number}
            </span>
            <span className="flex-1 text-sm font-medium text-gray-900">{clause.title}</span>
            {clause.subClauses && (
              <svg
                className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expandedClause === clause.number ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            )}
          </button>
          {clause.subClauses && expandedClause === clause.number && (
            <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2">
              {clause.subClauses.map((sub) => (
                <div key={sub.number} className="flex items-center gap-3 py-1.5">
                  <span className="text-xs font-medium text-gray-400 w-8">{sub.number}</span>
                  <span className="text-sm text-gray-600">{sub.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Detail Page ────────────────────────────────────────

export default function ContractStoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);
  const [showRedirectModal, setShowRedirectModal] = useState(false);

  const contract = id ? CONTRACT_DETAILS[id] : null;

  if (!contract) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <svg className="h-16 w-16 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">Contract not found</h2>
        <p className="mt-1 text-sm text-gray-500">The contract you're looking for doesn't exist.</p>
        <Link to="/app/store" className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600">
          Back to Store
        </Link>
      </div>
    );
  }

  const institutionName = contract.institution === 'FIDIC' ? 'FIDIC' : 'NEC';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumb */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-3">
          <nav className="flex items-center gap-2 text-sm text-gray-500">
            <Link to="/app/store" className="hover:text-primary">Contract Store</Link>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              contract.institution === 'FIDIC' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'
            }`}>{contract.institution}</span>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            <span className="text-gray-900 font-medium">{contract.abbreviation}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* ── Left Column: Book + Info ───────────────── */}
          <div className="lg:col-span-2">
            <div className="flex flex-col gap-6 sm:flex-row">
              {/* Book Cover */}
              <div className="flex shrink-0 justify-center sm:justify-start">
                <BookCoverImage
                  src={contract.imageUrl}
                  alt={contract.title}
                  colorName={contract.colorName}
                  className="h-[280px] w-[200px] shadow-xl"
                />
              </div>

              {/* Contract Info */}
              <div className="flex-1">
                <span className={`mb-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  contract.institution === 'FIDIC' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'
                }`}>
                  {contract.institution}
                </span>
                <h1 className="text-2xl font-bold text-gray-900">{contract.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                  <span>{contract.edition}</span>
                  {contract.colorName && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block h-3 w-3 rounded-full ${FIDIC_COLORS[contract.colorName] || 'bg-gray-300'}`} />
                        {contract.colorName}
                      </span>
                    </>
                  )}
                </div>

                <p className="mt-4 text-sm leading-relaxed text-gray-700">
                  {contract.longDescription}
                </p>

                {/* Tags */}
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Best used for</p>
                  <div className="flex flex-wrap gap-2">
                    {contract.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Clause Headings Preview ─────────────── */}
            <div className="mt-10">
              <h2 className="mb-4 text-lg font-bold text-gray-900">Clause Headings Preview</h2>
              <p className="mb-4 text-xs text-gray-400">
                Clause titles shown for reference only. Full clause text is available in the licensed publication.
              </p>
              <ClauseAccordion clauses={contract.clauseHeadings} />
            </div>
          </div>

          {/* ── Right Column: Purchase Card ────────────── */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              {/* Purchase Card */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900">{contract.abbreviation}</h3>
                <p className="mt-1 text-sm text-gray-500">{contract.institution} Standard Form</p>

                <div className="my-4 rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">
                    Price set by <span className="font-semibold">{institutionName}</span> — click below to view
                  </p>
                </div>

                <button
                  onClick={() => setShowRedirectModal(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  Buy Official License
                </button>

                <div className="mt-4 border-t border-gray-100 pt-4">
                  <button
                    onClick={() => navigate(`/app/projects/new?contract_type=${contract.code}&licensed=true`)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/5"
                  >
                    Already licensed? Use in SIGN
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Info card */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-2">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    This content is the intellectual property of {institutionName}. SIGN displays clause headings for informational purposes only.
                    Full clause text requires a valid license from {institutionName}.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Redirect Confirmation Modal ───────────────── */}
      {showRedirectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-elevated">
            <div className="mb-4 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                contract.institution === 'FIDIC' ? 'bg-orange-100 text-orange-600' : 'bg-teal-100 text-teal-600'
              }`}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">External Redirect</h3>
                <p className="text-sm text-gray-400">{institutionName} Official Store</p>
              </div>
            </div>

            <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 leading-relaxed">
              You are being redirected to <strong>{institutionName}'s</strong> official website to purchase a license for <strong>{contract.title}</strong>.
              SIGN does not sell this contract.
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowRedirectModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <a
                href={contract.purchaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowRedirectModal(false)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition ${
                  contract.institution === 'FIDIC' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-teal-600 hover:bg-teal-700'
                }`}
              >
                Continue to {institutionName}
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Advisor Floating Button ────────────────── */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-primary-600 hover:shadow-xl"
        >
          <span className="text-lg">🤖</span>
          AI Contract Advisor
        </button>
      )}

      <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
