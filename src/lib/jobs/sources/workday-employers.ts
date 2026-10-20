/**
 * US employers whose Workday career sites were found (from each tenant's robots.txt, which lists its
 * site names) and checked live on 2026-10-20 with a US "security analyst" search: every site here
 * answered and had US security or IT roles. Settings offers them for one-click adding, and their
 * names replace the ones guessed from site names ("ghr.wd1/Lateral-US" is Bank of America).
 * The list leans toward security, defense and IT employers: the app's one user is in cybersecurity.
 */
export const WORKDAY_SECTORS = ["Security companies", "Defense & government", "Tech & telecom", "Finance & insurance", "Health"] as const;
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
    ["AT&T", "att.wd1/ATTGeneral", "Includes government cyber roles"],
    ["CDW", "cdw.wd5/Careers"],
    ["DXC Technology", "dxctechnology.wd1/DXCJobs"],
    ["HP", "hp.wd5/ExternalCareerSite"],
    ["Hewlett Packard Enterprise", "hpe.wd5/Jobsathpe"],
    ["Intel", "intel.wd1/External"],
    ["Kyndryl", "kyndryl.wd5/KyndrylProfessionalCareers"],
    ["Kyndryl", "kyndryl.wd5/KyndrylEarlyCareers", "Early-career programs"],
    ["Motorola Solutions", "motorolasolutions.wd5/Careers"],
    ["NVIDIA", "nvidia.wd5/NVIDIAExternalCareerSite"],
    ["Salesforce", "salesforce.wd12/External_Career_Site"],
    ["Unisys", "unisys.wd5/External"],
    ["Workday", "workday.wd5/Workday"],
  ]),
  ...employers("Finance & insurance", [
    ["Allstate", "allstate.wd5/allstate_careers"],
    ["Ally", "ally.wd1/Ally"],
    ["Bank of America", "ghr.wd1/Lateral-US"],
    ["Capital One", "capitalone.wd12/Capital_One"],
    ["Fidelity Investments", "fmr.wd1/FidelityCareers"],
    ["FIS", "fis.wd5/SearchJobs"],
    ["Fiserv", "fiserv.wd5/EXT"],
    ["Mastercard", "mastercard.wd1/CorporateCareers"],
    ["PNC", "pnc.wd5/External"],
    ["State Street", "statestreet.wd1/Global"],
    ["Travelers", "travelers.wd5/External"],
    ["U.S. Bank", "usbank.wd1/US_Bank_Careers"],
    ["USAA", "usaa.wd1/USAAJOBSWD"],
    ["Vanguard", "vanguard.wd5/vanguard_external", "Technology Leadership Program"],
    ["Visa", "visa.wd5/Visa"],
    ["Wells Fargo", "wf.wd1/WellsFargoJobs"],
  ]),
  ...employers("Health", [
    ["Cigna", "cigna.wd5/cignacareers"],
    ["CVS Health", "cvshealth.wd1/CVS_Health_Careers"],
    ["Elevance Health", "elevancehealth.wd1/ANT"],
    ["Humana", "humana.wd5/Humana_External_Career_Site"],
    ["McKesson", "mckesson.wd3/External_Careers"],
    ["Medtronic", "medtronic.wd1/MedtronicCareers"],
  ]),
];

const bySlug = new Map(WORKDAY_EMPLOYERS.map((e) => [e.slug.toLowerCase(), e]));

/** The listed employer for a stored slug (site names are case-insensitive on Workday). */
export function findWorkdayEmployer(slug: string): WorkdayEmployer | undefined {
  return bySlug.get(slug.toLowerCase());
}
