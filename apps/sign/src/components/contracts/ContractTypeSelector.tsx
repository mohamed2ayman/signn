import { useState } from 'react';
import { ContractType, LicenseOrganization } from '@/types';

// ─── Contract Type Metadata ────────────────────────────────

interface ContractTypeInfo {
  code: ContractType;
  title: string;
  abbreviation: string;
  colorName?: string;
  edition: string;
  description: string;
  imageUrl?: string;
}

// ─── Official Book Cover Image URLs ────────────────────────
// Images are the intellectual property of FIDIC and NEC respectively.
// Displayed only for informational/referral purposes. Always loaded
// from the original source URLs — never cached, compressed, or re-hosted.

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
  FIDIC_BLUE_GREEN_BOOK_2016: 'https://fidic.org/sites/default/files/styles/bookshop_homepage/public/book-images/RED_reprint_3D_NO_LABEL_0.png',
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
  NEC_ECC_HK: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/d3f26b9a-78f6-416e-a5ac-47856ed89c53/ECC-2013AW.jpg?width=234',
  NEC_TSC_HK: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getmedia/5c2a49bf-91e5-4c42-bcd6-f29ce0a40017/TSC-2013AW.jpg?width=234',
  FAC_1: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getattachment/d539b43f-aed1-468d-bc28-8a3ec0ae024b/FAC1-1.jpg?width=234',
  TAC_1: 'https://chpxyzyeka.cloudimg.io/https://www.neccontract.com:443/getattachment/d539b43f-aed1-468d-bc28-8a3ec0ae024b/FAC1-1.jpg?width=234',
};

function getImageUrl(code: string): string | undefined {
  return FIDIC_IMAGES[code] || NEC_IMAGES[code];
}

const FIDIC_2017: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_RED_BOOK_2017, title: 'Construction Contract', abbreviation: 'Red Book', colorName: 'Red Book', edition: '2nd Ed 2017', description: 'Works designed by the Employer', imageUrl: FIDIC_IMAGES.FIDIC_RED_BOOK_2017 },
  { code: ContractType.FIDIC_YELLOW_BOOK_2017, title: 'Plant and Design-Build Contract', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '2nd Ed 2017', description: 'Works designed by the Contractor', imageUrl: FIDIC_IMAGES.FIDIC_YELLOW_BOOK_2017 },
  { code: ContractType.FIDIC_SILVER_BOOK_2017, title: 'EPC/Turnkey Contract', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '2nd Ed 2017', description: 'Total Contractor responsibility', imageUrl: FIDIC_IMAGES.FIDIC_SILVER_BOOK_2017 },
  { code: ContractType.FIDIC_WHITE_BOOK_2017, title: 'Client/Consultant Model Services Agreement', abbreviation: 'White Book', colorName: 'White Book', edition: '5th Ed 2017', description: 'Consultant services and feasibility', imageUrl: FIDIC_IMAGES.FIDIC_WHITE_BOOK_2017 },
  { code: ContractType.FIDIC_GREEN_BOOK_2021, title: 'Short Form of Contract', abbreviation: 'Green Book', colorName: 'Green Book', edition: '2nd Ed 2021', description: 'Small value or short duration works', imageUrl: FIDIC_IMAGES.FIDIC_GREEN_BOOK_2021 },
  { code: ContractType.FIDIC_EMERALD_BOOK_2019, title: 'Underground Works Contract', abbreviation: 'Emerald Book', colorName: 'Emerald Book', edition: '1st Ed 2019', description: 'Tunnelling and underground works', imageUrl: FIDIC_IMAGES.FIDIC_EMERALD_BOOK_2019 },
];

const FIDIC_1999: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_RED_BOOK_1999, title: 'Construction Contract', abbreviation: 'Red Book', colorName: 'Red Book', edition: '1st Ed 1999', description: 'Works designed by the Employer (legacy)', imageUrl: FIDIC_IMAGES.FIDIC_RED_BOOK_1999 },
  { code: ContractType.FIDIC_YELLOW_BOOK_1999, title: 'Plant and Design-Build Contract', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '1st Ed 1999', description: 'Works designed by the Contractor (legacy)', imageUrl: FIDIC_IMAGES.FIDIC_YELLOW_BOOK_1999 },
  { code: ContractType.FIDIC_SILVER_BOOK_1999, title: 'EPC/Turnkey Contract', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '1st Ed 1999', description: 'Total Contractor responsibility (legacy)', imageUrl: FIDIC_IMAGES.FIDIC_SILVER_BOOK_1999 },
];

const FIDIC_SUB_MDB: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_SUBCONTRACT_YELLOW_2019, title: 'Subcontract for Plant and Design-Build', abbreviation: 'Sub Yellow', edition: '1st Ed 2019', description: 'Subcontract for Yellow Book 1999 main contract', imageUrl: FIDIC_IMAGES.FIDIC_SUBCONTRACT_YELLOW_2019 },
  { code: ContractType.FIDIC_PINK_BOOK, title: 'MDB Harmonised Edition', abbreviation: 'Pink Book', colorName: 'Pink Book', edition: 'MDB Edition', description: 'Multilateral Development Bank funded works', imageUrl: FIDIC_IMAGES.FIDIC_PINK_BOOK },
];

const FIDIC_DREDGING: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_BLUE_GREEN_BOOK_2016, title: 'Dredging and Reclamation Works', abbreviation: 'Blue-Green', colorName: 'Blue-Green Book', edition: '2nd Ed 2016', description: 'Marine and inland waterway dredging', imageUrl: FIDIC_IMAGES.FIDIC_BLUE_GREEN_BOOK_2016 },
];

const NEC4: ContractTypeInfo[] = [
  { code: ContractType.NEC4_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Primary contract for major works', imageUrl: NEC_IMAGES.NEC4_ECC },
  { code: ContractType.NEC4_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Professional service providers', imageUrl: NEC_IMAGES.NEC4_PSC },
  { code: ContractType.NEC4_TSC, title: 'Term Service Contract', abbreviation: 'TSC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Period-based service management', imageUrl: NEC_IMAGES.NEC4_TSC },
  { code: ContractType.NEC4_SC, title: 'Supply Contract', abbreviation: 'SC', edition: 'Jun 2017 (rev Jan 2023)', description: 'High-value goods and materials', imageUrl: NEC_IMAGES.NEC4_SC },
  { code: ContractType.NEC4_FC, title: 'Framework Contract', abbreviation: 'FC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Framework agreements for work packages', imageUrl: NEC_IMAGES.NEC4_FC },
  { code: ContractType.NEC4_DBOC, title: 'Design Build and Operate Contract', abbreviation: 'DBOC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Design, build and operate combined', imageUrl: NEC_IMAGES.NEC4_DBOC },
  { code: ContractType.NEC4_FMC, title: 'Facilities Management Contract', abbreviation: 'FMC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Facilities management services', imageUrl: NEC_IMAGES.NEC4_FMC },
  { code: ContractType.NEC4_ALC, title: 'Alliance Contract', abbreviation: 'ALC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Multi-party alliance arrangements', imageUrl: NEC_IMAGES.NEC4_ALC },
  { code: ContractType.NEC4_DRSC, title: 'Dispute Resolution Service Contract', abbreviation: 'DRSC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Adjudicators and dispute panels', imageUrl: NEC_IMAGES.NEC4_DRSC },
];

const NEC3: ContractTypeInfo[] = [
  { code: ContractType.NEC3_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', edition: 'Apr 2013', description: 'Legacy NEC3 primary contract', imageUrl: NEC_IMAGES.NEC3_ECC },
  { code: ContractType.NEC3_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', edition: 'Apr 2013', description: 'Legacy NEC3 professional services', imageUrl: NEC_IMAGES.NEC3_PSC },
  { code: ContractType.NEC3_TSC, title: 'Term Service Contract', abbreviation: 'TSC', edition: 'Apr 2013', description: 'Legacy NEC3 term services', imageUrl: NEC_IMAGES.NEC3_TSC },
  { code: ContractType.NEC3_SC, title: 'Supply Contract', abbreviation: 'SC', edition: 'Apr 2013', description: 'Legacy NEC3 supply contract', imageUrl: NEC_IMAGES.NEC3_SC },
  { code: ContractType.NEC3_FC, title: 'Framework Contract', abbreviation: 'FC', edition: 'Apr 2013', description: 'Legacy NEC3 framework agreement', imageUrl: NEC_IMAGES.NEC3_FC },
  { code: ContractType.NEC3_AC, title: 'Adjudicator\'s Contract', abbreviation: 'AC', edition: 'Apr 2013', description: 'Legacy NEC3 adjudicator appointment', imageUrl: NEC_IMAGES.NEC3_AC },
];

const NEC_HK: ContractTypeInfo[] = [
  { code: ContractType.NEC_ECC_HK, title: 'ECC Hong Kong Edition', abbreviation: 'ECC HK', edition: 'HK Edition', description: 'Adapted for Hong Kong construction law', imageUrl: NEC_IMAGES.NEC_ECC_HK },
  { code: ContractType.NEC_TSC_HK, title: 'TSC Hong Kong Edition', abbreviation: 'TSC HK', edition: 'HK Edition', description: 'Adapted for Hong Kong term services', imageUrl: NEC_IMAGES.NEC_TSC_HK },
];

const NEC_FAC_TAC: ContractTypeInfo[] = [
  { code: ContractType.FAC_1, title: 'Framework Alliance Contract', abbreviation: 'FAC-1', edition: '1st Edition', description: 'Multi-party framework alliance', imageUrl: NEC_IMAGES.FAC_1 },
  { code: ContractType.TAC_1, title: 'Term Alliance Contract', abbreviation: 'TAC-1', edition: '1st Edition', description: 'Multi-party term alliance', imageUrl: NEC_IMAGES.TAC_1 },
];

// Color mapping for FIDIC books
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

// ─── Book Cover Image with Fallback ────────────────────────
function BookCoverImage({
  src,
  alt,
  colorName,
  abbreviation,
  size = 'sm',
}: {
  src?: string;
  alt: string;
  colorName?: string;
  abbreviation: string;
  size?: 'sm' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const dims = size === 'lg' ? 'w-[160px] h-[220px]' : 'w-[80px] h-[110px]';
  const fallbackColor = colorName ? (FIDIC_COLORS[colorName] || 'bg-teal-600') : 'bg-teal-600';

  if (!src || failed) {
    return (
      <div
        className={`${dims} shrink-0 rounded-lg ${fallbackColor} flex items-center justify-center shadow-sm`}
      >
        <span className={`font-bold text-white drop-shadow-sm ${size === 'lg' ? 'text-lg' : 'text-[10px]'}`}>
          {abbreviation}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`${dims} shrink-0 rounded-lg object-cover shadow-sm`}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
    />
  );
}

// Also export the image URL lookup and component for use in detail pages
export { getImageUrl, BookCoverImage };
export type { ContractTypeInfo };

type Family = 'FIDIC' | 'NEC' | 'ADHOC';
type FidicTab = '2017' | '1999' | 'sub_mdb' | 'dredging';
type NecTab = 'nec4' | 'nec3' | 'hk' | 'fac_tac';

interface Props {
  onSelect: (contractType: ContractType) => void;
}

export default function ContractTypeSelector({ onSelect }: Props) {
  const [family, setFamily] = useState<Family | null>(null);
  const [fidicTab, setFidicTab] = useState<FidicTab>('2017');
  const [necTab, setNecTab] = useState<NecTab>('nec4');
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [pendingType, setPendingType] = useState<ContractType | null>(null);

  const handleTypeClick = (type: ContractType) => {
    if (type === ContractType.ADHOC) {
      onSelect(type);
      return;
    }
    setPendingType(type);
    setLicenseAccepted(false);
    setShowLicenseModal(true);
  };

  const handleLicenseConfirm = () => {
    if (pendingType && licenseAccepted) {
      setShowLicenseModal(false);
      onSelect(pendingType);
    }
  };

  const licenseOrg: LicenseOrganization | null = pendingType
    ? (pendingType as string).startsWith('FIDIC_')
      ? LicenseOrganization.FIDIC
      : LicenseOrganization.NEC
    : null;

  const getFidicTypes = (): ContractTypeInfo[] => {
    switch (fidicTab) {
      case '2017': return FIDIC_2017;
      case '1999': return FIDIC_1999;
      case 'sub_mdb': return FIDIC_SUB_MDB;
      case 'dredging': return FIDIC_DREDGING;
    }
  };

  const getNecTypes = (): ContractTypeInfo[] => {
    switch (necTab) {
      case 'nec4': return NEC4;
      case 'nec3': return NEC3;
      case 'hk': return NEC_HK;
      case 'fac_tac': return NEC_FAC_TAC;
    }
  };

  return (
    <>
      <div className="space-y-5">
        {/* ── Level 1: Family ── */}
        {!family && (
          <>
            <p className="text-sm text-gray-500">Select a contract family</p>
            <div className="grid grid-cols-3 gap-3">
              {/* FIDIC Card */}
              <button
                onClick={() => setFamily('FIDIC')}
                className="group flex flex-col items-center gap-2.5 rounded-xl border-2 border-gray-200 p-5 text-center transition-all hover:border-orange-400 hover:bg-orange-50/50 hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 text-orange-600 transition group-hover:bg-orange-200">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">FIDIC</p>
                  <p className="mt-0.5 text-xs text-gray-400">International Federation of Consulting Engineers</p>
                </div>
              </button>

              {/* NEC Card */}
              <button
                onClick={() => setFamily('NEC')}
                className="group flex flex-col items-center gap-2.5 rounded-xl border-2 border-gray-200 p-5 text-center transition-all hover:border-teal-400 hover:bg-teal-50/50 hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 text-teal-600 transition group-hover:bg-teal-200">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">NEC</p>
                  <p className="mt-0.5 text-xs text-gray-400">New Engineering Contract Suite</p>
                </div>
              </button>

              {/* Ad-hoc Card */}
              <button
                onClick={() => handleTypeClick(ContractType.ADHOC)}
                className="group flex flex-col items-center gap-2.5 rounded-xl border-2 border-gray-200 p-5 text-center transition-all hover:border-primary hover:bg-blue-50/50 hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-primary transition group-hover:bg-blue-200">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Ad-hoc (Custom)</p>
                  <p className="mt-0.5 text-xs text-gray-400">Draft a custom contract from scratch</p>
                </div>
              </button>
            </div>
          </>
        )}

        {/* ── Level 2+3: FIDIC sub-group + types ── */}
        {family === 'FIDIC' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => setFamily(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">FIDIC</span>
              <p className="text-sm text-gray-500">Select edition and contract type</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
              {([
                ['2017', '2017 Rainbow Suite'],
                ['1999', '1999 Rainbow Suite'],
                ['sub_mdb', 'Subcontracts & MDB'],
                ['dredging', 'Dredging'],
              ] as [FidicTab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFidicTab(key)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    fidicTab === key
                      ? 'bg-white text-orange-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Contract type cards */}
            <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-1">
              {getFidicTypes().map((ct) => (
                <button
                  key={ct.code}
                  onClick={() => handleTypeClick(ct.code)}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-all hover:border-orange-300 hover:bg-orange-50/30 hover:shadow-sm"
                >
                  <BookCoverImage
                    src={ct.imageUrl}
                    alt={`${ct.title} — FIDIC ${ct.abbreviation} (${ct.edition})`}
                    colorName={ct.colorName}
                    abbreviation={ct.abbreviation}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{ct.title}</p>
                      <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">{ct.abbreviation}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">{ct.edition} — {ct.description}</p>
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Level 2+3: NEC sub-group + types ── */}
        {family === 'NEC' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => setFamily(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">NEC</span>
              <p className="text-sm text-gray-500">Select edition and contract type</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
              {([
                ['nec4', 'NEC4'],
                ['nec3', 'NEC3'],
                ['hk', 'HK Edition'],
                ['fac_tac', 'FAC/TAC'],
              ] as [NecTab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setNecTab(key)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    necTab === key
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Contract type cards */}
            <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-1">
              {getNecTypes().map((ct) => (
                <button
                  key={ct.code}
                  onClick={() => handleTypeClick(ct.code)}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-all hover:border-teal-300 hover:bg-teal-50/30 hover:shadow-sm"
                >
                  <BookCoverImage
                    src={ct.imageUrl}
                    alt={`${ct.title} — NEC ${ct.abbreviation} (${ct.edition})`}
                    abbreviation={ct.abbreviation}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{ct.title}</p>
                      <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">{ct.abbreviation}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">{ct.edition} — {ct.description}</p>
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── License Acknowledgment Modal ── */}
      {showLicenseModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-900/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200/50 bg-white p-6 shadow-elevated">
            <div className="mb-4 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                licenseOrg === LicenseOrganization.FIDIC ? 'bg-orange-100 text-orange-600' : 'bg-teal-100 text-teal-600'
              }`}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">License Acknowledgment</h3>
                <p className="text-sm text-gray-400">{licenseOrg === LicenseOrganization.FIDIC ? 'FIDIC' : 'NEC'} Standard Form</p>
              </div>
            </div>

            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 leading-relaxed">
              {licenseOrg === LicenseOrganization.FIDIC ? (
                <>
                  This contract is based on a FIDIC standard form. FIDIC publications are protected by copyright.
                  By proceeding, you acknowledge that you or your organization holds a valid license for this FIDIC publication.
                  Unauthorized reproduction is prohibited. For licensing inquiries visit{' '}
                  <span className="font-semibold">fidic.org</span>
                </>
              ) : (
                <>
                  This contract is based on an NEC standard form published by Thomas Telford Ltd / Institution of Civil Engineers.
                  NEC<sup>&reg;</sup> is a registered trademark. By proceeding, you acknowledge that you or your organization holds a valid license
                  for this NEC publication. For licensing inquiries visit{' '}
                  <span className="font-semibold">neccontract.com</span>
                </>
              )}
            </div>

            <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 transition hover:bg-gray-50">
              <input
                type="checkbox"
                checked={licenseAccepted}
                onChange={(e) => setLicenseAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-gray-700">
                I confirm that my organization holds a valid license for this standard form
              </span>
            </label>

            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => { setShowLicenseModal(false); setPendingType(null); }}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleLicenseConfirm}
                disabled={!licenseAccepted}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
