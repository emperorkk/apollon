import { Hono } from 'hono';
import { getHealth } from '../pipeline/health.js';

const app = new Hono();

// GET /api/health — pipeline health for uptime monitors. 200 when ok or
// degraded, 503 when ingestion is down (see pipeline/health.js).
app.get('/', async (c) => {
  try {
    const health = await getHealth(c.env.DB);
    return c.json(health, health.status === 'down' ? 503 : 200);
  } catch (err) {
    return c.json({ status: 'down', problems: [{ key: 'db', severity: 'down', message: err.message }] }, 503);
  }
});

export default app;
