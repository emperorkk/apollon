import { Hono } from 'hono';
import { requireAuth } from '../lib/auth.js';

const app = new Hono();

// POST /api/push/subscribe — save a push subscription for the authenticated user
app.post('/subscribe', requireAuth, async (c) => {
  const { endpoint, keys } = await c.req.json();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return c.json({ error: 'Missing subscription fields' }, 400);
  }

  const email = c.get('user').email;
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (email, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  )
    .bind(email, endpoint, keys.p256dh, keys.auth)
    .run();

  return c.json({ ok: true });
});

// DELETE /api/push/subscribe — remove a push subscription
app.delete('/subscribe', requireAuth, async (c) => {
  const { endpoint } = await c.req.json();
  if (!endpoint) return c.json({ error: 'Missing endpoint' }, 400);

  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND email = ?')
    .bind(endpoint, c.get('user').email)
    .run();

  return c.json({ ok: true });
});

export default app;
