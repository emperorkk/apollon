// Baseline security headers for every Worker response (static assets get
// the same set from frontend/_headers). No Content-Security-Policy yet: the
// site loads Google sign-in, Google Analytics, esm.sh modules and OSM
// tiles, and a CSP strict enough to matter needs testing against all of
// them first.
const HEADERS = {
  // No includeSubDomains: other talosat.work subdomains aren't ours to pin.
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  // allow-popups: Google sign-in opens a popup that must post back.
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export function securityHeadersMiddleware() {
  return async (c, next) => {
    await next();
    // Re-wrapped: responses from bindings (ASSETS) have immutable headers.
    const res = new Response(c.res.body, c.res);
    for (const [name, value] of Object.entries(HEADERS)) res.headers.set(name, value);
    // See cache-policy.js: clear first so Hono doesn't copy old headers back.
    c.res = undefined;
    c.res = res;
  };
}
