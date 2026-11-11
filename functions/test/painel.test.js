"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const painel = require("../painel");

function resFalso() {
  const r = { code: 200, headers: {}, body: null, headersSent: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; r.headersSent = true; return r; };
  r.send = (b) => { r.body = b; r.headersSent = true; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  return r;
}
const deps = (equipe) => ({
  admin: { auth: () => ({ verifyIdToken: async (t) => { if (t !== "token-bom") throw new Error("inválido"); return { uid: "u1" }; } }) },
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: !!equipe, data: () => equipe }) }) }) },
  evolution: {
    perfilInstancia: async () => ({ ok: true, data: { estado: "close", numero: null, nome: null } }),
    obterQr: async () => ({ ok: true, data: { estado: "connecting", qr: "data:image/png;base64,AAAA" } }),
  },
  configWhats: async () => ({ grupoJid: "120@g.us", grupoNome: "Pedidos", grupoAtivadoEm: "2026-11-11" }),
});
const req = (o) => Object.assign({ path: "/painel", method: "POST", headers: { origin: "https://totalicontabilidade.github.io" }, body: { acao: "estado" } }, o);

test("rota: só /painel é do painel", () => {
  assert.equal(painel.ehPainel({ path: "/painel" }), true);
  assert.equal(painel.ehPainel({ path: "/painel/" }), true);
  assert.equal(painel.ehPainel({ path: "/" }), false);
  assert.equal(painel.ehPainel({ path: "/painelx" }), false);
});

test("sem login, login inválido e não administrador são recusados", async () => {
  let r = resFalso(); await painel.atender(req({}), r, deps({ ativo: true, admin: true })); assert.equal(r.code, 401);
  r = resFalso(); await painel.atender(req({ headers: { origin: "https://totalicontabilidade.github.io", authorization: "Bearer falso" } }), r, deps({ ativo: true, admin: true })); assert.equal(r.code, 401);
  r = resFalso(); await painel.atender(req({ headers: { authorization: "Bearer token-bom" } }), r, deps({ ativo: true, admin: false })); assert.equal(r.code, 403);
  r = resFalso(); await painel.atender(req({ headers: { authorization: "Bearer token-bom" } }), r, deps({ ativo: false, admin: true })); assert.equal(r.code, 403);
  r = resFalso(); await painel.atender(req({ headers: { authorization: "Bearer token-bom" } }), r, deps(null)); assert.equal(r.code, 403);
});

test("administrador: estado com o grupo, e QR", async () => {
  const h = { origin: "https://totalicontabilidade.github.io", authorization: "Bearer token-bom" };
  let r = resFalso(); await painel.atender(req({ headers: h }), r, deps({ ativo: true, admin: true }));
  assert.equal(r.code, 200); assert.equal(r.body.estado, "close"); assert.equal(r.body.grupoNome, "Pedidos");
  assert.equal(r.headers["Access-Control-Allow-Origin"], "https://totalicontabilidade.github.io");
  r = resFalso(); await painel.atender(req({ headers: h, body: { acao: "qr" } }), r, deps({ ativo: true, admin: true }));
  assert.equal(r.code, 200); assert.match(r.body.qr, /^data:image\/png;base64,/);
  r = resFalso(); await painel.atender(req({ headers: h, body: { acao: "apagar-tudo" } }), r, deps({ ativo: true, admin: true }));
  assert.equal(r.code, 400);
});

test("CORS: pré-voo da origem do Atos passa; de outro site não recebe permissão", async () => {
  let r = resFalso(); await painel.atender(req({ method: "OPTIONS" }), r, deps(null));
  assert.equal(r.code, 204); assert.equal(r.headers["Access-Control-Allow-Origin"], "https://totalicontabilidade.github.io");
  r = resFalso(); await painel.atender(req({ method: "OPTIONS", headers: { origin: "https://site-mal.com" } }), r, deps(null));
  assert.equal(r.code, 403); assert.equal(r.headers["Access-Control-Allow-Origin"], undefined);
});
