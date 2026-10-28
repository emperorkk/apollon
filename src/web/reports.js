import { Hono } from 'hono';
import { SITE_NAME, SITE_TAGLINE } from '../lib/constants.js';
import {
  esc,
  layout,
  siteUrl,
  formatLongDate,
  sqliteToIso,
  reportPath,
  organization,
  shareBar,
} from './render.js';

// Public, crawlable pages: daily report archive + individual reports,
// plus sitemap.xml, robots.txt and an RSS feed of the reports.

const app = new Hono();

const PAGE_SIZE = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Edge-cache rendered pages so crawlers and shared-link traffic don't each
// cost D1 reads (the free tier's daily read cap has bitten this project
// before). Reports change at most once a day.
async function cached(c, ttlSeconds, render) {
  const cache = caches.default;
  const key = new Request(c.req.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;

  const res = await render();
  if (res.status === 200) {
    res.headers.set('Cache-Control', `public, max-age=300, s-maxage=${ttlSeconds}`);
    c.executionCtx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function headingId(text, i) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
  return slug || `section-${i + 1}`;
}

function notFoundPage(c) {
  return c.html(
    layout(c, {
      title: 'Report not found',
      description: 'This daily report does not exist.',
      path: c.req.path,
      robots: 'noindex, follow',
      body: `<div class="page"><h1>Report not found</h1><p>There is no daily report at this address. <a href="/reports">Browse all daily reports</a>.</p></div>`,
    }),
    404
  );
}

// --- /reports — archive --------------------------------------------------

app.get('/reports', (c) =>
  cached(c, 3600, async () => {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const db = c.env.DB;

    const [{ results: reports }, total] = await Promise.all([
      db
        .prepare(
          'SELECT report_date, slug, title, description, article_count FROM daily_reports ORDER BY report_date DESC LIMIT ? OFFSET ?'
        )
        .bind(PAGE_SIZE, (page - 1) * PAGE_SIZE)
        .all(),
      db.prepare('SELECT COUNT(*) AS n FROM daily_reports').first(),
    ]);
    const pages = Math.max(1, Math.ceil(total.n / PAGE_SIZE));
    if (page > pages) return notFoundPage(c);

    const base = siteUrl(c);
    const path = page === 1 ? '/reports' : `/reports?page=${page}`;
    const title = page === 1 ? 'Daily World News Reports' : `Daily World News Reports — Page ${page}`;
    const description =
      'Daily AI-written briefings on the most important world news: conflicts, diplomacy, energy, disasters and logistics, summarised from hundreds of sources every day.';

    const prevLink = page > 1 ? `<link rel="prev" href="${base}${page === 2 ? '/reports' : `/reports?page=${page - 1}`}" />` : '';
    const nextLink = page < pages ? `<link rel="next" href="${base}/reports?page=${page + 1}" />` : '';

    const items = reports.length
      ? reports
          .map(
            (r) => `<li class="report-item">
          <a href="${reportPath(r)}">
            <time datetime="${r.report_date}">${esc(formatLongDate(r.report_date))}</time>
            <h2>${esc(r.title)}</h2>
            <p>${esc(r.description)}</p>
            <span class="report-item-meta">${r.article_count} articles analysed</span>
          </a>
        </li>`
          )
          .join('\n')
      : '<li class="report-empty">The first daily report will appear here after the next daily run.</li>';

    const pager =
      pages > 1
        ? `<nav class="pager" aria-label="Pagination">
            ${page > 1 ? `<a rel="prev" href="${page === 2 ? '/reports' : `/reports?page=${page - 1}`}">&larr; Newer</a>` : '<span></span>'}
            <span>Page ${page} of ${pages}</span>
            ${page < pages ? `<a rel="next" href="/reports?page=${page + 1}">Older &rarr;</a>` : '<span></span>'}
          </nav>`
        : '';

    const jsonLd = [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        description,
        url: `${base}${path}`,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${base}/` },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: reports.map((r, i) => ({
            '@type': 'ListItem',
            position: (page - 1) * PAGE_SIZE + i + 1,
            url: `${base}${reportPath(r)}`,
            name: r.title,
          })),
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Daily Reports', item: `${base}/reports` },
        ],
      },
    ];

    return c.html(
      layout(c, {
        title,
        description,
        path,
        jsonLd,
        extraHead: prevLink + nextLink,
        body: `<div class="page">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">Daily reports</span></nav>
      <header class="page-header">
        <p class="eyebrow">${esc(SITE_TAGLINE)}</p>
        <h1>Daily World News Reports</h1>
        <p class="lead">${esc(description)}</p>
      </header>
      <ol class="report-list">${items}</ol>
      ${pager}
    </div>`,
      })
    );
  })
);

// --- /reports/:date[/:slug] — one report ---------------------------------

function renderReport(c) {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return notFoundPage(c);

  return cached(c, 86400, async () => {
    const db = c.env.DB;
    const report = await db.prepare('SELECT * FROM daily_reports WHERE report_date = ?').bind(date).first();
    if (!report) return notFoundPage(c);

    // One canonical URL per report: /reports/:date and wrong slugs redirect.
    const canonicalPath = reportPath(report);
    if (c.req.path !== canonicalPath) return c.redirect(canonicalPath, 301);

    const [prev, next] = await db.batch([
      db
        .prepare('SELECT report_date, slug, title FROM daily_reports WHERE report_date < ? ORDER BY report_date DESC LIMIT 1')
        .bind(date),
      db
        .prepare('SELECT report_date, slug, title FROM daily_reports WHERE report_date > ? ORDER BY report_date ASC LIMIT 1')
        .bind(date),
    ]);
    const prevReport = prev.results[0];
    const nextReport = next.results[0];

    const base = siteUrl(c);
    const url = `${base}${canonicalPath}`;
    const longDate = formatLongDate(date);
    const keyPoints = parseJson(report.key_points, []);
    const sections = parseJson(report.sections, []);
    const keywords = parseJson(report.keywords, []);
    const sources = parseJson(report.sources, []);
    const regions = parseJson(report.regions, []);
    const published = sqliteToIso(report.created_at);
    const modified = sqliteToIso(report.updated_at) || published;
    const sourceOutlets = new Set(sources.map((s) => s.source).filter(Boolean));

    const sectionIds = sections.map((s, i) => headingId(s.heading, i));
    const wordCount = [report.summary, ...keyPoints, ...sections.flatMap((s) => s.paragraphs)]
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length;

    const toc =
      sections.length > 2
        ? `<nav class="toc" aria-label="In this report"><h2>In this report</h2><ol>${sections
            .map((s, i) => `<li><a href="#${sectionIds[i]}">${esc(s.heading)}</a></li>`)
            .join('')}</ol></nav>`
        : '';

    const sectionsHtml = sections
      .map(
        (s, i) => `<section class="report-section" id="${sectionIds[i]}" aria-labelledby="${sectionIds[i]}-h">
        <h2 id="${sectionIds[i]}-h">${esc(s.heading)}</h2>
        ${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}
        ${
          s.sources?.length
            ? `<p class="section-sources">Sources: ${s.sources
                .map((n) => `<a href="#source-${n + 1}" aria-label="Source ${n + 1}">[${n + 1}]</a>`)
                .join(' ')}</p>`
            : ''
        }
      </section>`
      )
      .join('\n');

    const sourcesHtml = sources.length
      ? `<section class="report-sources" aria-labelledby="sources-h">
        <h2 id="sources-h">Sources</h2>
        <ol>${sources
          .map(
            (s, i) =>
              `<li id="source-${i + 1}"><a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${esc(s.title)}</a>${
                s.source ? ` <span class="source-outlet">&mdash; ${esc(s.source)}</span>` : ''
              }</li>`
          )
          .join('')}</ol>
      </section>`
      : '';

    const tags = [...new Set([...regions, ...keywords])];
    const tagsHtml = tags.length
      ? `<ul class="tags" aria-label="Topics covered">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
      : '';

    const adjacent = `<nav class="adjacent" aria-label="More reports">
        ${prevReport ? `<a rel="prev" href="${reportPath(prevReport)}"><span>&larr; Previous day</span>${esc(prevReport.title)}</a>` : '<span></span>'}
        ${nextReport ? `<a rel="next" href="${reportPath(nextReport)}"><span>Next day &rarr;</span>${esc(nextReport.title)}</a>` : '<span></span>'}
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
        image: [`${base}/og-image.png`],
        datePublished: published,
        dateModified: modified,
        author: organization(base),
        publisher: organization(base),
        articleSection: 'Daily Report',
        keywords: tags.join(', '),
        wordCount,
        inLanguage: 'en',
        isAccessibleForFree: true,
        contentLocation: regions.map((name) => ({ '@type': 'Place', name })),
        citation: sources.map((s) => ({ '@type': 'CreativeWork', name: s.title, url: s.url })),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Daily Reports', item: `${base}/reports` },
          { '@type': 'ListItem', position: 3, name: longDate, item: url },
        ],
      },
    ];

    const extraHead = [
      `<meta property="article:published_time" content="${published}" />`,
      `<meta property="article:modified_time" content="${modified}" />`,
      `<meta property="article:section" content="Daily Report" />`,
      ...tags.slice(0, 10).map((t) => `<meta property="article:tag" content="${esc(t)}" />`),
      prevReport ? `<link rel="prev" href="${base}${reportPath(prevReport)}" />` : '',
      nextReport ? `<link rel="next" href="${base}${reportPath(nextReport)}" />` : '',
    ].join('\n  ');

    const body = `<article class="page report">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/reports">Daily reports</a><span aria-hidden="true">/</span><span aria-current="page">${esc(longDate)}</span></nav>
      <header class="page-header">
        <p class="eyebrow">Daily report &middot; <time datetime="${date}">${esc(longDate)}</time></p>
        <h1>${esc(report.title)}</h1>
        <p class="lead">${esc(report.summary)}</p>
        <p class="meta">Based on ${report.article_count} articles${sourceOutlets.size ? ` from ${sourceOutlets.size} outlets` : ''} &middot; Published <time datetime="${published}">${esc(
          new Date(published).toUTCString().replace(' GMT', ' UTC')
        )}</time></p>
        ${shareBar({ url, title: report.title })}
      </header>
      ${
        keyPoints.length
          ? `<section class="key-points" aria-labelledby="key-points-h"><h2 id="key-points-h">Key points</h2><ul>${keyPoints
              .map((k) => `<li>${esc(k)}</li>`)
              .join('')}</ul></section>`
          : ''
      }
      ${toc}
      ${sectionsHtml}
      ${tagsHtml}
      ${sourcesHtml}
      <footer class="report-footer">
        ${shareBar({ url, title: report.title })}
        ${adjacent}
        <p class="cta"><a class="btn" href="/">Open the live intelligence map &rarr;</a></p>
      </footer>
    </article>`;

    return c.html(
      layout(c, {
        title: report.title,
        description: report.description,
        path: canonicalPath,
        ogType: 'article',
        jsonLd,
        extraHead,
        body,
      })
    );
  });
}

app.get('/reports/latest', async (c) => {
  const latest = await c.env.DB.prepare('SELECT report_date, slug FROM daily_reports ORDER BY report_date DESC LIMIT 1').first();
  return latest ? c.redirect(reportPath(latest), 302) : c.redirect('/reports', 302);
});

// --- RSS ------------------------------------------------------------------

app.get('/reports/rss.xml', (c) =>
  cached(c, 3600, async () => {
    const base = siteUrl(c);
    const { results } = await c.env.DB.prepare(
      'SELECT report_date, slug, title, description, summary, created_at FROM daily_reports ORDER BY report_date DESC LIMIT 30'
    ).all();

    const items = results
      .map(
        (r) => `    <item>
      <title>${esc(r.title)}</title>
      <link>${base}${reportPath(r)}</link>
      <guid isPermaLink="true">${base}${reportPath(r)}</guid>
      <pubDate>${new Date(sqliteToIso(r.created_at)).toUTCString()}</pubDate>
      <description>${esc(r.summary || r.description)}</description>
    </item>`
      )
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)} — Daily World News Reports</title>
    <link>${base}/reports</link>
    <atom:link href="${base}/reports/rss.xml" rel="self" type="application/rss+xml" />
    <description>Daily AI-written briefings on the most important world news.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;
    return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
  })
);

app.get('/reports/:date{\\d{4}-\\d{2}-\\d{2}}', renderReport);
app.get('/reports/:date{\\d{4}-\\d{2}-\\d{2}}/:slug', renderReport);

// --- sitemap / robots -----------------------------------------------------

app.get('/sitemap.xml', (c) =>
  cached(c, 3600, async () => {
    const base = siteUrl(c);
    const { results } = await c.env.DB.prepare(
      'SELECT report_date, slug, updated_at FROM daily_reports ORDER BY report_date DESC LIMIT 45000'
    ).all();

    const urls = [
      { loc: `${base}/`, changefreq: 'hourly', priority: '1.0' },
      { loc: `${base}/reports`, changefreq: 'daily', priority: '0.9', lastmod: sqliteToIso(results[0]?.updated_at) },
      ...results.map((r) => ({
        loc: `${base}${reportPath(r)}`,
        lastmod: sqliteToIso(r.updated_at),
        changefreq: 'monthly',
        priority: '0.8',
      })),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
  )
  .join('\n')}
</urlset>`;
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
  })
);

app.get('/robots.txt', (c) =>
  c.text(
    `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /admin.html

Sitemap: ${siteUrl(c)}/sitemap.xml
`,
    200,
    { 'Cache-Control': 'public, max-age=86400' }
  )
);

export default app;
