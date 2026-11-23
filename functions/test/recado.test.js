// node --test — recado: pedido que não é ato (consulta na prefeitura, viabilidade, certidão…).
// Vai só para o Hub, como pendência própria: no Atos não fica nada (nem solicitação, nem o arquivo).
// Caso real de 18/11/2026: o Raoni encaminhou a foto de um ponto e mandou um áudio pedindo para ver na
// prefeitura se dava para abrir CNPJ ali; o robô pôs o texto como comentário do pedido da ITN.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dialogo");
const I = require("../index.js")._interno;

const T = Date.parse("2026-11-18T12:23:00Z");
const foto = (i) => ({ id: "F" + i, nome: "foto" + i + ".jpg", tipo: "image/jpeg", caminho: "whatsapp/g/" + i, url: "u", tamanho: 1, em: new Date(T).toISOString() });
const AUDIO = "Presley, eu preciso ver consulta e prefeitura para ver se esse ponto a gente pode abrir um CNPJ. Você viu isso, por favor, manda lá no whatsapp deles";
function rodar(estado, msgs) {
  const saidas = [];
  for (const m of msgs) { const r = D.receber(estado, Object.assign({ remetenteNome: "Raoni", agora: T }, m)); estado = r.estado; saidas.push(r); }
  return { estado, saidas };
}
const enviado = () => D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x", fluxo: "fechar", solicId: "WITN", encerrado: true, respostas: { confirmar: "sim" }, enviadoEm: "2026-11-18T11:35:22Z" });

test("caso de 18/11: foto + áudio de consulta na prefeitura → o robô pergunta; 1 = recado para o Hub, nada no Atos", () => {
  const { estado, saidas } = rodar(enviado(), [{ midia: foto(1), encaminhada: true }, { texto: AUDIO }, { texto: "1" }]);
  assert.match(saidas[1].pergunta, /recado para a equipe/);
  assert.match(saidas[1].pergunta, /O arquivo mandado antes conta/);
  const r = saidas[2].recado;
  assert.ok(r); assert.equal(r.texto, AUDIO); assert.equal(r.por, "Raoni");
  assert.deepEqual(r.arquivos, [{ nome: "foto1.jpg", em: foto(1).em, legenda: "" }]);
  assert.equal(saidas[2].descartar.length, 1); assert.equal(saidas[2].descartar[0].caminho, "whatsapp/g/1");   // sai do Storage do Atos
  assert.ok(saidas.every((s) => s.acao !== "criar_solicitacao" && s.acao !== "comentar" && s.acao !== "anexar"));
  assert.equal(estado.fluxo, null); assert.deepEqual(estado.arquivosPendentes, []);
  // a pendência do Hub
  const h = I.pacoteHub("solicitacao.criada", I.hubDoRecado(r), "s").solicitacao;
  assert.match(h.id, /^R/); assert.equal(h.tipoNome, "📌 Recado do grupo (não é ato)"); assert.equal(h.empresa, "de Raoni");
  assert.equal(h.pedido, AUDIO); assert.match(h.obs, /Arquivo no grupo do WhatsApp \(não fica no Atos\):\n📎 foto1\.jpg/);
});

test("sem resposta à pergunta ('Certo' do Hesley): fica como recado; 2 = é ato, segue como antes", () => {
  const a = rodar(enviado(), [{ midia: foto(1), encaminhada: true }, { texto: AUDIO }, { texto: "Certo", remetenteNome: "Hesley" }]);
  assert.ok(a.saidas[2].recado); assert.match(a.saidas[2].mensagens.join("\n"), /ficou como recado/);
  const b = rodar(enviado(), [{ midia: foto(1), encaminhada: true }, { texto: AUDIO }, { texto: "2" }]);
  assert.equal(b.saidas[2].recado, undefined); assert.equal(b.estado.fluxo, "abrir");   // "abrir um CNPJ"
  assert.equal(b.estado.arquivosPendentes.length, 1);
  // envio sozinho com a pergunta sem resposta: recado, não pedido
  const s = D.enviarPorInatividade(rodar(enviado(), [{ midia: foto(1), encaminhada: true }, { texto: AUDIO }]).estado);
  assert.ok(s.recado); assert.equal(s.acao, null); assert.match(s.mensagens.join("\n"), /Ninguém respondeu/);
});

test("'recado: …' e 'recado' + arquivo: não mexem no pedido em andamento; menu tem a opção", () => {
  const e = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "alteração da empresa X" }]).estado;
  let r = D.receber(e, { texto: "recado: pedir a certidão de uso do solo do ponto novo", remetenteNome: "Raoni", agora: T });
  assert.equal(r.recado.texto, "pedir a certidão de uso do solo do ponto novo"); assert.equal(r.recado.arquivos.length, 0);
  assert.equal(r.estado.fluxo, "alterar"); assert.match(r.pergunta, /CNPJ/);
  const c = rodar(e, [{ texto: "Recado" }, { midia: foto(2), texto: "planta do imóvel" }]);
  assert.match(c.saidas[0].pergunta, /Escreva o recado/);
  assert.equal(c.saidas[1].recado.arquivos.length, 1); assert.equal(c.saidas[1].recado.texto, "planta do imóvel");
  assert.equal(c.estado.fluxo, "alterar");
  // depois de enviado, "recado" não abre pedido novo
  r = D.receber(enviado(), { texto: "recado: ligar para a prefeitura amanhã", remetenteNome: "Raoni", agora: T });
  assert.ok(r.recado); assert.equal(r.estado.solicId, "WITN");
  // pelo menu
  const m = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "menu" }, { texto: "7" }, { texto: "ver alvará dos bombeiros da loja" }]);
  assert.match(m.saidas[0].mensagens.join("\n"), /\*7\* — Recado para a equipe/);
  assert.ok(m.saidas[2].recado); assert.equal(m.saidas[2].recado.texto, "ver alvará dos bombeiros da loja");
});

test("o que não é recado não pergunta", () => {
  assert.equal(D.pareceRecado("Constituição de empresa, precisa consultar a viabilidade na prefeitura"), false);   // começa com ato
  assert.equal(D.pareceRecado("certidão negativa"), false);                                                       // curto: rótulo de documento
  assert.equal(D.pareceRecado("dar baixa na filial da ITN em riachuelo"), false);
  assert.equal(D.pareceRecado("comentário: ver a consulta na prefeitura amanhã cedo"), false);
  assert.equal(D.pareceRecado(AUDIO), true);
  // com pedido escolhido, a frase não é interrompida (vira resposta/anotação, como antes)
  const e = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "Constituição" }]).estado;
  const r = D.receber(e, { texto: AUDIO, remetenteNome: "Raoni", agora: T });
  assert.equal(r.estado.perguntaRecado, undefined); assert.equal(r.recado, undefined);
});
