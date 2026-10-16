export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico",
};

export const US_STATE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

/** ISO 3166-1 alpha-2 code -> display name. */
export const COUNTRIES: Record<string, string> = {
  US: "United States", CA: "Canada", MX: "Mexico", BR: "Brazil", AR: "Argentina", CL: "Chile", CO: "Colombia",
  PE: "Peru", GB: "United Kingdom", IE: "Ireland", FR: "France", DE: "Germany", ES: "Spain", PT: "Portugal",
  IT: "Italy", NL: "Netherlands", BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden", NO: "Norway",
  DK: "Denmark", FI: "Finland", PL: "Poland", CZ: "Czechia", RO: "Romania", GR: "Greece", HU: "Hungary",
  UA: "Ukraine", EE: "Estonia", LT: "Lithuania", IL: "Israel", AE: "United Arab Emirates", SA: "Saudi Arabia",
  TR: "Turkey", EG: "Egypt", ZA: "South Africa", NG: "Nigeria", KE: "Kenya", IN: "India", PK: "Pakistan",
  SG: "Singapore", MY: "Malaysia", ID: "Indonesia", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
  JP: "Japan", KR: "South Korea", CN: "China", HK: "Hong Kong", TW: "Taiwan", AU: "Australia", NZ: "New Zealand", LU: "Luxembourg", IS: "Iceland", CR: "Costa Rica", UY: "Uruguay",
};

/** Lowercased names and aliases -> ISO code. */
export const COUNTRY_ALIASES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(COUNTRIES).map(([code, name]) => [name.toLowerCase(), code])),
  usa: "US", "u.s.": "US", "u.s.a.": "US", "united states of america": "US", america: "US",
  uk: "GB", "u.k.": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB", "great britain": "GB",
  deutschland: "DE", "the netherlands": "NL", holland: "NL", "czech republic": "CZ", uae: "AE", korea: "KR",
  "republic of korea": "KR", "viet nam": "VN", "türkiye": "TR", brasil: "BR", "méxico": "MX", españa: "ES",
};

/** Two-letter codes that are safe to read as countries when they stand alone (no clash with US states). */
export const STANDALONE_COUNTRY_CODES = new Set(["US", "UK", "GB", "IE", "FR", "DE", "ES", "NL", "SE", "JP", "SG", "AU", "NZ", "MX", "BR", "IN"]);

/** Major job-market cities: lowercased name/alias -> [canonical city, state/region, country code]. */
export const CITIES: Record<string, [string, string | null, string]> = {
  "new york": ["New York", "NY", "US"], "new york city": ["New York", "NY", "US"], nyc: ["New York", "NY", "US"],
  brooklyn: ["Brooklyn", "NY", "US"], "san francisco": ["San Francisco", "CA", "US"], sf: ["San Francisco", "CA", "US"],
  "san jose": ["San Jose", "CA", "US"], "palo alto": ["Palo Alto", "CA", "US"], "mountain view": ["Mountain View", "CA", "US"],
  "menlo park": ["Menlo Park", "CA", "US"], sunnyvale: ["Sunnyvale", "CA", "US"], oakland: ["Oakland", "CA", "US"],
  "los angeles": ["Los Angeles", "CA", "US"], la: ["Los Angeles", "CA", "US"], "san diego": ["San Diego", "CA", "US"],
  irvine: ["Irvine", "CA", "US"], seattle: ["Seattle", "WA", "US"], bellevue: ["Bellevue", "WA", "US"],
  redmond: ["Redmond", "WA", "US"], portland: ["Portland", "OR", "US"], chicago: ["Chicago", "IL", "US"],
  austin: ["Austin", "TX", "US"], dallas: ["Dallas", "TX", "US"], houston: ["Houston", "TX", "US"],
  "san antonio": ["San Antonio", "TX", "US"], denver: ["Denver", "CO", "US"], boulder: ["Boulder", "CO", "US"],
  boston: ["Boston", "MA", "US"], cambridge: ["Cambridge", "MA", "US"], atlanta: ["Atlanta", "GA", "US"],
  miami: ["Miami", "FL", "US"], tampa: ["Tampa", "FL", "US"], orlando: ["Orlando", "FL", "US"],
  phoenix: ["Phoenix", "AZ", "US"], "salt lake city": ["Salt Lake City", "UT", "US"], minneapolis: ["Minneapolis", "MN", "US"],
  detroit: ["Detroit", "MI", "US"], "ann arbor": ["Ann Arbor", "MI", "US"], pittsburgh: ["Pittsburgh", "PA", "US"],
  philadelphia: ["Philadelphia", "PA", "US"], "washington dc": ["Washington", "DC", "US"], "washington, d.c.": ["Washington", "DC", "US"],
  dc: ["Washington", "DC", "US"], arlington: ["Arlington", "VA", "US"], raleigh: ["Raleigh", "NC", "US"],
  durham: ["Durham", "NC", "US"], charlotte: ["Charlotte", "NC", "US"], nashville: ["Nashville", "TN", "US"],
  "st. louis": ["St. Louis", "MO", "US"], "kansas city": ["Kansas City", "MO", "US"], columbus: ["Columbus", "OH", "US"],
  cleveland: ["Cleveland", "OH", "US"], cincinnati: ["Cincinnati", "OH", "US"], indianapolis: ["Indianapolis", "IN", "US"],
  madison: ["Madison", "WI", "US"], milwaukee: ["Milwaukee", "WI", "US"], "las vegas": ["Las Vegas", "NV", "US"],
  toronto: ["Toronto", "Ontario", "CA"], vancouver: ["Vancouver", "British Columbia", "CA"], montreal: ["Montreal", "Quebec", "CA"],
  "montréal": ["Montreal", "Quebec", "CA"], ottawa: ["Ottawa", "Ontario", "CA"], calgary: ["Calgary", "Alberta", "CA"],
  waterloo: ["Waterloo", "Ontario", "CA"], "mexico city": ["Mexico City", null, "MX"], "ciudad de méxico": ["Mexico City", null, "MX"],
  "são paulo": ["São Paulo", null, "BR"], "sao paulo": ["São Paulo", null, "BR"], "buenos aires": ["Buenos Aires", null, "AR"],
  bogota: ["Bogotá", null, "CO"], "bogotá": ["Bogotá", null, "CO"], santiago: ["Santiago", null, "CL"],
  london: ["London", "England", "GB"], manchester: ["Manchester", "England", "GB"], edinburgh: ["Edinburgh", "Scotland", "GB"],
  dublin: ["Dublin", null, "IE"], paris: ["Paris", null, "FR"], berlin: ["Berlin", null, "DE"], munich: ["Munich", null, "DE"],
  "münchen": ["Munich", null, "DE"], hamburg: ["Hamburg", null, "DE"], frankfurt: ["Frankfurt", null, "DE"],
  amsterdam: ["Amsterdam", null, "NL"], madrid: ["Madrid", null, "ES"], barcelona: ["Barcelona", null, "ES"],
  lisbon: ["Lisbon", null, "PT"], milan: ["Milan", null, "IT"], zurich: ["Zurich", null, "CH"], "zürich": ["Zurich", null, "CH"],
  stockholm: ["Stockholm", null, "SE"], copenhagen: ["Copenhagen", null, "DK"], oslo: ["Oslo", null, "NO"],
  helsinki: ["Helsinki", null, "FI"], warsaw: ["Warsaw", null, "PL"], prague: ["Prague", null, "CZ"], vienna: ["Vienna", null, "AT"],
  brussels: ["Brussels", null, "BE"], "tel aviv": ["Tel Aviv", null, "IL"], dubai: ["Dubai", null, "AE"],
  bengaluru: ["Bengaluru", "Karnataka", "IN"], bangalore: ["Bengaluru", "Karnataka", "IN"], hyderabad: ["Hyderabad", "Telangana", "IN"],
  mumbai: ["Mumbai", "Maharashtra", "IN"], pune: ["Pune", "Maharashtra", "IN"], delhi: ["Delhi", null, "IN"],
  "new delhi": ["New Delhi", null, "IN"], gurgaon: ["Gurugram", "Haryana", "IN"], gurugram: ["Gurugram", "Haryana", "IN"],
  chennai: ["Chennai", "Tamil Nadu", "IN"], singapore: ["Singapore", null, "SG"], "hong kong": ["Hong Kong", null, "HK"],
  tokyo: ["Tokyo", null, "JP"], seoul: ["Seoul", null, "KR"], shanghai: ["Shanghai", null, "CN"], beijing: ["Beijing", null, "CN"],
  taipei: ["Taipei", null, "TW"], jakarta: ["Jakarta", null, "ID"], "ho chi minh": ["Ho Chi Minh City", null, "VN"],
  "ho chi minh city": ["Ho Chi Minh City", null, "VN"], manila: ["Manila", null, "PH"], "kuala lumpur": ["Kuala Lumpur", null, "MY"],
  bangkok: ["Bangkok", null, "TH"], sydney: ["Sydney", "New South Wales", "AU"], melbourne: ["Melbourne", "Victoria", "AU"],
  brisbane: ["Brisbane", "Queensland", "AU"], auckland: ["Auckland", null, "NZ"], "cape town": ["Cape Town", null, "ZA"],
  johannesburg: ["Johannesburg", null, "ZA"], lagos: ["Lagos", null, "NG"], nairobi: ["Nairobi", null, "KE"],
  // Abbreviations seen in real postings ("SEA, SF, NYC, CHI")
  sea: ["Seattle", "WA", "US"], chi: ["Chicago", "IL", "US"], atl: ["Atlanta", "GA", "US"], bos: ["Boston", "MA", "US"],
  "south san francisco": ["South San Francisco", "CA", "US"], "bay area": ["San Francisco", "CA", "US"],
  "taipei city": ["Taipei", null, "TW"], luxembourg: ["Luxembourg", null, "LU"], cdmx: ["Mexico City", null, "MX"],
  ny: ["New York", "NY", "US"], bucharest: ["Bucharest", null, "RO"],
};
