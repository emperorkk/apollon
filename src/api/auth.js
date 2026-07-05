import { Hono } from 'hono';
import { signJWT } from '../lib/auth.js';
import { upsertUser } from '../lib/db.js';

const app = new Hono();

// POST /api/auth/google — verify a Google ID token (GSI) and return a signed
// session JWT. Verification is delegated to Google's tokeninfo endpoint,
// which validates the RS256 signature and expiry server-side.
app.post('/google', async (c) => {
  const { id_token: idToken } = await c.req.json();
  if (!idToken) return c.json({ error: 'Missing id_token' }, 400);

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) return c.json({ error: 'Invalid Google token' }, 401);

  const claims = await res.json();
  if (claims.aud !== c.env.GOOGLE_CLIENT_ID) {
    return c.json({ error: 'Invalid audience' }, 401);
  }

  const email = claims.email;
  const sub = claims.sub;
  const displayName = claims.name ?? null;

  await upsertUser(c.env.DB, { email, googleSub: sub, displayName });

  const token = await signJWT({ email, sub }, c.env.JWT_SECRET);
  return c.json({ token });
});

export default app;
