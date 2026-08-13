/* Service worker — Atos Societários (PWA offline + auto-atualização).
   Estratégia:
   - Navegação (abrir o app): REDE PRIMEIRO, ignorando o cache do navegador (cache:"no-store"),
     e guarda a cópia mais nova para uso offline. Assim, abrir o app online = sempre a última versão.
   - Demais recursos do mesmo domínio (libs grandes, ícones): cache primeiro (rápido/offline).
   - Recursos externos (ViaCEP): passam direto pela rede. */
const CACHE = "atos-shell-v12";
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
  // só trata o mesmo domínio; externos (ViaCEP etc.) seguem pela rede normal
  if (url.origin !== self.location.origin) return;

  // navegação (abrir o app): rede primeiro SEM cache HTTP → sempre a versão mais nova; atualiza a cópia offline; cai para o cache se estiver sem internet
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req.url, { cache: "no-store" });
        // só guarda cópia offline se a resposta for BOA: um 404/502 (ex.: durante um deploy) viraria
        // a "versão offline" do app e passaria a ser servida no lugar da página real.
        if (fresh && fresh.ok && fresh.type === "basic") {
          caches.open(CACHE).then(c => c.put("./index.html", fresh.clone())).catch(() => {});
        }
        return fresh;
      } catch (_) {
        return (await caches.match("./index.html")) || (await caches.match("./")) || Response.error();
      }
    })());
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
