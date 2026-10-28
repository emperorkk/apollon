import { SITE_NAME, SITE_TAGLINE } from '../lib/constants.js';

// Server-rendered HTML for the public, indexable pages (daily reports).
// The dashboard itself is a client-rendered SPA that crawlers see as an
// empty shell; these pages are where the site's search-visible content
// lives, so everything here is plain HTML that works without JS.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON-LD goes inside <script>; escaping '<' keeps a stray "</script>" in
// report text from closing the tag early.
function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// SITE_URL (wrangler.toml [vars]) pins canonical URLs to the production
// domain; falls back to the request's own origin for local dev/previews.
export function siteUrl(c) {
  return (c.env.SITE_URL || new URL(c.req.url).origin).replace(/\/$/, '');
}

export function formatLongDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function sqliteToIso(value) {
  return value ? `${value.replace(' ', 'T')}Z` : null;
}

export function reportPath(report) {
  return `/reports/${report.report_date}/${report.slug}`;
}

export function organization(base) {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${base}/`,
    logo: { '@type': 'ImageObject', url: `${base}/icons/icon-512.png`, width: 512, height: 512 },
  };
}

export function shareBar({ url, title }) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    ['X', `https://twitter.com/intent/tweet?url=${u}&text=${t}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ['WhatsApp', `https://wa.me/?text=${t}%20${u}`],
    ['Telegram', `https://t.me/share/url?url=${u}&text=${t}`],
    ['Reddit', `https://www.reddit.com/submit?url=${u}&title=${t}`],
    ['Email', `mailto:?subject=${t}&body=${t}%0A%0A${u}`],
  ];
  return `<div class="share" data-share-url="${esc(url)}" data-share-title="${esc(title)}">
    <span class="share-label">Share</span>
    <button type="button" class="share-btn share-native" hidden>Share&hellip;</button>
    ${links
      .map(
        ([name, href]) =>
          `<a class="share-btn" href="${esc(href)}" target="_blank" rel="noopener nofollow" aria-label="Share on ${name}">${name}</a>`
      )
      .join('')}
    <button type="button" class="share-btn share-copy">Copy link</button>
  </div>`;
}

export function layout(c, { title, description, path, ogType = 'website', robots = 'index, follow, max-image-preview:large', jsonLd = [], extraHead = '', body }) {
  const base = siteUrl(c);
  const canonical = `${base}${path}`;
  const image = `${base}/og-image.png`;
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="${robots}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta name="theme-color" content="#04070a" />
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
  <link rel="apple-touch-icon" href="/icons/icon-192.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)} Daily Reports" href="${base}/reports/rss.xml" />

  <meta property="og:site_name" content="${esc(SITE_NAME)}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(SITE_NAME)} — ${esc(SITE_TAGLINE)}" />
  <meta property="og:locale" content="en_GB" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${image}" />
  ${extraHead}
  <link rel="stylesheet" href="/css/report.css" />
  ${jsonLd.map(jsonLdScript).join('\n  ')}
</head>
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="${esc(SITE_NAME)} home">
      <span class="brand-mark" aria-hidden="true">&#9670;</span>
      <span class="brand-name">${esc(SITE_NAME.toUpperCase())}</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <a href="/">Live map</a>
      <a href="/reports">Daily reports</a>
      <a href="/reports/rss.xml">RSS</a>
    </nav>
  </header>
  <main id="content">
${body}
  </main>
  <footer class="site-footer">
    <p>${esc(SITE_NAME)} is an independent news aggregation service with no affiliation to the sources it cites. Reports are written by an AI model from publicly available RSS headlines and summaries &mdash; always check the original sources.</p>
    <p><a href="/">Live intelligence map</a> &middot; <a href="/reports">All daily reports</a> &middot; <a href="/reports/rss.xml">RSS feed</a></p>
  </footer>
  <script src="/js/share.js" defer></script>
</body>
</html>`;
}
