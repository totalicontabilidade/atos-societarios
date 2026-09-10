/* Service worker — Atos Societários (PWA offline + auto-atualização).
   Estratégia:
   - Navegação (abrir o app): REDE PRIMEIRO, ignorando o cache do navegador (cache:"no-store"),
     e guarda a cópia mais nova para uso offline. Assim, abrir o app online = sempre a última versão.
   - Demais recursos do mesmo domínio (libs grandes, ícones): cache primeiro (rápido/offline).
   - Recursos externos (ViaCEP): passam direto pela rede. */
const CACHE = "atos-shell-v60";
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icone-192.png",
  "./assets/icone-512.png",
  "./assets/logo-fundo-escuro.png",
  "./assets/logo-fundo-claro.png",
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

  /* CÓDIGO DO PRÓPRIO APP (js/): REDE PRIMEIRO, como a página.
     O index.html sempre vem da rede, mas js/nuvem.js vinha do cache — então uma versão NOVA da
     página podia rodar junto de um nuvem.js VELHO, e recursos que dependem dos dois simplesmente
     não funcionavam, sem nenhum erro na tela. Foi o que aconteceu com o papel "comercial": a
     página já sabia abrir direto nas solicitações, o nuvem.js antigo nem sabia o que era papel.
     As bibliotecas de lib/ continuam no cache: são grandes, versionadas pelo nome e não mudam. */
  if (/\/js\/[^/]+\.js$/.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req.url, { cache: "no-store" });
        if (fresh && fresh.ok && fresh.type === "basic") {
          caches.open(CACHE).then(c => c.put(req, fresh.clone())).catch(() => {});
        }
        return fresh;
      } catch (_) {
        return (await caches.match(req)) || new Response("", { status: 504, statusText: "offline" });
      }
    })());
    return;
  }

  // demais recursos do domínio: cache primeiro; se faltar, busca e guarda
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});   // cota estourada não deve virar rejeição solta
      }
      return res;
    // sem cópia em cache e sem rede: devolve uma resposta de erro real (respondWith(undefined) quebraria a requisição)
    }).catch(() => new Response("", { status: 504, statusText: "offline" })))
  );
});
