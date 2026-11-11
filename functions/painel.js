// functions/painel.js — o painel do WhatsApp dentro do Atos (aba Configurações › WhatsApp).
//
// A tela do Atos não pode falar direto com a Evolution: a chave da API ficaria no navegador.
// Ela chama esta rota (/painel, na mesma URL pública do webhook) com o token do login do Firebase;
// aqui se confere que é ADMINISTRADOR ativo em /equipe e só então a função pergunta à Evolution,
// com a chave que mora no Secret Manager. Ações: estado (conexão, número, grupo) e qr.
"use strict";

// De onde a tela pode chamar: o site publicado e as portas locais de desenvolvimento e de testes.
const ORIGENS = ["https://totalicontabilidade.github.io", "http://localhost:9120", "http://localhost:9121", "http://127.0.0.1:9120", "http://127.0.0.1:9121"];

function cors(req, res) {
  const o = String(req.headers.origin || "");
  if (ORIGENS.includes(o)) {
    res.set("Access-Control-Allow-Origin", o);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "authorization, content-type");
    res.set("Access-Control-Max-Age", "600");
  }
  return ORIGENS.includes(o);
}

const ehPainel = (req) => /^\/painel\/?$/.test(String(req.path || ""));

// deps = { admin, db, evolution, configWhats }
async function atender(req, res, deps) {
  const origemOk = cors(req, res);
  if (req.method === "OPTIONS") { res.status(origemOk ? 204 : 403).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, erro: "POST" }); return; }
  const idToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!idToken) { res.status(401).json({ ok: false, erro: "entre com o seu login" }); return; }
  let uid;
  try { uid = (await deps.admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ ok: false, erro: "login vencido: entre de novo" }); return; }
  const eq = await deps.db.collection("equipe").doc(uid).get();
  if (!(eq.exists && eq.data().ativo === true && eq.data().admin === true)) { res.status(403).json({ ok: false, erro: "só administradores" }); return; }

  const acao = String((req.body && req.body.acao) || "estado");
  const ev = deps.evolution;
  if (acao === "estado") {
    const p = await ev.perfilInstancia();
    const cfg = await deps.configWhats(true);
    res.json({ ok: true, estado: p.ok ? (p.data.estado || "close") : "indisponível", numero: p.ok ? p.data.numero : null, nome: p.ok ? p.data.nome : null,
      erro: p.ok ? null : p.erro, grupoJid: cfg.grupoJid || "", grupoNome: cfg.grupoNome || "", grupoAtivadoEm: cfg.grupoAtivadoEm || "" });
    return;
  }
  if (acao === "qr") {
    const q = await ev.obterQr();
    if (!q.ok) { res.status(502).json({ ok: false, erro: q.erro }); return; }
    res.json({ ok: true, estado: q.data.estado, qr: q.data.qr || null });
    return;
  }
  res.status(400).json({ ok: false, erro: "ação desconhecida" });
}

module.exports = { atender, ehPainel, cors, ORIGENS };
