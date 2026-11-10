"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { decidir, codigoDeAtivacao } = require("../portaria");
const P = require("../parser");

const GRUPO = "120363000000000001@g.us";
const msg = (remoteJid, texto, extra) => P.normalizarEvento({ event: "messages.upsert", data: Object.assign({ key: { remoteJid, fromMe: false, id: "X" + Math.random(), participant: remoteJid.endsWith("@g.us") ? "5579988887777@s.whatsapp.net" : undefined }, pushName: "Fulano", message: { conversation: texto }, messageTimestamp: 1794010000 }, extra || {}) });

test("privado de cliente: ignorado, mesmo com código, menu ou pedido de equipe", () => {
  for (const t of ["oi", "1", "0", "equipe", "vincular 123456", "#ativar-atos 123456", "preciso abrir uma empresa"]) {
    const d = decidir(msg("5579999990000@s.whatsapp.net", t), { grupoJid: GRUPO });
    assert.equal(d.acao, "ignorar", t); assert.match(d.motivo, /privado/);
  }
});

test("outro grupo: ignorado; só o código de ativação é examinado", () => {
  assert.equal(decidir(msg("120363999999999999@g.us", "oi"), { grupoJid: GRUPO }).acao, "ignorar");
  assert.equal(decidir(msg("120363999999999999@g.us", "vincular 123456"), { grupoJid: GRUPO }).acao, "ignorar");
  assert.deepEqual(decidir(msg("120363999999999999@g.us", "#ativar-atos 123 456"), { grupoJid: GRUPO }), { acao: "ativar", codigo: "123456" });
});

test("sem grupo ativado: nada é atendido", () => {
  assert.equal(decidir(msg(GRUPO, "oi"), {}).acao, "ignorar");
  assert.equal(decidir(msg(GRUPO, "oi"), null).acao, "ignorar");
});

test("grupo ativado: atendido", () => {
  assert.deepEqual(decidir(msg(GRUPO, "oi"), { grupoJid: GRUPO }), { acao: "atender" });
  assert.deepEqual(decidir(msg(GRUPO, "vincular 654321"), { grupoJid: GRUPO }), { acao: "atender" });
});

test("mensagem do próprio número e status nem chegam a ser mensagem", () => {
  const proprio = P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: GRUPO, fromMe: true, id: "Y" }, message: { conversation: "oi" } } });
  assert.equal(decidir(proprio, { grupoJid: GRUPO }).acao, "ignorar");
  const status = P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "status@broadcast", id: "Z" }, message: { conversation: "oi" } } });
  assert.equal(decidir(status, { grupoJid: GRUPO }).acao, "ignorar");
});

test("código de ativação: formatos aceitos e recusados", () => {
  assert.equal(codigoDeAtivacao("#ativar-atos 123456"), "123456");
  assert.equal(codigoDeAtivacao("ativar atos 123 456"), "123456");
  assert.equal(codigoDeAtivacao("ATIVAR-ATOS: 000001"), "000001");
  assert.equal(codigoDeAtivacao("vamos ativar atos amanhã"), null);
  assert.equal(codigoDeAtivacao("#ativar-atos 12345"), null);
  assert.equal(codigoDeAtivacao("vincular 123456"), null);
});
