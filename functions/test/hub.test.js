// O aviso ao Hub tem de sair no MESMO formato do js/integracao.js do app: o recebedor (Hub/integracoes/
// atos-societarios/receber.gs) lê corpo.segredo, corpo.evento e corpo.solicitacao.id. Com os campos
// soltos ele responde {ok:false, "solicitação sem identificador"} — foi o que deixou os pedidos do
// WhatsApp fora do Hub até 11/11/2026.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pacoteHub } = require("../index.js")._interno;

test("pacote do Hub: solicitação dentro de 'solicitacao', com os campos que o app manda", () => {
  const p = pacoteHub("solicitacao.criada", { id: "WABC", empresa: "Pedido pelo WhatsApp", tipo: "alt", pedidos: ["nome"], status: "nova",
    pedidoTexto: "Alterar empresa — pedido feito pelo WhatsApp por Hesley.", prazo: "30/11/2026", abertaPor: "whatsapp", obs: "x" }, "s3gr3do");
  assert.equal(p.evento, "solicitacao.criada"); assert.equal(p.segredo, "s3gr3do");
  assert.equal(p.solicitacao.id, "WABC"); assert.equal(p.id, undefined);
  assert.deepEqual(Object.keys(p.solicitacao).sort(), ["abertaPor", "cnpj", "contato", "empresa", "fone", "id", "obs", "pedido", "pendencia", "prazo", "responsavel", "status", "statusNome", "tipo", "tipoNome"].sort());
  assert.equal(p.solicitacao.tipoNome, "Alteração Contratual (Ltda)"); assert.equal(p.solicitacao.prazo, "2026-11-30"); assert.equal(p.solicitacao.statusNome, "Nova");
  const o = pacoteHub("solicitacao.criada", { id: "W2", tipo: "", pedidos: ["outro"] }, "");
  assert.equal(o.solicitacao.tipoNome, "Outro / não sei"); assert.equal(o.solicitacao.prazo, "");
});
