// The site's region hub pages (/reports/region/:slug) are four fixed
// macro-regions rather than one page per country. A report belongs to a
// hub when GPT tags it with that macro-region (daily_reports.macro_regions)
// or when any country/place it covers maps to it below. Overlap is
// intentional: Greece is in all four.

export const MACRO_REGIONS = [
  {
    slug: 'europe',
    name: { en: 'Europe', el: 'Ευρώπη' },
    description: {
      en: 'EU politics, the war in Ukraine, energy security, migration and defence across the European continent.',
      el: 'Πολιτική της ΕΕ, ο πόλεμος στην Ουκρανία, ενεργειακή ασφάλεια, μετανάστευση και άμυνα σε όλη την ευρωπαϊκή ήπειρο.',
    },
  },
  {
    slug: 'balkans',
    name: { en: 'Balkans', el: 'Βαλκάνια' },
    description: {
      en: 'Greece, Turkey and the Western Balkans: politics, EU accession, border disputes, energy and security in South-East Europe.',
      el: 'Ελλάδα, Τουρκία και Δυτικά Βαλκάνια: πολιτική, ένταξη στην ΕΕ, συνοριακά ζητήματα, ενέργεια και ασφάλεια στη Νοτιοανατολική Ευρώπη.',
    },
  },
  {
    slug: 'mediterranean',
    name: { en: 'Mediterranean', el: 'Μεσόγειος' },
    description: {
      en: 'Shipping, migration, energy and security across the Mediterranean basin, from Spain and North Africa to the Levant.',
      el: 'Ναυτιλία, μετανάστευση, ενέργεια και ασφάλεια σε όλη τη Μεσόγειο, από την Ισπανία και τη Βόρεια Αφρική έως την Ανατολή.',
    },
  },
  {
    slug: 'east-med',
    name: { en: 'Eastern Mediterranean', el: 'Ανατολική Μεσόγειος' },
    short: { en: 'East Med', el: 'Αν. Μεσόγειος' },
    description: {
      en: 'Greece, Cyprus, Turkey, Israel, Lebanon, Syria and Egypt: conflict, gas fields, maritime borders and diplomacy in the East Med.',
      el: 'Ελλάδα, Κύπρος, Τουρκία, Ισραήλ, Λίβανος, Συρία και Αίγυπτος: συγκρούσεις, κοιτάσματα φυσικού αερίου, θαλάσσια σύνορα και διπλωματία στην Ανατολική Μεσόγειο.',
    },
  },
];

export const MACRO_REGION_SLUGS = MACRO_REGIONS.map((r) => r.slug);

const E = 'europe';
const B = 'balkans';
const M = 'mediterranean';
const EM = 'east-med';

// Lower-cased country / region / city names as GPT tends to write them.
const PLACE_TO_MACRO = {
  // Covering several hubs
  greece: [E, B, M, EM],
  athens: [E, B, M, EM],
  crete: [E, B, M, EM],
  aegean: [E, B, M, EM],
  'aegean sea': [E, B, M, EM],
  cyprus: [E, M, EM],
  turkey: [B, M, EM],
  türkiye: [B, M, EM],
  turkiye: [B, M, EM],
  ankara: [B, M, EM],
  istanbul: [B, M, EM],
  // Western / South-East Europe — Balkans
  albania: [E, B, M],
  'north macedonia': [E, B],
  macedonia: [E, B],
  serbia: [E, B],
  kosovo: [E, B],
  montenegro: [E, B, M],
  'bosnia and herzegovina': [E, B],
  bosnia: [E, B],
  croatia: [E, B, M],
  slovenia: [E, B, M],
  bulgaria: [E, B],
  romania: [E, B],
  moldova: [E, B],
  balkans: [E, B],
  'western balkans': [E, B],
  // Rest of Europe
  europe: [E],
  'european union': [E],
  eu: [E],
  brussels: [E],
  ukraine: [E],
  kyiv: [E],
  russia: [E],
  moscow: [E],
  belarus: [E],
  poland: [E],
  germany: [E],
  berlin: [E],
  'united kingdom': [E],
  uk: [E],
  britain: [E],
  london: [E],
  ireland: [E],
  netherlands: [E],
  belgium: [E],
  luxembourg: [E],
  austria: [E],
  switzerland: [E],
  hungary: [E],
  'czech republic': [E],
  czechia: [E],
  slovakia: [E],
  denmark: [E],
  sweden: [E],
  norway: [E],
  finland: [E],
  iceland: [E],
  estonia: [E],
  latvia: [E],
  lithuania: [E],
  baltics: [E],
  portugal: [E],
  georgia: [E],
  armenia: [E],
  // Mediterranean Europe
  italy: [E, M],
  rome: [E, M],
  sicily: [E, M],
  malta: [E, M],
  spain: [E, M],
  france: [E, M],
  paris: [E, M],
  monaco: [E, M],
  mediterranean: [M],
  'mediterranean sea': [M],
  // North Africa
  morocco: [M],
  algeria: [M],
  tunisia: [M],
  libya: [M, EM],
  egypt: [M, EM],
  cairo: [M, EM],
  'suez canal': [M, EM],
  // Levant
  israel: [M, EM],
  gaza: [M, EM],
  'gaza strip': [M, EM],
  'west bank': [M, EM],
  palestine: [M, EM],
  'palestinian territories': [M, EM],
  lebanon: [M, EM],
  beirut: [M, EM],
  syria: [M, EM],
  damascus: [M, EM],
  'eastern mediterranean': [M, EM],
  'east med': [M, EM],
  levant: [M, EM],
};

function normalise(name) {
  return String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Macro-region slugs for a report, from GPT's own tagging plus the place
// lookup over the countries it covers.
//
// GPT's tags win when present: it is asked to tag only regions a report
// section is mainly about. The lookup is a fallback, and needs at least two
// covered places in a region — otherwise a single place spanning several
// hubs (Greece is in all four, and nearly every report mentions it) put
// every report in every hub, making the hub pages identical.
const MIN_PLACES_FOR_FALLBACK = 2;

export function macroRegionsFor(places = [], tagged = []) {
  const fromModel = MACRO_REGION_SLUGS.filter((slug) => tagged.includes(slug));
  if (fromModel.length) return fromModel;

  const counts = new Map();
  for (const place of new Set(places.map(normalise))) {
    for (const slug of PLACE_TO_MACRO[place] ?? []) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return MACRO_REGION_SLUGS.filter((slug) => (counts.get(slug) ?? 0) >= MIN_PLACES_FOR_FALLBACK);
}

// Compact label (chips, preview images); falls back to the full name.
export function macroRegionShortName(region, lang) {
  return (region.short ?? region.name)[lang];
}

export function macroRegion(slug) {
  return MACRO_REGIONS.find((r) => r.slug === slug) ?? null;
}
