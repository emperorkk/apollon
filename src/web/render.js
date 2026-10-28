import { SITE_NAME, SITE_TAGLINE } from '../lib/constants.js';
import { t } from './i18n.js';

// Server-rendered HTML for the public, indexable pages (daily reports).
// The dashboard itself is a client-rendered SPA that crawlers see as an
// empty shell; these pages are where the site's search-visible content
// lives, so everything here is plain HTML that works without JS. Every
// page exists in English and Greek (see i18n.js).

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

// `date` is a report day (YYYY-MM-DD, an Athens calendar day) — a label,
// not an instant, so it's formatted as-is rather than converted.
export function formatLongDate(date, lang = 'en') {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(t(lang).locale, {
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

export function reportPath(report, lang = 'en') {
  return `${t(lang).pathPrefix}/reports/${report.report_date}/${report.slug}`;
}

export function archivePath(lang = 'en') {
  return `${t(lang).pathPrefix}/reports`;
}

export function rssPath(lang = 'en') {
  return `${t(lang).pathPrefix}/reports/rss.xml`;
}

export function organization(base) {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${base}/`,
    logo: { '@type': 'ImageObject', url: `${base}/icons/icon-512.png`, width: 512, height: 512 },
  };
}

export function shareBar({ url, title, lang = 'en' }) {
  const s = t(lang);
  const u = encodeURIComponent(url);
  const ti = encodeURIComponent(title);
  const links = [
    ['X', `https://twitter.com/intent/tweet?url=${u}&text=${ti}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ['WhatsApp', `https://wa.me/?text=${ti}%20${u}`],
    ['Telegram', `https://t.me/share/url?url=${u}&text=${ti}`],
    ['Reddit', `https://www.reddit.com/submit?url=${u}&title=${ti}`],
    ['Email', `mailto:?subject=${ti}&body=${ti}%0A%0A${u}`],
  ];
  return `<div class="share" data-share-url="${esc(url)}" data-share-title="${esc(title)}" data-copied="${lang === 'el' ? 'Αντιγράφηκε!' : 'Copied!'}">
    <span class="share-label">${s.share}</span>
    <button type="button" class="share-btn share-native" hidden>${s.shareNative}</button>
    ${links
      .map(
        ([name, href]) =>
          `<a class="share-btn" href="${esc(href)}" target="_blank" rel="noopener nofollow" aria-label="${esc(s.shareOn(name))}">${name}</a>`,
      )
      .join('')}
    <button type="button" class="share-btn share-copy">${s.copyLink}</button>
  </div>`;
}

// alternates: { en: path, el: path } for hreflang + the language switcher.
// image: absolute URL of the page's Open Graph image (defaults to the site's).
export function layout(
  c,
  {
    title,
    description,
    path,
    lang = 'en',
    alternates = null,
    image = null,
    imageAlt = null,
    ogType = 'website',
    robots = 'index, follow, max-image-preview:large',
    jsonLd = [],
    extraHead = '',
    body,
  },
) {
  const s = t(lang);
  const base = siteUrl(c);
  const canonical = `${base}${path}`;
  const ogImage = image || `${base}/og-image.png`;
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  const hreflang = alternates
    ? [
        ...Object.entries(alternates).map(
          ([l, p]) => `<link rel="alternate" hreflang="${t(l).htmlLang}" href="${esc(base + p)}" />`,
        ),
        alternates.en ? `<link rel="alternate" hreflang="x-default" href="${esc(base + alternates.en)}" />` : '',
        ...Object.keys(alternates)
          .filter((l) => l !== lang)
          .map((l) => `<meta property="og:locale:alternate" content="${t(l).ogLocale}" />`),
      ].join('\n  ')
    : '';
  const switchPath = alternates?.[s.switchLang];

  return `<!doctype html>
<html lang="${s.htmlLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="${robots}" />
  <link rel="canonical" href="${esc(canonical)}" />
  ${hreflang}
  <meta name="theme-color" content="#04070a" />
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
  <link rel="apple-touch-icon" href="/icons/icon-192.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)} — ${esc(s.rssTitle)}" href="${base}${rssPath(lang)}" />

  <meta property="og:site_name" content="${esc(SITE_NAME)}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(imageAlt || `${SITE_NAME} — ${SITE_TAGLINE}`)}" />
  <meta property="og:locale" content="${s.ogLocale}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(ogImage)}" />
  ${extraHead}
  <link rel="stylesheet" href="/css/report.css" />
  ${jsonLd.map(jsonLdScript).join('\n  ')}
</head>
<body>
  <a class="skip-link" href="#content">${s.skip}</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="${esc(SITE_NAME)}">
      <span class="brand-mark" aria-hidden="true">&#9670;</span>
      <span class="brand-name">${esc(SITE_NAME.toUpperCase())}</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <a href="/">${s.navMap}</a>
      <a href="${archivePath(lang)}">${s.navReports}</a>
      <a class="nav-rss" href="${rssPath(lang)}">${s.navRss}</a>
      ${switchPath ? `<a class="lang-switch" href="${esc(switchPath)}" hreflang="${s.switchLang}" lang="${s.switchLang}">${s.switchLabel}</a>` : ''}
    </nav>
  </header>
  <main id="content">
${body}
  </main>
  <footer class="site-footer">
    <p>${esc(SITE_NAME)} ${s.footer}</p>
    <p><a href="/">${s.footerLinks[0]}</a> &middot; <a href="${archivePath(lang)}">${s.footerLinks[1]}</a> &middot; <a href="${rssPath(lang)}">${s.footerLinks[2]}</a></p>
  </footer>
  <script src="/js/share.js" defer></script>
</body>
</html>`;
}
