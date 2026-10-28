import webpush from 'web-push';

// web-push's sendNotification() sends the final request via Node's
// https.request(), which Workers doesn't support (no raw socket-level HTTP
// client, only fetch()). generateRequestDetails() does everything else
// (VAPID signing, payload encryption) without touching the network, so we
// take the request it builds and send it ourselves via fetch().
async function sendViaFetch(sub, payload) {
  const subscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  const { endpoint, method, headers, body } = webpush.generateRequestDetails(subscription, payload);

  const res = await fetch(endpoint, { method, headers, body });
  if (!res.ok) {
    const err = new Error(`Push service responded ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
}

// Each push is one fetch() subrequest. Workers Paid allows far more per
// invocation than this, but a cap keeps one notification burst bounded.
const MAX_PUSHES_PER_INVOCATION = 500;

// Sends one Web Push payload to the given subscriptions. Failures for
// individual (likely stale) subscriptions are logged and skipped rather
// than aborting the batch; gone ones (404/410) are deleted.
async function sendToSubscriptions(env, subscriptions, message) {
  if (!subscriptions.length) return 0;
  if (subscriptions.length > MAX_PUSHES_PER_INVOCATION) {
    console.warn(`[notify] ${subscriptions.length} subscriptions, only sending to the newest ${MAX_PUSHES_PER_INVOCATION}`);
  }

  webpush.setVapidDetails('mailto:contact@yourdomain.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({ icon: '/icons/icon-192.png', ...message });

  let sent = 0;
  await Promise.all(
    subscriptions.slice(0, MAX_PUSHES_PER_INVOCATION).map(async (sub) => {
      try {
        await sendViaFetch(sub, payload);
        sent += 1;
      } catch (err) {
        console.error(`[notify] push failed for ${sub.endpoint}: ${err.message}`);
        if (err.statusCode === 404 || err.statusCode === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        }
      }
    })
  );
  return sent;
}

export async function notifyAll(env, message) {
  const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions ORDER BY id DESC').all();
  return sendToSubscriptions(env, results, message);
}

export async function notifyAdmin(env, message) {
  const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE email = ? ORDER BY id DESC')
    .bind(env.ADMIN_EMAIL)
    .all();
  return sendToSubscriptions(env, results, message);
}

// Fan out a Web Push notification to every subscriber when a level-5 topic
// trigger fires (spec §5.6).
export async function notifySubscribers(env, article, topic) {
  await notifyAll(env, {
    title: `[${topic.name}] ${article.title_en}`,
    body: (article.title_en ?? '').slice(0, 100),
    url: `/article/${article.id}`,
  });
}

export async function maybeNotify(env, article, matchedTopics) {
  for (const topic of matchedTopics) {
    if (topic.trigger_level === 5 && article.importance >= topic.trigger_level) {
      await notifySubscribers(env, article, topic);
    }
  }
}
