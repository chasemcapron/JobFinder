/**
 * US employers whose Workday career sites were found (from each tenant's robots.txt, which lists its
 * site names) and checked live. Settings offers them for one-click adding, and their names replace
 * the ones guessed from site names ("ghr.wd1/Lateral-US" is Bank of America).
 * - 2026-10-20: a US "security analyst" search; every site answered with US security or IT roles.
 * - 2026-10-27: the app's user moved to entry-level IT, data and systems analyst roles. Searched with
 *   "IT Project Analyst", "Data Analyst" and "Systems Analyst" and ranked by the keyword matcher, US jobs
 *   only; the employers added then had at least one US 50+ match (TransUnion, Kemper, Abbott, Gartner,
 *   IQVIA and UChicago had two or more). 3M, Labcorp, J&J and Baxter answered too, but their matches
 *   were abroad.
 * - 2026-11-04: Fortune 500 companies. Each one's Workday tenant was found from robots.txt (company-name
 *   guesses across the wdN data centers; 88 of about 250 answered), then its sites were searched for
 *   "Data Analyst", "Systems Analyst", "IT Project Analyst" and "Business Analyst" (first page, US
 *   filter where offered). Added when the main US site had two or more US postings whose title matched
 *   one of the user's titles at 0.5+ and wasn't too senior for entry level. Left out despite answering:
 *   Target, J&J, Morgan Stanley, Coca-Cola, FedEx, Micron, Qualcomm, American Airlines and others with
 *   one match or none; Thomson Reuters and TD Synnex, whose matches weren't analyst roles; Truist,
 *   Huntington and Nordstrom, whose sites answered HTTP 500 that day.
 */
export const WORKDAY_SECTORS = [
  "Security companies",
  "Defense & government",
  "Tech & telecom",
  "Finance & insurance",
  "Health",
  "Industrial & energy",
  "Retail & consumer",
  "Education",
] as const;
export type WorkdaySector = (typeof WORKDAY_SECTORS)[number];

export type WorkdayEmployer = { name: string; slug: string; sector: WorkdaySector; note?: string };

const employers = (sector: WorkdaySector, list: [name: string, slug: string, note?: string][]): WorkdayEmployer[] =>
  list.map(([name, slug, note]) => ({ name, slug, sector, ...(note ? { note } : {}) }));

export const WORKDAY_EMPLOYERS: WorkdayEmployer[] = [
  ...employers("Security companies", [
    ["Arctic Wolf", "arcticwolf.wd1/External", "MDR / SOC"],
    ["Cisco", "cisco.wd5/Cisco_Careers"],
    ["CrowdStrike", "crowdstrike.wd5/crowdstrikecareers", "Falcon Complete MDR analysts"],
    ["Optiv", "optiv.wd5/Optiv_Careers", "Security consulting"],
    ["Proofpoint", "proofpoint.wd5/ProofpointCareers"],
    ["Qualys", "qualys.wd5/Careers"],
    ["ReliaQuest", "reliaquest.wd5/ReliaQuest_Careers", "MDR / SOC"],
    ["SailPoint", "sailpoint.wd1/SailPoint", "Identity security"],
    ["Trellix", "trellix.wd1/EnterpriseCareers"],
    ["Trend Micro", "trendmicro.wd3/External"],
  ]),
  ...employers("Defense & government", [
    ["Booz Allen Hamilton", "bah.wd1/BAH_Jobs"],
    ["Leidos", "leidos.wd5/External"],
    ["GDIT", "gdit.wd5/External_Career_Site"],
    ["Parsons", "parsons.wd5/Search"],
    ["KBR", "kbr.wd5/KBR_Careers"],
    ["Guidehouse", "guidehouse.wd1/External"],
    ["ICF", "icf.wd5/ICFExternal_Career_Site"],
    ["Northrop Grumman", "ngc.wd1/Northrop_Grumman_External_Site"],
    ["RTX", "globalhr.wd5/REC_RTX_Ext_Gateway", "Raytheon, Collins, Pratt & Whitney"],
    ["The Aerospace Corporation", "aero.wd5/External"],
    ["Boeing", "boeing.wd1/EXTERNAL_CAREERS"],
  ]),
  ...employers("Tech & telecom", [
    ["Adobe", "adobe.wd5/external_experienced"],
    ["AT&T", "att.wd1/ATTGeneral", "Includes government cyber roles"],
    ["CDW", "cdw.wd5/Careers"],
    ["DXC Technology", "dxctechnology.wd1/DXCJobs"],
    ["Gartner", "gartner.wd5/EXT", "Graduate data analyst roles"],
    ["Hewlett Packard Enterprise", "hpe.wd5/Jobsathpe"],
    ["HP", "hp.wd5/ExternalCareerSite"],
    ["Intel", "intel.wd1/External"],
    ["Kyndryl", "kyndryl.wd5/KyndrylProfessionalCareers"],
    ["Kyndryl", "kyndryl.wd5/KyndrylEarlyCareers", "Early-career programs"],
    ["Motorola Solutions", "motorolasolutions.wd5/Careers"],
    ["NVIDIA", "nvidia.wd5/NVIDIAExternalCareerSite"],
    ["Salesforce", "salesforce.wd12/External_Career_Site"],
    ["Unisys", "unisys.wd5/External"],
    ["Workday", "workday.wd5/Workday"],
    ["Zebra Technologies", "zebra.wd501/Zebra_careers"],
    ["Applied Materials", "amat.wd1/External"],
    ["Jabil", "jabil.wd5/Jabil_Careers"],
  ]),
  ...employers("Finance & insurance", [
    ["Allstate", "allstate.wd5/allstate_careers"],
    ["Ally", "ally.wd1/Ally"],
    ["Bank of America", "ghr.wd1/Lateral-US"],
    ["Capital One", "capitalone.wd12/Capital_One"],
    ["Fidelity Investments", "fmr.wd1/FidelityCareers"],
    ["Fifth Third Bank", "fifththird.wd5/53careers"],
    ["FIS", "fis.wd5/SearchJobs"],
    ["Fiserv", "fiserv.wd5/EXT"],
    ["Kemper", "kemper.wd5/Kemper_Careers"],
    ["M&T Bank", "mtb.wd5/MTB"],
    ["Mastercard", "mastercard.wd1/CorporateCareers"],
    ["Northwestern Mutual", "northwesternmutual.wd5/CORPORATE-CAREERS"],
    ["PNC", "pnc.wd5/External"],
    ["State Street", "statestreet.wd1/Global"],
    ["TransUnion", "transunion.wd5/TransUnion", "Data operations analysts"],
    ["Travelers", "travelers.wd5/External"],
    ["U.S. Bank", "usbank.wd1/US_Bank_Careers"],
    ["USAA", "usaa.wd1/USAAJOBSWD"],
    ["Vanguard", "vanguard.wd5/vanguard_external", "Technology Leadership Program"],
    ["Visa", "visa.wd5/Visa"],
    ["Wells Fargo", "wf.wd1/WellsFargoJobs"],
    ["Wintrust", "wintrust.wd1/Search"],
    ["American Family Insurance", "amfam.wd1/Careers"],
    ["Ameriprise Financial", "ameriprise.wd5/Ameriprise"],
    ["Broadridge", "broadridge.wd5/Careers"],
    ["First American", "firstam.wd1/firstamericancareers"],
    ["Nasdaq", "nasdaq.wd1/Global_External_Site"],
    ["Nationwide", "nationwide.wd1/Nationwide_Career"],
    ["Northern Trust", "ntrs.wd1/northerntrust"],
    ["Prudential", "pru.wd5/Careers"],
    ["Raymond James", "raymondjames.wd1/RaymondJamesCareers"],
    ["S&P Global", "spgi.wd5/SPGI_Careers"],
    ["TD Bank", "td.wd3/TD_Bank_Careers"],
    ["The Hartford", "thehartford.wd5/Careers_External"],
  ]),
  ...employers("Health", [
    ["Abbott", "abbott.wd5/abbottcareers"],
    ["Cardinal Health", "cardinalhealth.wd1/EXT"],
    ["Cigna", "cigna.wd5/cignacareers"],
    ["CVS Health", "cvshealth.wd1/CVS_Health_Careers"],
    ["Elevance Health", "elevancehealth.wd1/ANT"],
    ["HCSC", "hcsc.wd1/HCSC_External", "Blue Cross Blue Shield of Illinois, Texas and more"],
    ["Humana", "humana.wd5/Humana_External_Career_Site"],
    ["IQVIA", "iqvia.wd1/IQVIA"],
    ["McKesson", "mckesson.wd3/External_Careers"],
    ["Medtronic", "medtronic.wd1/MedtronicCareers"],
    ["Advocate Health", "aah.wd5/External"],
    ["Amgen", "amgen.wd1/Careers"],
    ["Bristol Myers Squibb", "bristolmyerssquibb.wd5/BMS"],
    ["Cleveland Clinic", "ccf.wd1/ClevelandClinicCareers"],
    ["Danaher", "danaher.wd1/DanaherJobs"],
    ["DaVita", "davita.wd1/DKC_External"],
    ["Medline", "medline.wd5/Medline"],
    ["Merck", "msd.wd5/SearchJobs"],
    ["Pfizer", "pfizer.wd1/PfizerCareers"],
  ]),
  ...employers("Industrial & energy", [
    ["Carrier", "carrier.wd5/jobs"],
    ["Chevron", "chevron.wd5/jobs"],
    ["Dow", "dow.wd1/ExternalCareers"],
    ["GE Vernova", "gevernova.wd5/Vernova_ExternalSite"],
    ["General Motors", "generalmotors.wd5/Careers_GM"],
    ["Johnson Controls", "jci.wd5/JCI"],
    ["Marathon Petroleum", "mpc.wd1/MPCCareers"],
  ]),
  ...employers("Retail & consumer", [
    ["Dollar Tree", "dollartree.wd5/dollartreeus"],
    ["Genuine Parts", "genpt.wd1/Careers", "NAPA"],
    ["O'Reilly Auto Parts", "oreillyauto.wd1/oreilly"],
    ["Procter & Gamble", "pg.wd5/1000"],
  ]),
  ...employers("Education", [
    ["University of Chicago", "uchicago.wd5/External"],
  ]),
];

const bySlug = new Map(WORKDAY_EMPLOYERS.map((e) => [e.slug.toLowerCase(), e]));

/** The listed employer for a stored slug (site names are case-insensitive on Workday). */
export function findWorkdayEmployer(slug: string): WorkdayEmployer | undefined {
  return bySlug.get(slug.toLowerCase());
}
