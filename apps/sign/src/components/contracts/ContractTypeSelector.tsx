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
}

const FIDIC_2017: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_RED_BOOK_2017, title: 'Construction Contract', abbreviation: 'Red Book', colorName: 'Red Book', edition: '2nd Ed 2017', description: 'Works designed by the Employer' },
  { code: ContractType.FIDIC_YELLOW_BOOK_2017, title: 'Plant and Design-Build Contract', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '2nd Ed 2017', description: 'Works designed by the Contractor' },
  { code: ContractType.FIDIC_SILVER_BOOK_2017, title: 'EPC/Turnkey Contract', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '2nd Ed 2017', description: 'Total Contractor responsibility' },
  { code: ContractType.FIDIC_WHITE_BOOK_2017, title: 'Client/Consultant Model Services Agreement', abbreviation: 'White Book', colorName: 'White Book', edition: '5th Ed 2017', description: 'Consultant services and feasibility' },
  { code: ContractType.FIDIC_GREEN_BOOK_2021, title: 'Short Form of Contract', abbreviation: 'Green Book', colorName: 'Green Book', edition: '2nd Ed 2021', description: 'Small value or short duration works' },
  { code: ContractType.FIDIC_EMERALD_BOOK_2019, title: 'Underground Works Contract', abbreviation: 'Emerald Book', colorName: 'Emerald Book', edition: '1st Ed 2019', description: 'Tunnelling and underground works' },
];

const FIDIC_1999: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_RED_BOOK_1999, title: 'Construction Contract', abbreviation: 'Red Book', colorName: 'Red Book', edition: '1st Ed 1999', description: 'Works designed by the Employer (legacy)' },
  { code: ContractType.FIDIC_YELLOW_BOOK_1999, title: 'Plant and Design-Build Contract', abbreviation: 'Yellow Book', colorName: 'Yellow Book', edition: '1st Ed 1999', description: 'Works designed by the Contractor (legacy)' },
  { code: ContractType.FIDIC_SILVER_BOOK_1999, title: 'EPC/Turnkey Contract', abbreviation: 'Silver Book', colorName: 'Silver Book', edition: '1st Ed 1999', description: 'Total Contractor responsibility (legacy)' },
];

const FIDIC_SUB_MDB: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_SUBCONTRACT_YELLOW_2019, title: 'Subcontract for Plant and Design-Build', abbreviation: 'Sub Yellow', edition: '1st Ed 2019', description: 'Subcontract for Yellow Book 1999 main contract' },
  { code: ContractType.FIDIC_PINK_BOOK, title: 'MDB Harmonised Edition', abbreviation: 'Pink Book', colorName: 'Pink Book', edition: 'MDB Edition', description: 'Multilateral Development Bank funded works' },
];

const FIDIC_DREDGING: ContractTypeInfo[] = [
  { code: ContractType.FIDIC_BLUE_GREEN_BOOK_2016, title: 'Dredging and Reclamation Works', abbreviation: 'Blue-Green', colorName: 'Blue-Green Book', edition: '2nd Ed 2016', description: 'Marine and inland waterway dredging' },
];

const NEC4: ContractTypeInfo[] = [
  { code: ContractType.NEC4_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Primary contract for major works' },
  { code: ContractType.NEC4_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Professional service providers' },
  { code: ContractType.NEC4_TSC, title: 'Term Service Contract', abbreviation: 'TSC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Period-based service management' },
  { code: ContractType.NEC4_SC, title: 'Supply Contract', abbreviation: 'SC', edition: 'Jun 2017 (rev Jan 2023)', description: 'High-value goods and materials' },
  { code: ContractType.NEC4_FC, title: 'Framework Contract', abbreviation: 'FC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Framework agreements for work packages' },
  { code: ContractType.NEC4_DBOC, title: 'Design Build and Operate Contract', abbreviation: 'DBOC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Design, build and operate combined' },
  { code: ContractType.NEC4_FMC, title: 'Facilities Management Contract', abbreviation: 'FMC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Facilities management services' },
  { code: ContractType.NEC4_ALC, title: 'Alliance Contract', abbreviation: 'ALC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Multi-party alliance arrangements' },
  { code: ContractType.NEC4_DRSC, title: 'Dispute Resolution Service Contract', abbreviation: 'DRSC', edition: 'Jun 2017 (rev Jan 2023)', description: 'Adjudicators and dispute panels' },
];

const NEC3: ContractTypeInfo[] = [
  { code: ContractType.NEC3_ECC, title: 'Engineering and Construction Contract', abbreviation: 'ECC', edition: 'Apr 2013', description: 'Legacy NEC3 primary contract' },
  { code: ContractType.NEC3_PSC, title: 'Professional Service Contract', abbreviation: 'PSC', edition: 'Apr 2013', description: 'Legacy NEC3 professional services' },
  { code: ContractType.NEC3_TSC, title: 'Term Service Contract', abbreviation: 'TSC', edition: 'Apr 2013', description: 'Legacy NEC3 term services' },
  { code: ContractType.NEC3_SC, title: 'Supply Contract', abbreviation: 'SC', edition: 'Apr 2013', description: 'Legacy NEC3 supply contract' },
  { code: ContractType.NEC3_FC, title: 'Framework Contract', abbreviation: 'FC', edition: 'Apr 2013', description: 'Legacy NEC3 framework agreement' },
  { code: ContractType.NEC3_AC, title: 'Adjudicator\'s Contract', abbreviation: 'AC', edition: 'Apr 2013', description: 'Legacy NEC3 adjudicator appointment' },
];

const NEC_HK: ContractTypeInfo[] = [
  { code: ContractType.NEC_ECC_HK, title: 'ECC Hong Kong Edition', abbreviation: 'ECC HK', edition: 'HK Edition', description: 'Adapted for Hong Kong construction law' },
  { code: ContractType.NEC_TSC_HK, title: 'TSC Hong Kong Edition', abbreviation: 'TSC HK', edition: 'HK Edition', description: 'Adapted for Hong Kong term services' },
];

const NEC_FAC_TAC: ContractTypeInfo[] = [
  { code: ContractType.FAC_1, title: 'Framework Alliance Contract', abbreviation: 'FAC-1', edition: '1st Edition', description: 'Multi-party framework alliance' },
  { code: ContractType.TAC_1, title: 'Term Alliance Contract', abbreviation: 'TAC-1', edition: '1st Edition', description: 'Multi-party term alliance' },
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
            <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1">
              {getFidicTypes().map((ct) => (
                <button
                  key={ct.code}
                  onClick={() => handleTypeClick(ct.code)}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-all hover:border-orange-300 hover:bg-orange-50/30 hover:shadow-sm"
                >
                  {ct.colorName && (
                    <div className={`h-8 w-8 shrink-0 rounded-lg ${FIDIC_COLORS[ct.colorName] || 'bg-gray-300'}`} />
                  )}
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
            <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1">
              {getNecTypes().map((ct) => (
                <button
                  key={ct.code}
                  onClick={() => handleTypeClick(ct.code)}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-all hover:border-teal-300 hover:bg-teal-50/30 hover:shadow-sm"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-[10px] font-bold text-teal-700">
                    {ct.abbreviation}
                  </div>
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
