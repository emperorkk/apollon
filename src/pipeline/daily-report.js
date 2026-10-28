import {
  OPENAI_CHAT_MODEL,
  DAILY_REPORT_MAX_ARTICLES,
  DAILY_REPORT_MIN_ARTICLES,
} from '../lib/constants.js';
import { notifyAll } from './notify.js';
import { previousAthensDay, athensDayBoundsUtc } from '../lib/time.js';
import { macroRegionsFor, MACRO_REGION_SLUGS } from '../lib/regions.js';

// Daily report (separate cron trigger, see wrangler.toml): once a day,
// collect the previous Athens calendar day's articles and have GPT write one
// structured briefing from them. Unlike per-article processing this is a
// single live chat-completion call, so it doesn't go through the Batch API.

const SYSTEM_PROMPT =
  'You are the editor of a neutral, factual daily world-news briefing. ' +
  'Write only from the articles provided; never add facts, numbers or quotes that are not in them. ' +
  'Respond ONLY with valid JSON. No markdown, no code fences.';


// Greek → Latin (ELOT-style, simplified) so Greek titles and place names
// produce readable URL slugs instead of being stripped to nothing.
const GREEK_TO_LATIN = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

export function slugify(text) {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ου/g, 'ou')
    .replace(/[α-ω]/g, (ch) => GREEK_TO_LATIN[ch] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  // Cut long slugs at a word boundary rather than mid-word.
  return slug.length > 80 ? slug.slice(0, 80).replace(/-[^-]*$/, '') : slug;
}

async function loadDayArticles(db, date) {
  const [start, end] = athensDayBoundsUtc(date);

  const { results } = await db
    .prepare(
      `SELECT a.id, a.url, a.title_en, a.title_orig, a.summary_en, a.importance, a.pub_date,
              s.name AS source_name,
              (SELECT GROUP_CONCAT(t.name, ', ') FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id
                WHERE at2.article_id = a.id) AS topics,
              (SELECT place_name FROM article_locations l WHERE l.article_id = a.id AND l.is_subject = 1 LIMIT 1) AS place
       FROM articles a LEFT JOIN sources s ON s.id = a.source_id
       WHERE a.pub_date >= ? AND a.pub_date < ?
       ORDER BY a.importance DESC, a.pub_date DESC
       LIMIT ?`
    )
    .bind(start, end, DAILY_REPORT_MAX_ARTICLES)
    .all();
  return results;
}

function buildPrompt(date, articles) {
  const lines = articles.map((a, i) => {
    const title = a.title_en || a.title_orig;
    const summary = (a.summary_en || '').replace(/\s+/g, ' ').slice(0, 400);
    return `[${i}] (${a.importance}/10; ${a.topics || 'General'}; ${a.place || 'n/a'}; ${a.source_name || 'unknown'}) ${title}${summary ? ` — ${summary}` : ''}`;
  });

  return `Write the daily world-news briefing for ${date} (Athens time) from the ${articles.length} articles below,
ordered by importance. Group related stories into themed sections, most important first. Return a JSON
object with exactly these fields:
{
  "title":       string,   // SEO headline, 50-65 chars, naming the 2-3 biggest stories; no date
  "description": string,   // meta description, 140-158 chars, plain sentence summarising the day
  "summary":     string,   // 2-3 sentence lead paragraph (60-90 words)
  "key_points":  string[], // 5-8 one-sentence takeaways
  "sections": [            // 3-7 sections
    {
      "heading":    string,   // descriptive H2, e.g. "Ukraine: drone strikes hit energy grid"
      "paragraphs": string[], // 1-3 paragraphs, 50-120 words each
      "sources":    number[]  // indices [n] of the articles this section is based on
    }
  ],
  "keywords":    string[], // 6-12 search keywords/phrases (people, places, events)
  "regions":     string[], // 3-8 countries/regions most covered, in English
  "macro_regions": string[] // which of ${JSON.stringify(MACRO_REGION_SLUGS)} the day's stories materially concern (may be empty)
}

Articles:
${lines.join('\n')}`;
}

async function callOpenAI(env, prompt, systemPrompt = SYSTEM_PROMPT) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI daily report request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return JSON.parse(body.choices[0].message.content);
}

const asStrings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : []);

// Generates (or, with force, regenerates) the report for `date`. Returns
// { status: 'created' | 'exists' | 'skipped', ... }.
export async function generateDailyReport(env, date = previousAthensDay(), { force = false } = {}) {
  const db = env.DB;

  if (!force) {
    const existing = await db.prepare('SELECT 1 FROM daily_reports WHERE report_date = ?').bind(date).first();
    if (existing) return { status: 'exists', date };
  }

  const articles = await loadDayArticles(db, date);
  if (articles.length < DAILY_REPORT_MIN_ARTICLES) {
    console.log(`[daily-report] ${date}: only ${articles.length} articles, skipping`);
    return { status: 'skipped', date, articleCount: articles.length };
  }

  const gpt = await callOpenAI(env, buildPrompt(date, articles));

  // Sources are renumbered to just the ones actually cited, so the page
  // only lists articles the text is based on.
  const sections = (Array.isArray(gpt.sections) ? gpt.sections : [])
    .map((s) => ({
      heading: String(s?.heading ?? '').trim(),
      paragraphs: asStrings(s?.paragraphs),
      cited: (Array.isArray(s?.sources) ? s.sources : []).filter((n) => Number.isInteger(n) && articles[n]),
    }))
    .filter((s) => s.heading && s.paragraphs.length);
  if (!sections.length || !gpt.title) throw new Error(`[daily-report] ${date}: model returned no usable content`);

  const sourceIndex = new Map();
  const sources = [];
  for (const s of sections) {
    s.sources = s.cited.map((n) => {
      if (!sourceIndex.has(n)) {
        const a = articles[n];
        sourceIndex.set(n, sources.length);
        sources.push({
          title: a.title_en || a.title_orig,
          url: a.url,
          source: a.source_name || null,
          topic: (a.topics || '').split(', ')[0] || null,
        });
      }
      return sourceIndex.get(n);
    });
    delete s.cited;
  }

  const title = String(gpt.title).trim();
  const report = {
    report_date: date,
    slug: slugify(title) || date,
    title,
    description: String(gpt.description ?? gpt.summary ?? '').trim().slice(0, 300),
    summary: String(gpt.summary ?? '').trim(),
    key_points: JSON.stringify(asStrings(gpt.key_points)),
    sections: JSON.stringify(sections),
    keywords: JSON.stringify(asStrings(gpt.keywords)),
    sources: JSON.stringify(sources),
    regions: JSON.stringify(asStrings(gpt.regions)),
    macro_regions: JSON.stringify(macroRegionsFor(asStrings(gpt.regions), asStrings(gpt.macro_regions))),
    article_count: articles.length,
  };

  await db
    .prepare(
      `INSERT INTO daily_reports
         (report_date, slug, title, description, summary, key_points, sections, keywords, sources, regions, macro_regions, article_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_date) DO UPDATE SET
         slug = excluded.slug, title = excluded.title, description = excluded.description,
         summary = excluded.summary, key_points = excluded.key_points, sections = excluded.sections,
         keywords = excluded.keywords, sources = excluded.sources, regions = excluded.regions,
         macro_regions = excluded.macro_regions, article_count = excluded.article_count, updated_at = datetime('now')`
    )
    .bind(
      report.report_date,
      report.slug,
      report.title,
      report.description,
      report.summary,
      report.key_points,
      report.sections,
      report.keywords,
      report.sources,
      report.regions,
      report.macro_regions,
      report.article_count
    )
    .run();

  console.log(`[daily-report] ${date}: created "${title}" from ${articles.length} articles`);

  // The Greek version is a separate call so a translation failure never
  // loses the English report; ensureTranslations() retries it daily.
  const translated = await translateReport(env, date, 'el').then(
    () => true,
    (err) => {
      console.error(`[daily-report] ${date}: Greek translation failed: ${err.message}`);
      return false;
    }
  );

  return { status: 'created', date, slug: report.slug, title, articleCount: articles.length, translated };
}

// --- Translation ------------------------------------------------------------

const TRANSLATION_SYSTEM_PROMPT =
  'You are a professional news translator. Translate faithfully into natural, journalistic Modern Greek. ' +
  'Do not add, remove or reinterpret facts. Respond ONLY with valid JSON. No markdown, no code fences.';

const LANGUAGE_NAMES = { el: 'Modern Greek' };

function buildTranslationPrompt(lang, report) {
  const source = {
    title: report.title,
    description: report.description,
    summary: report.summary,
    key_points: JSON.parse(report.key_points),
    sections: JSON.parse(report.sections).map((s) => ({ heading: s.heading, paragraphs: s.paragraphs })),
    keywords: JSON.parse(report.keywords),
    regions: JSON.parse(report.regions || '[]'),
  };
  return `Translate this daily news report JSON into ${LANGUAGE_NAMES[lang]}. Return JSON with exactly the same
structure, keys and array lengths (same number of key_points, sections, paragraphs per section, keywords and
regions, in the same order). Use the standard ${LANGUAGE_NAMES[lang]} names for countries, people and
organisations. Keep "title" 50-70 characters and "description" 140-160 characters.

${JSON.stringify(source)}`;
}

// Translates the stored English report for `date` and upserts it into
// daily_report_translations. Section source citations are copied from the
// English sections by position.
export async function translateReport(env, date, lang = 'el') {
  const db = env.DB;
  const report = await db.prepare('SELECT * FROM daily_reports WHERE report_date = ?').bind(date).first();
  if (!report) throw new Error(`no report for ${date}`);

  const gpt = await callOpenAI(env, buildTranslationPrompt(lang, report), TRANSLATION_SYSTEM_PROMPT);
  const english = JSON.parse(report.sections);
  const translated = Array.isArray(gpt.sections) ? gpt.sections : [];
  if (!gpt.title || translated.length !== english.length) {
    throw new Error(`translation shape mismatch (${translated.length} vs ${english.length} sections)`);
  }

  const sections = english.map((s, i) => {
    const paragraphs = asStrings(translated[i]?.paragraphs);
    return {
      heading: String(translated[i]?.heading ?? '').trim() || s.heading,
      paragraphs: paragraphs.length ? paragraphs : s.paragraphs,
      sources: s.sources,
    };
  });

  const title = String(gpt.title).trim();
  await db
    .prepare(
      `INSERT INTO daily_report_translations
         (report_date, lang, slug, title, description, summary, key_points, sections, keywords, regions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_date, lang) DO UPDATE SET
         slug = excluded.slug, title = excluded.title, description = excluded.description,
         summary = excluded.summary, key_points = excluded.key_points, sections = excluded.sections,
         keywords = excluded.keywords, regions = excluded.regions, updated_at = datetime('now')`
    )
    .bind(
      date,
      lang,
      slugify(title) || date,
      title,
      String(gpt.description ?? '').trim().slice(0, 300),
      String(gpt.summary ?? '').trim(),
      JSON.stringify(asStrings(gpt.key_points)),
      JSON.stringify(sections),
      JSON.stringify(asStrings(gpt.keywords)),
      JSON.stringify(asStrings(gpt.regions))
    )
    .run();
  console.log(`[daily-report] ${date}: ${lang} translation saved ("${title}")`);
}

// Backfills Greek translations missing from recent reports (a failed
// translation, or reports created before translations existed). Bounded
// so one daily run can't turn into dozens of OpenAI calls.
export async function ensureTranslations(env, lang = 'el', limit = 3) {
  const { results } = await env.DB.prepare(
    `SELECT r.report_date FROM daily_reports r
     LEFT JOIN daily_report_translations t ON t.report_date = r.report_date AND t.lang = ?
     WHERE t.report_date IS NULL ORDER BY r.report_date DESC LIMIT ?`
  )
    .bind(lang, limit)
    .all();
  let done = 0;
  for (const { report_date: date } of results) {
    try {
      await translateReport(env, date, lang);
      done += 1;
    } catch (err) {
      console.error(`[daily-report] ${date}: ${lang} backfill failed: ${err.message}`);
    }
  }
  return done;
}

// Push notification to every subscriber when the scheduled report is
// published (not on admin regenerations, to avoid repeat pings).
export async function notifyDailyReport(env, result) {
  const day = new Date(`${result.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const sent = await notifyAll(env, {
    title: `Daily report — ${day}`,
    body: result.title,
    url: `/reports/${result.date}/${result.slug}`,
  });
  console.log(`[daily-report] ${result.date}: notified ${sent} subscribers`);
}
