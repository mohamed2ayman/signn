import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ContractType } from '@/types';
import ChatPanel from '@/components/chat/ChatPanel';

// ─── Contract Store Data ─────────────────────────────────────

interface StoreContract {
  id: string;
  code: ContractType;
  title: string;
  abbreviation: string;
  colorName: string | null;
  edition: string;
  description: string;
  institution: 'FIDIC' | 'NEC';
  imageUrl: string;
  tags: string[];
}

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

// ─── Color fallbacks for FIDIC books ─────────────────────────

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

// ─── All Store Contracts ─────────────────────────────────────

const ALL_CONTRACTS: StoreContract[] = [
  // FIDIC 2017
  { id: 'fidic-red-2017', code: ContractType.FIDIC_RED_BOOK_2017, title: 'Conditions of Contract for Construction', abbreviation: 'Red Book', colorName: 'Red Book', edition: '2nd Ed 2017', description: 'For building and engineering works designed by the Employer. The most widely used FIDIC form worldwide.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_RED_BOOK_2017, tags: ['Construction', 'Employer-designed', 'International'] },
  { id: 'fidic-yellow-2017', code: ContractType.FIDIC_YELLOW_BOOK_2017, title: 'Plant and Design-Build Contract', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '2nd Ed 2017', description: 'For electrical and mechanical plant, and for building and engineering works designed by the Contractor.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_YELLOW_BOOK_2017, tags: ['Design-Build', 'Plant', 'Contractor-designed'] },
  { id: 'fidic-silver-2017', code: ContractType.FIDIC_SILVER_BOOK_2017, title: 'EPC/Turnkey Contract', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '2nd Ed 2017', description: 'For engineering, procurement and construction projects where the Contractor takes total responsibility.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_SILVER_BOOK_2017, tags: ['EPC', 'Turnkey', 'Total responsibility'] },
  { id: 'fidic-white-2017', code: ContractType.FIDIC_WHITE_BOOK_2017, title: 'Client/Consultant Model Services Agreement', abbreviation: 'White Book', colorName: 'White Book', edition: '5th Ed 2017', description: 'For professional consultant services including feasibility studies, design, and project management.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_WHITE_BOOK_2017, tags: ['Consulting', 'Professional services', 'Feasibility'] },
  { id: 'fidic-green-2021', code: ContractType.FIDIC_GREEN_BOOK_2021, title: 'Short Form of Contract', abbreviation: 'Green Book', colorName: 'Green Book', edition: '2nd Ed 2021', description: 'For small value or short duration works of a simple or repetitive nature.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_GREEN_BOOK_2021, tags: ['Short form', 'Small works', 'Simple projects'] },
  { id: 'fidic-emerald-2019', code: ContractType.FIDIC_EMERALD_BOOK_2019, title: 'Underground Works Contract', abbreviation: 'Emerald Book', colorName: 'Emerald Book', edition: '1st Ed 2019', description: 'Specifically designed for tunnelling and underground construction works.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_EMERALD_BOOK_2019, tags: ['Underground', 'Tunnelling', 'Specialized'] },
  // FIDIC 1999
  { id: 'fidic-red-1999', code: ContractType.FIDIC_RED_BOOK_1999, title: 'Construction Contract (Legacy)', abbreviation: 'Red Book', colorName: 'Red Book', edition: '1st Ed 1999', description: 'The original Rainbow Suite construction contract for Employer-designed works.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_RED_BOOK_1999, tags: ['Construction', 'Legacy', 'Employer-designed'] },
  { id: 'fidic-yellow-1999', code: ContractType.FIDIC_YELLOW_BOOK_1999, title: 'Plant and Design-Build Contract (Legacy)', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '1st Ed 1999', description: 'Legacy design-build contract for plant and engineering works.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_YELLOW_BOOK_1999, tags: ['Design-Build', 'Legacy', 'Plant'] },
  { id: 'fidic-silver-1999', code: ContractType.FIDIC_SILVER_BOOK_1999, title: 'EPC/Turnkey Contract (Legacy)', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '1st Ed 1999', description: 'Legacy EPC/Turnkey contract with total Contractor responsibility.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_SILVER_BOOK_1999, tags: ['EPC', 'Legacy', 'Turnkey'] },
  // FIDIC Subcontracts & MDB
  { id: 'fidic-sub-yellow-2019', code: ContractType.FIDIC_SUBCONTRACT_YELLOW_2019, title: 'Subcontract for Plant and Design-Build', abbreviation: 'Sub Yellow', colorName: null, edition: '1st Ed 2019', description: 'Subcontract conditions aligned with the FIDIC Yellow Book 1999 main contract.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_SUBCONTRACT_YELLOW_2019, tags: ['Subcontract', 'Design-Build', 'Yellow Book'] },
  { id: 'fidic-pink', code: ContractType.FIDIC_PINK_BOOK, title: 'MDB Harmonised Edition', abbreviation: 'Pink Book', colorName: 'Pink Book', edition: 'MDB Edition', description: 'Harmonised construction contract for Multilateral Development Bank funded projects.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_PINK_BOOK, tags: ['MDB', 'Development bank', 'International'] },
  // FIDIC Dredging
  { id: 'fidic-bluegreen-2016', code: ContractType.FIDIC_BLUE_GREEN_BOOK_2016, title: 'Dredging and Reclamation Works', abbreviation: 'Blue-Green', colorName: 'Blue-Green Book', edition: '2nd Ed 2016', description: 'For marine and inland waterway dredging and land reclamation works.', institution: 'FIDIC', imageUrl: FIDIC_IMAGES.FIDIC_BLUE_GREEN_BOOK_2016, tags: ['Dredging', 'Marine', 'Reclamation'] },
  // NEC4
  { id: 'nec4-ecc', code: ContractType.NEC4_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'The primary NEC contract for major engineering and construction works.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_ECC, tags: ['Construction', 'Major works', 'Primary contract'] },
  { id: 'nec4-psc', code: ContractType.NEC4_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'For appointing professional service providers including consultants and designers.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_PSC, tags: ['Professional services', 'Consulting', 'Design'] },
  { id: 'nec4-tsc', code: ContractType.NEC4_TSC, title: 'Term Service Contract', abbreviation: 'TSC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'For period-based service contracts and ongoing maintenance management.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_TSC, tags: ['Term service', 'Maintenance', 'Period-based'] },
  { id: 'nec4-sc', code: ContractType.NEC4_SC, title: 'Supply Contract', abbreviation: 'SC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'For the procurement of high-value goods and materials supply.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_SC, tags: ['Supply', 'Materials', 'Procurement'] },
  { id: 'nec4-fc', code: ContractType.NEC4_FC, title: 'Framework Contract', abbreviation: 'FC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'For establishing framework agreements for multiple work packages.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_FC, tags: ['Framework', 'Work packages', 'Agreement'] },
  { id: 'nec4-dboc', code: ContractType.NEC4_DBOC, title: 'Design Build and Operate Contract', abbreviation: 'DBOC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'Combines design, construction and operation in a single contract.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_DBOC, tags: ['Design-Build', 'Operate', 'Combined'] },
  { id: 'nec4-fmc', code: ContractType.NEC4_FMC, title: 'Facilities Management Contract', abbreviation: 'FMC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'For facilities management services and building operations.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_FMC, tags: ['Facilities', 'Management', 'Operations'] },
  { id: 'nec4-alc', code: ContractType.NEC4_ALC, title: 'Alliance Contract', abbreviation: 'ALC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'For multi-party alliance arrangements with shared risk and reward.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_ALC, tags: ['Alliance', 'Multi-party', 'Shared risk'] },
  { id: 'nec4-drsc', code: ContractType.NEC4_DRSC, title: 'Dispute Resolution Service Contract', abbreviation: 'DRSC', colorName: null, edition: 'Jun 2017 (rev Jan 2023)', description: 'For appointing adjudicators and dispute resolution panels.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC4_DRSC, tags: ['Dispute resolution', 'Adjudication', 'Panels'] },
  // NEC3
  { id: 'nec3-ecc', code: ContractType.NEC3_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', colorName: null, edition: 'Apr 2013', description: 'Legacy NEC3 primary contract for engineering and construction works.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC3_ECC, tags: ['Construction', 'Legacy NEC3', 'Major works'] },
  { id: 'nec3-psc', code: ContractType.NEC3_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', colorName: null, edition: 'Apr 2013', description: 'Legacy NEC3 contract for professional services and consultancy.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC3_PSC, tags: ['Professional services', 'Legacy NEC3', 'Consulting'] },
  { id: 'nec3-tsc', code: ContractType.NEC3_TSC, title: 'Term Service Contract', abbreviation: 'TSC', colorName: null, edition: 'Apr 2013', description: 'Legacy NEC3 term-based service contract.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC3_TSC, tags: ['Term service', 'Legacy NEC3', 'Maintenance'] },
  { id: 'nec3-sc', code: ContractType.NEC3_SC, title: 'Supply Contract', abbreviation: 'SC', colorName: null, edition: 'Apr 2013', description: 'Legacy NEC3 supply contract for goods and materials.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC3_SC, tags: ['Supply', 'Legacy NEC3', 'Materials'] },
  { id: 'nec3-fc', code: ContractType.NEC3_FC, title: 'Framework Contract', abbreviation: 'FC', colorName: null, edition: 'Apr 2013', description: 'Legacy NEC3 framework agreement for multiple work packages.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC3_FC, tags: ['Framework', 'Legacy NEC3', 'Agreement'] },
  { id: 'nec3-ac', code: ContractType.NEC3_AC, title: "Adjudicator's Contract", abbreviation: 'AC', colorName: null, edition: 'Apr 2013', description: 'Legacy NEC3 contract for appointing adjudicators.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC3_AC, tags: ['Adjudication', 'Legacy NEC3', 'Dispute'] },
  // NEC HK
  { id: 'nec-ecc-hk', code: ContractType.NEC_ECC_HK, title: 'ECC Hong Kong Edition', abbreviation: 'ECC HK', colorName: null, edition: 'HK Edition', description: 'NEC ECC adapted for Hong Kong construction law and practice.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC_ECC_HK, tags: ['Hong Kong', 'Construction', 'Regional'] },
  { id: 'nec-tsc-hk', code: ContractType.NEC_TSC_HK, title: 'TSC Hong Kong Edition', abbreviation: 'TSC HK', colorName: null, edition: 'HK Edition', description: 'NEC TSC adapted for Hong Kong term service requirements.', institution: 'NEC', imageUrl: NEC_IMAGES.NEC_TSC_HK, tags: ['Hong Kong', 'Term service', 'Regional'] },
  // FAC/TAC
  { id: 'fac-1', code: ContractType.FAC_1, title: 'Framework Alliance Contract', abbreviation: 'FAC-1', colorName: null, edition: '1st Edition', description: 'Multi-party framework alliance for collaborative project delivery.', institution: 'NEC', imageUrl: NEC_IMAGES.FAC_1, tags: ['Alliance', 'Framework', 'Multi-party'] },
  { id: 'tac-1', code: ContractType.TAC_1, title: 'Term Alliance Contract', abbreviation: 'TAC-1', colorName: null, edition: '1st Edition', description: 'Multi-party term alliance for ongoing collaborative relationships.', institution: 'NEC', imageUrl: NEC_IMAGES.TAC_1, tags: ['Alliance', 'Term', 'Multi-party'] },
];

// ─── Role-based recommendations ──────────────────────────────

const ROLE_RECOMMENDATIONS: Record<string, ContractType[]> = {
  'Main Contractor': [ContractType.FIDIC_RED_BOOK_2017, ContractType.NEC4_ECC, ContractType.FIDIC_YELLOW_BOOK_2017, ContractType.FIDIC_SUBCONTRACT_YELLOW_2019],
  'JV Contractor': [ContractType.FIDIC_RED_BOOK_2017, ContractType.NEC4_ECC, ContractType.FIDIC_YELLOW_BOOK_2017, ContractType.FIDIC_SUBCONTRACT_YELLOW_2019],
  'Consortium': [ContractType.FIDIC_RED_BOOK_2017, ContractType.NEC4_ECC, ContractType.FIDIC_YELLOW_BOOK_2017, ContractType.FIDIC_SUBCONTRACT_YELLOW_2019],
  'Employer': [ContractType.FIDIC_RED_BOOK_2017, ContractType.FIDIC_YELLOW_BOOK_2017, ContractType.FIDIC_SILVER_BOOK_2017, ContractType.NEC4_DBOC],
  'Client': [ContractType.FIDIC_RED_BOOK_2017, ContractType.FIDIC_YELLOW_BOOK_2017, ContractType.FIDIC_SILVER_BOOK_2017, ContractType.NEC4_DBOC],
  'Engineer': [ContractType.FIDIC_WHITE_BOOK_2017, ContractType.NEC4_PSC, ContractType.NEC3_PSC, ContractType.NEC4_FC],
  'Consultant': [ContractType.FIDIC_WHITE_BOOK_2017, ContractType.NEC4_PSC, ContractType.NEC3_PSC, ContractType.NEC4_FC],
  'Subcontractor': [ContractType.FIDIC_SUBCONTRACT_YELLOW_2019, ContractType.NEC4_ECC, ContractType.NEC4_SC, ContractType.NEC4_TSC],
  default: [ContractType.FIDIC_RED_BOOK_2017, ContractType.FIDIC_YELLOW_BOOK_2017, ContractType.NEC4_ECC, ContractType.NEC4_PSC],
};

// ─── Book Cover Image Component ──────────────────────────────

function BookCoverImage({ src, alt, colorName, className = '' }: { src: string; alt: string; colorName: string | null; className?: string }) {
  const [imgError, setImgError] = useState(false);

  if (imgError && colorName && FIDIC_COLORS[colorName]) {
    return (
      <div className={`flex items-center justify-center rounded-lg ${FIDIC_COLORS[colorName]} ${className}`}>
        <span className="text-xs font-bold text-white drop-shadow-sm">{colorName}</span>
      </div>
    );
  }

  if (imgError) {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-gray-200 ${className}`}>
        <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
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

// ─── Main Store Page ─────────────────────────────────────────

export default function ContractStorePage() {
  const [search, setSearch] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState<'ALL' | 'FIDIC' | 'NEC'>('ALL');
  const [chatOpen, setChatOpen] = useState(false);

  // For recommendations — in a real app this comes from user profile/project
  const userRole = 'default';

  const recommendedCodes = ROLE_RECOMMENDATIONS[userRole] || ROLE_RECOMMENDATIONS.default;
  const recommendedContracts = ALL_CONTRACTS.filter((c) => recommendedCodes.includes(c.code));

  const filteredContracts = useMemo(() => {
    let result = ALL_CONTRACTS;
    if (institutionFilter !== 'ALL') {
      result = result.filter((c) => c.institution === institutionFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.abbreviation.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [search, institutionFilter]);

  const fidicContracts = filteredContracts.filter((c) => c.institution === 'FIDIC');
  const necContracts = filteredContracts.filter((c) => c.institution === 'NEC');

  const scrollToGrid = () => {
    document.getElementById('contract-grid')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Hero Section ──────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary-600 to-blue-800">
        {/* Decorative circles */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-white/5" />

        <div className="relative mx-auto max-w-6xl px-6 py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Standard Forms of Contract
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-blue-100">
            Browse internationally recognized contract forms from FIDIC and NEC.
            Get AI-powered recommendations tailored to your project and role.
          </p>

          {/* Search Bar */}
          <div className="mx-auto mt-8 max-w-xl">
            <div className="flex items-center rounded-xl bg-white px-4 py-3 shadow-lg">
              <svg className="mr-3 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by contract name, type, or use case..."
                className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              onClick={scrollToGrid}
              className="rounded-lg border-2 border-white/30 px-6 py-2.5 text-sm font-semibold text-white transition hover:border-white hover:bg-white/10"
            >
              Browse All Contracts
            </button>
            <button
              onClick={() => setChatOpen(true)}
              className="rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-primary shadow-lg transition hover:bg-blue-50"
            >
              Ask AI Advisor
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* ── Recommended for You ─────────────────────────── */}
        <section className="mb-12">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">Recommended for Your Role</h2>
            <p className="mt-1 text-sm text-gray-500">
              Based on your profile — showing top picks for your role
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recommendedContracts.map((contract) => (
              <Link
                key={contract.id}
                to={`/app/store/contract/${contract.id}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:border-primary/30 hover:shadow-lg"
              >
                <div className="flex items-center justify-center bg-gray-50 p-4">
                  <BookCoverImage
                    src={contract.imageUrl}
                    alt={contract.title}
                    colorName={contract.colorName}
                    className="h-32 w-24 shadow-md"
                  />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <span className={`mb-1 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    contract.institution === 'FIDIC'
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-teal-100 text-teal-700'
                  }`}>
                    {contract.institution}
                  </span>
                  <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 group-hover:text-primary">
                    {contract.title}
                  </h3>
                  <p className="mt-1 text-xs text-gray-400">{contract.edition}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Browse by Institution ───────────────────────── */}
        <section className="mb-12">
          <h2 className="mb-6 text-xl font-bold text-gray-900">Browse by Institution</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* FIDIC Card */}
            <button
              onClick={() => {
                setInstitutionFilter(institutionFilter === 'FIDIC' ? 'ALL' : 'FIDIC');
                document.getElementById('contract-grid')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className={`group flex items-center gap-5 rounded-xl border-2 p-6 text-left transition-all hover:shadow-md ${
                institutionFilter === 'FIDIC'
                  ? 'border-blue-500 bg-blue-50/50 shadow-md'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-orange-100">
                <svg className="h-8 w-8 text-orange-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">FIDIC</h3>
                <p className="text-sm text-gray-500">International Federation of Consulting Engineers</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.331 0 4.466.89 6.064 2.346m0-14.304a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.346m0-14.304v14.304" /></svg>
                    12 Standard Forms
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                    Used in 100+ countries
                  </span>
                </div>
              </div>
            </button>

            {/* NEC Card */}
            <button
              onClick={() => {
                setInstitutionFilter(institutionFilter === 'NEC' ? 'ALL' : 'NEC');
                document.getElementById('contract-grid')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className={`group flex items-center gap-5 rounded-xl border-2 p-6 text-left transition-all hover:shadow-md ${
                institutionFilter === 'NEC'
                  ? 'border-teal-500 bg-teal-50/50 shadow-md'
                  : 'border-gray-200 hover:border-teal-300'
              }`}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-100">
                <svg className="h-8 w-8 text-teal-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">NEC</h3>
                <p className="text-sm text-gray-500">New Engineering Contract Suite</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.331 0 4.466.89 6.064 2.346m0-14.304a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.346m0-14.304v14.304" /></svg>
                    19 Contract Types
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                    UK & International
                  </span>
                </div>
              </div>
            </button>
          </div>
        </section>

        {/* ── Contract Grid ───────────────────────────────── */}
        <section id="contract-grid">
          {/* Filter indicator */}
          {institutionFilter !== 'ALL' && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-gray-500">Filtered by:</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                institutionFilter === 'FIDIC' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'
              }`}>
                {institutionFilter}
                <button onClick={() => setInstitutionFilter('ALL')} className="ml-1 hover:opacity-70">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </span>
            </div>
          )}

          {/* FIDIC Section */}
          {fidicContracts.length > 0 && (
            <div className="mb-10">
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-700">FIDIC</span>
                <h3 className="text-lg font-bold text-gray-900">FIDIC Standard Forms</h3>
                <span className="text-sm text-gray-400">({fidicContracts.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {fidicContracts.map((contract) => (
                  <ContractCard key={contract.id} contract={contract} />
                ))}
              </div>
            </div>
          )}

          {/* NEC Section */}
          {necContracts.length > 0 && (
            <div className="mb-10">
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-bold text-teal-700">NEC</span>
                <h3 className="text-lg font-bold text-gray-900">NEC Standard Forms</h3>
                <span className="text-sm text-gray-400">({necContracts.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {necContracts.map((contract) => (
                  <ContractCard key={contract.id} contract={contract} />
                ))}
              </div>
            </div>
          )}

          {filteredContracts.length === 0 && (
            <div className="py-16 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="mt-4 text-gray-500">No contracts match your search.</p>
              <button
                onClick={() => { setSearch(''); setInstitutionFilter('ALL'); }}
                className="mt-2 text-sm font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ── AI Advisor Floating Button ────────────────────── */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-primary-600 hover:shadow-xl"
        >
          <span className="text-lg">🤖</span>
          AI Contract Advisor
        </button>
      )}

      {/* ── Chat Panel ────────────────────────────────────── */}
      <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

// ─── Contract Card Component ─────────────────────────────────

function ContractCard({ contract }: { contract: StoreContract }) {
  return (
    <Link
      to={`/app/store/contract/${contract.id}`}
      className="group flex overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:border-primary/30 hover:shadow-lg"
    >
      {/* Left — Book Cover (30%) */}
      <div className="flex w-[30%] shrink-0 items-center justify-center bg-gray-50 p-3">
        <BookCoverImage
          src={contract.imageUrl}
          alt={contract.title}
          colorName={contract.colorName}
          className="h-28 w-20 shadow-md"
        />
      </div>

      {/* Right — Details (70%) */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <span className={`mb-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
            contract.institution === 'FIDIC'
              ? 'bg-orange-100 text-orange-700'
              : 'bg-teal-100 text-teal-700'
          }`}>
            {contract.institution}
          </span>
          <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 group-hover:text-primary">
            {contract.title}
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">{contract.edition}</p>
          <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{contract.description}</p>
        </div>
        <div className="mt-3">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:underline">
            Learn More & Buy License
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
