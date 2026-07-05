// Cloudflare Pages Function — proxies /api/* to the Worker backend.
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.WORKER_URL);

  const proxied = new Request(target, request);
  return fetch(proxied);
}
