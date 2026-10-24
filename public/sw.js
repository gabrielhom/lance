// Keeps Lance usable offline. Files under assets/ and engine/ have the content hash or the engine version in their
// names, so a cached copy never goes stale. The page itself always tries the network first.
// Bump CACHE only when the layout of what is stored changes. Activation deletes every other cache.
const CACHE = 'lance-1'
const scope = self.registration.scope
const shell = scope
const isImmutable = (url) => url.startsWith(`${scope}assets/`) || url.startsWith(`${scope}engine/`)

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name)
      await self.clients.claim()
      await syncBuild()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return
  if (request.mode === 'navigate') event.respondWith(page(event))
  else if (isImmutable(request.url)) event.respondWith(immutable(event))
})

/** Stored from a real network response, so the copy keeps the COOP and COEP headers that make the page cross-origin isolated. */
async function page(event) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(event.request)
    if (response.ok && !response.redirected) event.waitUntil(cache.put(shell, response.clone()).then(syncBuild))
    return response
  } catch (error) {
    const cached = await cache.match(shell)
    if (cached) return cached
    throw error
  }
}

async function immutable(event) {
  const { url } = event.request
  const cache = await caches.open(CACHE)
  const cached = await cache.match(url, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(event.request)
  if (response.status === 200) event.waitUntil(cache.put(url, response.clone()).then(() => dropOtherEngines(cache, url)))
  return response
}

/** A new stockfish version lives in a new folder. Once one of its files is stored, the old version's files are dead weight. */
async function dropOtherEngines(cache, url) {
  const folder = url.match(/^.*\/engine\/[^/]+\//)?.[0]
  if (!folder) return
  for (const request of await cache.keys()) {
    if (request.url.startsWith(`${scope}engine/`) && !request.url.startsWith(folder)) await cache.delete(request)
  }
}

/** Stores the page and every file of the deployed build, including chunks the user has not opened yet, and drops files
 *  of older builds. Vite writes the list to build-manifest.json. */
async function syncBuild() {
  const cache = await caches.open(CACHE)
  if (!(await cache.match(shell))) {
    const response = await fetch(shell, { cache: 'no-cache' })
    if (response.ok && !response.redirected) await cache.put(shell, response)
  }
  const response = await fetch(`${scope}build-manifest.json`, { cache: 'no-cache' })
  if (!response.ok) return
  const chunks = Object.values(await response.json())
  const files = new Set(chunks.flatMap((c) => [c.file, ...(c.css ?? []), ...(c.assets ?? [])]).map((f) => new URL(f, scope).href))
  const stored = new Set()
  for (const request of await cache.keys()) {
    if (!request.url.startsWith(`${scope}assets/`)) continue
    if (files.has(request.url)) stored.add(request.url)
    else await cache.delete(request)
  }
  await Promise.all(
    [...files]
      .filter((url) => !stored.has(url))
      .map(async (url) => {
        const file = await fetch(url)
        if (file.status === 200) await cache.put(url, file)
      }),
  )
}
