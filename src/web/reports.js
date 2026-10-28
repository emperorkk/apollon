import { Hono } from 'hono';
import { SITE_NAME, SITE_TAGLINE } from '../lib/constants.js';
import { formatAthensDateTime } from '../lib/time.js';
import { MACRO_REGIONS, macroRegion, macroRegionsFor, macroRegionShortName } from '../lib/regions.js';
import {
  esc,
  layout,
  siteUrl,
  formatLongDate,
  sqliteToIso,
  reportPath,
  archivePath,
  rssPath,
  organization,
  shareBar,
} from './render.js';
import { LANGS, t } from './i18n.js';
import { renderReportImage } from '../og/report-image.js';

// Public, crawlable pages, each in English (/reports/...) and Greek
// (/el/reports/...): the report archive, individual reports, the four
// macro-region hubs, and RSS — plus /sitemap.xml and /robots.txt.
//
// Caching: these pages get long edge TTLs from src/lib/cache-policy.js and
// are served by Workers Caching without running this code, so crawlers and
// shared-link traffic barely touch D1.

const app = new Hono();

const PAGE_SIZE = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INDEX_SCAN_LIMIT = 400; // reports scanned for region hubs (~13 months)

function parseJson(value, fallback) {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function headingId(text, i) {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9Ͱ-Ͽ]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
  return slug || `section-${i + 1}`;
}

export function ogImagePath(date, lang = 'en') {
  return `${t(lang).pathPrefix}/reports/${date}/og.png`;
}

function regionPath(slug, lang = 'en') {
  return `${t(lang).pathPrefix}/reports/region/${slug}`;
}

// --- Data access ------------------------------------------------------------
// English rows live in daily_reports; other languages in
// daily_report_translations, joined to daily_reports for the
// language-neutral fields (sources, article_count, regions for hubs).

const LIST_COLUMNS = {
  en: `r.report_date, r.slug, r.title, r.description, r.article_count, r.regions, r.macro_regions,
       r.created_at, r.updated_at, t.slug AS alt_slug`,
  el: `t.report_date, t.slug, t.title, t.description, r.article_count, r.regions, r.macro_regions,
       t.created_at, t.updated_at, r.slug AS alt_slug`,
};

function listQuery(lang, tail) {
  return lang === 'en'
    ? `SELECT ${LIST_COLUMNS.en} FROM daily_reports r
       LEFT JOIN daily_report_translations t ON t.report_date = r.report_date AND t.lang = 'el' ${tail}`
    : `SELECT ${LIST_COLUMNS.el} FROM daily_report_translations t
       JOIN daily_reports r ON r.report_date = t.report_date WHERE t.lang = 'el' ${tail}`;
}

function listReports(db, lang, limit, offset = 0) {
  return db
    .prepare(listQuery(lang, 'ORDER BY 1 DESC LIMIT ? OFFSET ?'))
    .bind(limit, offset)
    .all()
    .then((r) => r.results);
}

function countReports(db, lang) {
  return db
    .prepare(
      lang === 'en'
        ? 'SELECT COUNT(*) AS n FROM daily_reports'
        : "SELECT COUNT(*) AS n FROM daily_report_translations WHERE lang = 'el'",
    )
    .first()
    .then((r) => r.n);
}

async function loadReport(db, date, lang) {
  const row =
    lang === 'en'
      ? await db
          .prepare(
            `SELECT r.*, t.slug AS alt_slug FROM daily_reports r
             LEFT JOIN daily_report_translations t ON t.report_date = r.report_date AND t.lang = 'el'
             WHERE r.report_date = ?`,
          )
          .bind(date)
          .first()
      : await db
          .prepare(
            `SELECT t.*, r.sources, r.article_count, r.macro_regions, r.regions AS en_regions, r.slug AS alt_slug
             FROM daily_report_translations t JOIN daily_reports r ON r.report_date = t.report_date
             WHERE t.report_date = ? AND t.lang = ?`,
          )
          .bind(date, lang)
          .first();
  return row ?? null;
}

async function adjacentReports(db, date, lang) {
  const q = (cmp, dir) =>
    lang === 'en'
      ? db
          .prepare(
            `SELECT report_date, slug, title FROM daily_reports WHERE report_date ${cmp} ? ORDER BY report_date ${dir} LIMIT 1`,
          )
          .bind(date)
      : db
          .prepare(
            `SELECT report_date, slug, title FROM daily_report_translations
             WHERE lang = ? AND report_date ${cmp} ? ORDER BY report_date ${dir} LIMIT 1`,
          )
          .bind(lang, date);
  const [prev, next] = await db.batch([q('<', 'DESC'), q('>', 'ASC')]);
  return [prev.results[0], next.results[0]];
}

// Paths of a report in every language it exists in.
function alternatesFor(row, lang) {
  const own = { report_date: row.report_date, slug: row.slug };
  const other = row.alt_slug ? { report_date: row.report_date, slug: row.alt_slug } : null;
  const otherLang = lang === 'en' ? 'el' : 'en';
  return {
    [lang]: reportPath(own, lang),
    ...(other ? { [otherLang]: reportPath(other, otherLang) } : {}),
  };
}

function reportMacroRegions(row) {
  return macroRegionsFor(parseJson(row.en_regions ?? row.regions, []), parseJson(row.macro_regions, []));
}

// --- Shared fragments ---------------------------------------------------------

function notFoundPage(c, lang = 'en') {
  const s = t(lang);
  return c.html(
    layout(c, {
      title: s.notFoundTitle,
      description: s.notFoundBody,
      path: c.req.path,
      lang,
      robots: 'noindex, follow',
      body: `<div class="page"><h1>${s.notFoundTitle}</h1><p>${s.notFoundBody} <a href="${archivePath(lang)}">${s.browseAll}</a>.</p></div>`,
    }),
    404,
  );
}

function reportListItems(reports, lang) {
  const s = t(lang);
  return reports
    .map(
      (r) => `<li class="report-item">
          <a href="${reportPath(r, lang)}">
            <time datetime="${r.report_date}">${esc(formatLongDate(r.report_date, lang))}</time>
            <h2>${esc(r.title)}</h2>
            <p>${esc(r.description)}</p>
            <span class="report-item-meta">${s.analysed(r.article_count)}</span>
          </a>
        </li>`,
    )
    .join('\n');
}

function regionChips(lang, { counts = null, only = null, exclude = null, heading = null } = {}) {
  const items = MACRO_REGIONS.filter((r) => r.slug !== exclude && (!only || only.includes(r.slug)));
  return `<nav class="region-nav" aria-label="${lang === 'el' ? 'Περιοχές' : 'Regions'}"><h2>${
    heading ?? (lang === 'el' ? 'Ανά περιοχή' : 'Browse by region')
  }</h2><ul class="tags tags-links">${items
    .map(
      (r) =>
        `<li><a href="${regionPath(r.slug, lang)}">${esc(r.name[lang])}${
          counts ? ` <span>${counts.get(r.slug) ?? 0}</span>` : ''
        }</a></li>`,
    )
    .join('')}</ul></nav>`;
}

function breadcrumbs(lang, items) {
  const s = t(lang);
  const parts = [`<a href="/">${s.home}</a>`];
  items.forEach(([label, href], i) => {
    parts.push(
      i === items.length - 1 ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`,
    );
  });
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${parts.join('<span aria-hidden="true">/</span>')}</nav>`;
}

function breadcrumbLd(base, lang, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [[SITE_NAME, '/'], ...items].map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: `${base}${path}`,
    })),
  };
}

// --- Archive ----------------------------------------------------------------

async function renderArchive(c, lang) {
  const s = t(lang);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const db = c.env.DB;

  const [reports, total, indexRows] = await Promise.all([
    listReports(db, lang, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    countReports(db, lang),
    page === 1 ? listReports(db, lang, INDEX_SCAN_LIMIT) : Promise.resolve([]),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pages) return notFoundPage(c, lang);

  const base = siteUrl(c);
  const root = archivePath(lang);
  const pageUrl = (n) => (n === 1 ? root : `${root}?page=${n}`);
  const path = pageUrl(page);
  const title = page === 1 ? s.archiveTitle : s.archivePage(page);

  const counts = new Map();
  for (const r of indexRows) for (const slug of reportMacroRegions(r)) counts.set(slug, (counts.get(slug) ?? 0) + 1);

  const pager =
    pages > 1
      ? `<nav class="pager" aria-label="Pagination">
          ${page > 1 ? `<a rel="prev" href="${pageUrl(page - 1)}">${s.newer}</a>` : '<span></span>'}
          <span>${s.pageOf(page, pages)}</span>
          ${page < pages ? `<a rel="next" href="${pageUrl(page + 1)}">${s.older}</a>` : '<span></span>'}
        </nav>`
      : '';

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description: s.archiveDescription,
      url: `${base}${path}`,
      inLanguage: s.htmlLang,
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${base}/` },
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: reports.map((r, i) => ({
          '@type': 'ListItem',
          position: (page - 1) * PAGE_SIZE + i + 1,
          url: `${base}${reportPath(r, lang)}`,
          name: r.title,
        })),
      },
    },
    breadcrumbLd(base, lang, [[s.reportsSchema, root]]),
  ];

  return c.html(
    layout(c, {
      title,
      description: s.archiveDescription,
      path,
      lang,
      alternates: page === 1 ? { en: archivePath('en'), el: archivePath('el') } : null,
      jsonLd,
      extraHead:
        (page > 1 ? `<link rel="prev" href="${base}${pageUrl(page - 1)}" />` : '') +
        (page < pages ? `<link rel="next" href="${base}${pageUrl(page + 1)}" />` : ''),
      body: `<div class="page">
      ${breadcrumbs(lang, [[s.reports, root]])}
      <header class="page-header">
        <p class="eyebrow">${esc(SITE_TAGLINE)}</p>
        <h1>${s.archiveTitle}</h1>
        <p class="lead">${esc(s.archiveDescription)}</p>
      </header>
      ${page === 1 ? regionChips(lang, { counts }) : ''}
      <ol class="report-list">${reports.length ? reportListItems(reports, lang) : `<li class="report-empty">${s.empty}</li>`}</ol>
      ${pager}
    </div>`,
    }),
  );
}

// --- One report ---------------------------------------------------------------

async function renderReport(c, lang) {
  const s = t(lang);
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return notFoundPage(c, lang);

  const db = c.env.DB;
  const report = await loadReport(db, date, lang);
  if (!report) return notFoundPage(c, lang);

  // One canonical URL per report and language: bare dates and stale slugs
  // redirect to it.
  const canonicalPath = reportPath(report, lang);
  if (c.req.path !== canonicalPath) return c.redirect(canonicalPath, 301);

  const [prevReport, nextReport] = await adjacentReports(db, date, lang);

  const base = siteUrl(c);
  const url = `${base}${canonicalPath}`;
  const longDate = formatLongDate(date, lang);
  const keyPoints = parseJson(report.key_points, []);
  const sections = parseJson(report.sections, []);
  const keywords = parseJson(report.keywords, []);
  const sources = parseJson(report.sources, []);
  const regions = parseJson(report.regions, []);
  const macro = reportMacroRegions(report);
  const published = sqliteToIso(report.created_at);
  const modified = sqliteToIso(report.updated_at) || published;
  const sourceOutlets = new Set(sources.map((src) => src.source).filter(Boolean));
  const image = `${base}${ogImagePath(date, lang)}`;
  const alternates = alternatesFor(report, lang);

  const sectionIds = sections.map((sec, i) => headingId(sec.heading, i));
  const wordCount = [report.summary, ...keyPoints, ...sections.flatMap((sec) => sec.paragraphs)]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

  const toc =
    sections.length > 2
      ? `<nav class="toc" aria-label="${s.inThisReport}"><h2>${s.inThisReport}</h2><ol>${sections
          .map((sec, i) => `<li><a href="#${sectionIds[i]}">${esc(sec.heading)}</a></li>`)
          .join('')}</ol></nav>`
      : '';

  const sectionsHtml = sections
    .map(
      (sec, i) => `<section class="report-section" id="${sectionIds[i]}" aria-labelledby="${sectionIds[i]}-h">
      <h2 id="${sectionIds[i]}-h">${esc(sec.heading)}</h2>
      ${sec.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
      ${
        sec.sources?.length
          ? `<p class="section-sources">${s.sources}: ${sec.sources
              .map((n) => `<a href="#source-${n + 1}" aria-label="${s.sourceN(n + 1)}">[${n + 1}]</a>`)
              .join(' ')}</p>`
          : ''
      }
    </section>`,
    )
    .join('\n');

  const sourcesHtml = sources.length
    ? `<section class="report-sources" aria-labelledby="sources-h">
      <h2 id="sources-h">${s.sources}</h2>
      <ol>${sources
        .map(
          (src, i) =>
            `<li id="source-${i + 1}"><a href="${esc(src.url)}" target="_blank" rel="noopener nofollow">${esc(src.title)}</a>${
              src.source ? ` <span class="source-outlet">&mdash; ${esc(src.source)}</span>` : ''
            }</li>`,
        )
        .join('')}</ol>
    </section>`
    : '';

  const tags = [...new Set([...regions, ...keywords])];
  const tagsHtml = tags.length
    ? `<ul class="tags" aria-label="${s.topicsCovered}">${tags.map((tag) => `<li>${esc(tag)}</li>`).join('')}</ul>`
    : '';
  const regionLinks = macro.length
    ? regionChips(lang, { only: macro, heading: lang === 'el' ? 'Περιοχές' : 'Regions' })
    : '';

  const adjacent = `<nav class="adjacent" aria-label="${s.moreReports}">
      ${prevReport ? `<a rel="prev" href="${reportPath(prevReport, lang)}"><span>${s.previousDay}</span>${esc(prevReport.title)}</a>` : '<span></span>'}
      ${nextReport ? `<a rel="next" href="${reportPath(nextReport, lang)}"><span>${s.nextDay}</span>${esc(nextReport.title)}</a>` : '<span></span>'}
    </nav>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: report.title.slice(0, 110),
      description: report.description,
      abstract: report.summary,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      image: [image, `${base}/og-image.png`],
      datePublished: published,
      dateModified: modified,
      author: organization(base),
      publisher: organization(base),
      articleSection: s.dailyReport,
      keywords: tags.join(', '),
      wordCount,
      inLanguage: s.htmlLang,
      isAccessibleForFree: true,
      ...(lang !== 'en' && alternates.en
        ? { translationOfWork: { '@type': 'NewsArticle', url: `${base}${alternates.en}`, inLanguage: 'en' } }
        : {}),
      contentLocation: regions.map((name) => ({ '@type': 'Place', name })),
      citation: sources.map((src) => ({ '@type': 'CreativeWork', name: src.title, url: src.url })),
    },
    breadcrumbLd(base, lang, [
      [s.reportsSchema, archivePath(lang)],
      [longDate, canonicalPath],
    ]),
  ];

  const extraHead = [
    `<meta property="article:published_time" content="${published}" />`,
    `<meta property="article:modified_time" content="${modified}" />`,
    `<meta property="article:section" content="${esc(s.dailyReport)}" />`,
    ...tags.slice(0, 10).map((tag) => `<meta property="article:tag" content="${esc(tag)}" />`),
    prevReport ? `<link rel="prev" href="${base}${reportPath(prevReport, lang)}" />` : '',
    nextReport ? `<link rel="next" href="${base}${reportPath(nextReport, lang)}" />` : '',
  ].join('\n  ');

  const body = `<article class="page report">
    ${breadcrumbs(lang, [
      [s.reports, archivePath(lang)],
      [longDate, canonicalPath],
    ])}
    <header class="page-header">
      <p class="eyebrow">${s.dailyReport} &middot; <time datetime="${date}">${esc(longDate)}</time></p>
      <h1>${esc(report.title)}</h1>
      <p class="lead">${esc(report.summary)}</p>
      <p class="meta">${s.basedOn(report.article_count, sourceOutlets.size)} &middot; ${s.published} <time datetime="${published}">${esc(
        formatAthensDateTime(published, s.locale),
      )}</time> (${s.athensTime})${s.translatedNote ? `<br />${s.translatedNote}` : ''}</p>
      ${shareBar({ url, title: report.title, lang })}
    </header>
    ${
      keyPoints.length
        ? `<section class="key-points" aria-labelledby="key-points-h"><h2 id="key-points-h">${s.keyPoints}</h2><ul>${keyPoints
            .map((k) => `<li>${esc(k)}</li>`)
            .join('')}</ul></section>`
        : ''
    }
    ${toc}
    ${sectionsHtml}
    ${regionLinks}
    ${tagsHtml}
    ${sourcesHtml}
    <footer class="report-footer">
      ${shareBar({ url, title: report.title, lang })}
      ${adjacent}
      <p class="cta"><a class="btn" href="/">${s.cta}</a></p>
    </footer>
  </article>`;

  return c.html(
    layout(c, {
      title: report.title,
      description: report.description,
      path: canonicalPath,
      lang,
      alternates,
      image,
      imageAlt: report.title,
      ogType: 'article',
      jsonLd,
      extraHead,
      body,
    }),
  );
}

// --- Macro-region hubs ----------------------------------------------------------

async function renderRegion(c, lang) {
  const s = t(lang);
  const region = macroRegion(c.req.param('region'));
  if (!region) return notFoundPage(c, lang);

  const db = c.env.DB;
  const rows = await listReports(db, lang, INDEX_SCAN_LIMIT);
  const reports = rows.filter((r) => reportMacroRegions(r).includes(region.slug));

  const base = siteUrl(c);
  const path = regionPath(region.slug, lang);
  const name = region.name[lang];
  const title = lang === 'el' ? `${name}: ειδήσεις και ημερήσιες αναφορές` : `${name} News: Daily Reports`;
  const description = region.description[lang];

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${base}${path}`,
      inLanguage: s.htmlLang,
      about: { '@type': 'Place', name: region.name.en },
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${base}/` },
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: reports.slice(0, 50).map((r, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${base}${reportPath(r, lang)}`,
          name: r.title,
        })),
      },
    },
    breadcrumbLd(base, lang, [
      [s.reportsSchema, archivePath(lang)],
      [name, path],
    ]),
  ];

  return c.html(
    layout(c, {
      title,
      description,
      path,
      lang,
      alternates: { en: regionPath(region.slug, 'en'), el: regionPath(region.slug, 'el') },
      jsonLd,
      body: `<div class="page">
      ${breadcrumbs(lang, [
        [s.reports, archivePath(lang)],
        [name, path],
      ])}
      <header class="page-header">
        <p class="eyebrow">${lang === 'el' ? 'Περιοχή' : 'Region'} &middot; ${reports.length}</p>
        <h1>${esc(title)}</h1>
        <p class="lead">${esc(description)}</p>
      </header>
      <ol class="report-list">${reports.length ? reportListItems(reports, lang) : `<li class="report-empty">${s.empty}</li>`}</ol>
      ${regionChips(lang, { exclude: region.slug, heading: lang === 'el' ? 'Άλλες περιοχές' : 'Other regions' })}
    </div>`,
    }),
  );
}

// --- Open Graph image ---------------------------------------------------------

async function renderOgImage(c, lang) {
  const date = c.req.param('date');
  const report = await loadReport(c.env.DB, date, lang);
  if (!report) return c.text('Not found', 404);

  const s = t(lang);
  const png = await renderReportImage({
    eyebrow: `${s.dailyReport} · ${formatLongDate(date, lang)}`,
    title: report.title,
    tags: reportMacroRegions(report).map((slug) => macroRegionShortName(macroRegion(slug), lang)),
    domain: new URL(siteUrl(c)).host,
    lang,
  });
  return c.body(png, 200, { 'Content-Type': 'image/png' });
}

// --- RSS ------------------------------------------------------------------------

async function renderRss(c, lang) {
  const s = t(lang);
  const base = siteUrl(c);
  const rows = await listReports(c.env.DB, lang, 30);

  const items = rows
    .map(
      (r) => `    <item>
      <title>${esc(r.title)}</title>
      <link>${base}${reportPath(r, lang)}</link>
      <guid isPermaLink="true">${base}${reportPath(r, lang)}</guid>
      <pubDate>${new Date(sqliteToIso(r.created_at)).toUTCString()}</pubDate>
      <description>${esc(r.description)}</description>
    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)} — ${esc(s.rssTitle)}</title>
    <link>${base}${archivePath(lang)}</link>
    <atom:link href="${base}${rssPath(lang)}" rel="self" type="application/rss+xml" />
    <description>${esc(s.rssDescription)}</description>
    <language>${s.htmlLang}</language>
${items}
  </channel>
</rss>`;
  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
}

// --- Routes (both languages) ------------------------------------------------------

for (const lang of LANGS) {
  const prefix = t(lang).pathPrefix;
  app.get(`${prefix}/reports`, (c) => renderArchive(c, lang));
  app.get(`${prefix}/reports/rss.xml`, (c) => renderRss(c, lang));
  app.get(`${prefix}/reports/latest`, async (c) => {
    const [latest] = await listReports(c.env.DB, lang, 1);
    return c.redirect(latest ? reportPath(latest, lang) : archivePath(lang), 302);
  });
  app.get(`${prefix}/reports/region/:region`, (c) => renderRegion(c, lang));
  app.get(`${prefix}/reports/:date{\\d{4}-\\d{2}-\\d{2}}/og.png`, (c) => renderOgImage(c, lang));
  app.get(`${prefix}/reports/:date{\\d{4}-\\d{2}-\\d{2}}`, (c) => renderReport(c, lang));
  app.get(`${prefix}/reports/:date{\\d{4}-\\d{2}-\\d{2}}/:slug`, (c) => renderReport(c, lang));
}

// --- sitemap / robots ---------------------------------------------------------------

app.get('/sitemap.xml', async (c) => {
  const base = siteUrl(c);
  const db = c.env.DB;
  // English rows carry the Greek slug (alt_slug) when a translation exists.
  const en = await listReports(db, 'en', 45000);
  const latest = sqliteToIso(en[0]?.updated_at);

  const pair = (enPath, elPath) => ({ en: enPath, ...(elPath ? { el: elPath } : {}) });
  const entries = [
    { paths: { en: '/' }, changefreq: 'hourly', priority: '1.0' },
    { paths: pair(archivePath('en'), archivePath('el')), changefreq: 'daily', priority: '0.9', lastmod: latest },
    ...MACRO_REGIONS.map((r) => ({
      paths: pair(regionPath(r.slug, 'en'), regionPath(r.slug, 'el')),
      changefreq: 'daily',
      priority: '0.8',
      lastmod: latest,
    })),
    ...en.map((r) => ({
      paths: pair(reportPath(r, 'en'), r.alt_slug ? reportPath({ ...r, slug: r.alt_slug }, 'el') : null),
      changefreq: 'monthly',
      priority: '0.7',
      lastmod: sqliteToIso(r.updated_at),
    })),
  ];

  // Each language version gets its own <url>, listing all versions as
  // xhtml:link alternates (Google's sitemap hreflang format).
  const urls = entries.flatMap((e) =>
    Object.entries(e.paths).map(([, path]) => {
      const alternates = Object.entries(e.paths)
        .map(([l, p]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(base + p)}"/>`)
        .join('');
      return `  <url><loc>${esc(base + path)}</loc>${alternates}${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`;
    }),
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

app.get('/robots.txt', (c) =>
  c.text(
    `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /admin.html

Sitemap: ${siteUrl(c)}/sitemap.xml
`,
  ),
);

export default app;
