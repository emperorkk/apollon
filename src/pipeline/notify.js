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

// Fan out a Web Push notification to every subscriber when a level-5 topic
// trigger fires (spec §5.6). Failures for individual (likely stale)
// subscriptions are logged and skipped rather than aborting the batch.
export async function notifySubscribers(env, article, topic) {
  webpush.setVapidDetails(
    'mailto:contact@yourdomain.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  const { results: subscriptions } = await env.DB.prepare(
    'SELECT * FROM push_subscriptions'
  ).all();

  const payload = JSON.stringify({
    title: `[${topic.name}] ${article.title_en}`,
    body: (article.title_en ?? '').slice(0, 100),
    icon: '/icons/icon-192.png',
    url: `/article/${article.id}`,
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await sendViaFetch(sub, payload);
      } catch (err) {
        console.error(`[notify] push failed for ${sub.endpoint}: ${err.message}`);
        if (err.statusCode === 404 || err.statusCode === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        }
      }
    })
  );
}

export async function maybeNotify(env, article, matchedTopics) {
  for (const topic of matchedTopics) {
    if (topic.trigger_level === 5 && article.importance >= topic.trigger_level) {
      await notifySubscribers(env, article, topic);
    }
  }
}
