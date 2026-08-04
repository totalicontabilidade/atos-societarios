/* Service worker — Atos Societários (PWA offline).
   Estratégia: precache do "app shell" essencial + cache em tempo de execução
   (cache-first) para o restante do mesmo domínio (libs grandes, assets).
   Recursos externos (ViaCEP, motor do Tesseract na CDN) passam direto pela rede. */
const CACHE = "atos-shell-v1";
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/totali-logo-branca.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // só trata o mesmo domínio; externos (CDN/ViaCEP) seguem pela rede normal
  if (url.origin !== self.location.origin) return;

  // navegação (abrir o app): rede primeiro, cai para o index.html cacheado offline
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  // demais recursos do domínio: cache primeiro; se faltar, busca e guarda
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
