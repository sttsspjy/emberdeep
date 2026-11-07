// Service worker (PWA shell): serves same-origin GETs in its scope cache-first from one complete file set; cross-origin requests (PeerJS signalling) pass through untouched.
// File set: same-origin <script src> / <link href> of index.html + SHELL, stored in cache 'wd-set-<stamp>'; cache 'wd-meta' holds the current set's name (one put = atomic switch).
// Install builds a set from the network. Update (the page posts 'check'): every URL is refetched with cache: 'no-cache' (conditional, 304s are cheap); if any body changed and no
// fetch failed, a new set is written, the pointer switches, older sets are deleted and every window gets 'updated'. Any failure keeps the current set.
'use strict';
const SET = 'wd-set-', META = 'wd-meta';
const SCOPE = self.registration.scope; // ends in '/'
const abs = (u) => new URL(u, SCOPE).href;
const INDEX = abs('./'), PTR = abs('__wd-current');
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-180.png'].map(abs);

let cur = null; // { name, cache } of the current set
let checking = null;

async function current() {
  if (cur) return cur;
  const r = await (await caches.open(META)).match(PTR);
  if (!r) return null;
  const name = await r.text();
  if (!(await caches.has(name))) return null;
  cur = { name, cache: await caches.open(name) };
  return cur;
}

// Live 200 response (redirects unwrapped so it can answer a navigation); throws on anything else.
async function get(u) {
  const r = await fetch(u, { cache: 'no-cache', credentials: 'same-origin' });
  if (r.status !== 200) throw new Error(u + ' ' + r.status);
  return r.redirected ? new Response(await r.blob(), { status: 200, statusText: r.statusText, headers: r.headers }) : r;
}

// Same-origin file URLs index.html loads (data: and cross-origin skipped) + SHELL.
function fileSet(html) {
  const out = new Set(SHELL);
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+)"/gi)) {
    const u = new URL(m[1].replace(/&amp;/g, '&'), SCOPE);
    if (u.origin === self.location.origin) { u.hash = ''; out.add(u.href); }
  }
  return [...out];
}

// [[url, Response]] of the live file set; throws if any listed file fails. extra: URLs cached on a miss, kept while they still load.
async function fetchSet(extra) {
  const idx = await get(INDEX);
  const urls = fileSet(await idx.clone().text());
  const res = await Promise.all(urls.map((u) => (u === INDEX ? idx : get(u))));
  const list = urls.map((u, i) => [u, res[i]]), have = new Set(urls);
  for (const u of extra || []) if (!have.has(u)) { const r = await get(u).catch(() => null); if (r) list.push([u, r]); }
  return list;
}

async function same(a, b) {
  if (!a) return false;
  const ea = a.headers.get('ETag');
  if (ea && ea === b.headers.get('ETag')) return true;
  const [x, y] = await Promise.all([a.clone().arrayBuffer(), b.clone().arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return false;
  const p = new Uint8Array(x), q = new Uint8Array(y);
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
  return true;
}

// Writes list into a new set and makes it current; a failed write deletes the partial set and throws.
async function writeSet(list) {
  const name = SET + Date.now(), c = await caches.open(name);
  try { await Promise.all(list.map(([u, r]) => c.put(u, r))); } catch (e) { await caches.delete(name); throw e; }
  await (await caches.open(META)).put(PTR, new Response(name));
  cur = { name, cache: c };
}

// Deletes every set but the current one; true when one was deleted.
async function prune() {
  const old = (await caches.keys()).filter((k) => k.startsWith(SET) && (!cur || k !== cur.name));
  await Promise.all(old.map((k) => caches.delete(k)));
  return old.length > 0;
}

async function post(msg) { for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg); }

async function check() {
  const c = await current(); if (!c) return;
  const keys = (await c.cache.keys()).map((q) => q.url), live = await fetchSet(keys);
  let changed = live.length !== keys.length;
  for (let i = 0; i < live.length && !changed; i++) changed = !(await same(await c.cache.match(live[i][0], { ignoreVary: true }), live[i][1]));
  if (!changed) return;
  await writeSet(live);
  await prune();
  await post('updated');
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => { await writeSet(await fetchSet()); await self.skipWaiting(); })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await self.clients.claim();
    await current();
    if (await prune()) await post('updated'); // a new sw.js replaced an older set
  })());
});

self.addEventListener('message', (e) => {
  if (e.data !== 'check') return;
  if (!checking) checking = check().catch(() => {}).then(() => { checking = null; });
  e.waitUntil(checking);
});

self.addEventListener('fetch', (e) => {
  const q = e.request;
  if (q.method !== 'GET' || !q.url.startsWith(SCOPE)) return;
  e.respondWith(serve(e, q));
});

// Navigation to the scope root or index.html -> the cached page (query ignored); other URLs exact. Miss -> network, a 200 without a query is added to the current set.
async function serve(e, q) {
  const c = await current().catch(() => null);
  if (!c) return fetch(q);
  const path = q.url.split(/[?#]/)[0], nav = q.mode === 'navigate' && (path === INDEX || path === INDEX + 'index.html');
  const hit = await c.cache.match(nav ? INDEX : q, { ignoreVary: true });
  if (hit) return hit;
  const r = await fetch(q);
  if (r.status === 200 && r.type === 'basic' && path === q.url) e.waitUntil(c.cache.put(q, r.clone()).catch(() => {}));
  return r;
}
