/**
 * Service worker.
 *
 * The editor has no backend and no runtime fetches, so caching is simple: take
 * everything at install time, then serve from cache first and never wait on the
 * network. That makes the installed app genuinely offline — not
 * "offline once you've visited the right pages" — which is the whole point of
 * the product.
 *
 * CACHE_VERSION must change whenever the build output changes, or an installed
 * app will keep serving the previous bundle.
 */

const CACHE_VERSION = 'apexedit-v1';

/**
 * Built asset filenames are content-hashed and therefore unknown here, so the
 * install step reads them out of the app shell rather than hardcoding a list
 * that would silently rot on the next build.
 */
async function precache() {
  const cache = await caches.open(CACHE_VERSION);

  const shell = ['./', './index.html', './manifest.webmanifest'];
  await cache.addAll(shell.map((url) => new Request(url, { cache: 'reload' })));

  const html = await (await cache.match('./index.html'))?.text();
  if (!html) return;

  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    // Skip data: URIs (the inline favicon) and anything off-origin.
    if (url.startsWith('data:') || url.startsWith('http')) continue;
    assets.add(url.startsWith('/') ? `.${url}` : url);
  }
  for (const icon of [
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
  ]) {
    assets.add(icon);
  }

  // Scripts and styles are load-bearing: if one of them cannot be cached the
  // install must fail, so the worker never activates in a state where the app
  // would half-load offline. Icons are cosmetic and may fail quietly.
  const critical = [...assets].filter((url) => /\.(js|css)$/.test(url));
  const optional = [...assets].filter((url) => !/\.(js|css)$/.test(url));

  await Promise.all(critical.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
  await Promise.all(
    optional.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      /*
       * `ignoreVary` matters more than it looks. Static hosts commonly send
       * `Vary: Accept-Encoding`, and by default a cache lookup then requires
       * the request's Vary'd headers to match the ones the entry was stored
       * with. The worker precaches with its own default headers, while the
       * page later asks for the same script with a different `Accept` — so a
       * correctly cached asset misses, and the app fails offline for reasons
       * that look nothing like the cause.
       */
      const cached = await caches.match(request, { ignoreVary: true });
      if (cached) return cached;

      // A navigation to any in-scope path is the single-page app shell.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html', { ignoreVary: true });
        if (shell) return shell;
      }

      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // Offline and uncached. The shell is only a valid answer for a
        // navigation — returning HTML for a script or stylesheet request
        // produces a MIME-type error that hides the real cause, so let those
        // fail honestly instead.
        return new Response('Offline and not cached', {
          status: 504,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});
