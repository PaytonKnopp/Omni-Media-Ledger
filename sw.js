/* Offline support: a service worker that keeps a copy of the app so it opens with no connection.

   Registered from index.html, and only when the page is served over http(s) -- browsers do not run
   service workers for file:// pages, so opening index.html straight from disk behaves exactly as
   it always has. Nothing here is needed for the app to work; it only decides what happens when the
   network is slow or gone.

   Strategy, and why:

   - The app's own files (index.html, app/*, data/*, icons, manifest) are NETWORK-FIRST. Whenever
     the network answers, you get the current version -- and the copy kept for offline is refreshed
     from that same answer -- so a deploy is live on the next load, with no version number to bump
     and no chance of running new HTML against an old app/*.js or data/*.js. Only if the network
     fails, or has not answered within NETWORK_TIMEOUT_MS, is the saved copy served instead (and on
     a timeout the network response still lands in the cache for next time). Repeat visits online
     are no slower than without a service worker: the browser's own HTTP cache still handles those
     requests underneath.
   - The two CDN scripts (Chart.js, the Supabase client) are pinned to exact versions in their
     URLs, so a cached copy can never be stale: CACHE-FIRST. The Supabase client matters most here
     -- without it the page would boot offline in local-only mode, and edits made then would not
     be marked for upload once the connection returned.
   - Everything else, including every Supabase API call, is left alone and goes straight to the
     network. Cloud data is never cached here; the app's own sync logic (index.html, account-sync)
     owns that, including what to do while offline.

   PRECACHE is fetched at install, so a single online visit is enough for the next one to work
   offline. test/regression.js checks it lists every local file index.html loads. */
const CACHE = 'omni-ledger-offline-v1';
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'data/movies.js', 'data/tv.js', 'data/games.js', 'data/books.js',
  'data/creators.js', 'data/contenders.js', 'data/genre-taxonomy.js', 'data/pk-sample.js',
  'app/sync-merge.js', 'app/format.js', 'app/cards.js', 'app/scoring.js', 'app/match.js',
  'app/matrices.js', 'app/creators.js', 'app/search.js', 'app/ledger-app.js',
  'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
const CDN_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.114.0/dist/umd/supabase.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The app's own files all-or-nothing: a half-filled cache would open offline into a broken
    // page, and a failed install is simply retried on the next visit. `cache: 'reload'` skips the
    // HTTP cache so the offline copy starts out current.
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    // The CDN scripts best-effort: a blocked CDN should not cost the offline copy of the app itself
    // (the app already degrades without them). no-cors, matching how a plain <script src> loads.
    await Promise.all(CDN_SCRIPTS.map((u) =>
      fetch(u, { mode: 'no-cors' }).then((r) => cache.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('omni-ledger-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Navigations are cached by path alone: the app keeps its filters in the query string, and any of
// those URLs should open offline from the one saved copy of the page.
function cacheKeyFor(request) {
  if (request.mode !== 'navigate') return request;
  const url = new URL(request.url);
  return url.origin + url.pathname;
}

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(cacheKeyFor(request));
  if (hit || request.mode !== 'navigate') return hit;
  // A navigation to a path never cached as such (the site root vs. /index.html): the app is one
  // page, so the saved index.html is the right answer for either.
  return (await cache.match(new URL('index.html', self.registration.scope).href)) ||
         (await cache.match(self.registration.scope));
}

function networkFirst(event) {
  const request = event.request;
  const network = fetch(request).then(async (response) => {
    if (response && response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(cacheKeyFor(request), response.clone());
    }
    return response;
  });
  // Keeps the worker alive until the cache write finishes, even when the saved copy was served
  // first because the network was slow.
  event.waitUntil(network.catch(() => {}));

  return new Promise((resolve) => {
    let settled = false;
    const settle = (r) => { if (!settled && r) { settled = true; resolve(r); } };
    const timer = setTimeout(() => { fromCache(request).then(settle); }, NETWORK_TIMEOUT_MS);
    network.then((response) => { clearTimeout(timer); settle(response); },
      async () => {
        clearTimeout(timer);
        const cached = await fromCache(request);
        if (!settled) { settled = true; resolve(cached || Response.error()); }
      });
  });
}

async function cacheFirst(request) {
  const cached = await caches.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(CACHE);
    await cache.put(request.url, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event));
  } else if (CDN_SCRIPTS.includes(request.url)) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else -- Supabase API calls above all -- is not intercepted.
});
