// node --test — pedido novo depois de um enviado, e envio sozinho depois de 10 minutos sem mensagem.
// Caso real de 23/11/2026: o Raoni mandou 5 fotos e 4 mensagens encaminhadas e escreveu "Constituição";
// o robô, preso ao pedido enviado em 18/11, pôs tudo nele.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dialogo");

const MIN = 60000;
const foto = (i, em) => ({ id: "F" + i, nome: "foto.jpg", tipo: "image/jpeg", caminho: "whatsapp/g/" + i, url: "u", tamanho: 1, em: new Date(em).toISOString() });
function enviado(extra) {
  return D.novoEstado(Object.assign({ remetenteNome: "Raoni", fluxo: "fechar", solicId: "WANTIGO", encerrado: true, respostas: { confirmar: "sim", _notas: ["Dar baixa na filial"] }, ordem: [] }, extra || {}));
}
function rodar(estado, msgs) {
  const saidas = []; let ultimo = null;
  for (const m of msgs) { ultimo = D.receber(estado, Object.assign({ remetenteNome: "Raoni" }, m)); estado = ultimo.estado; saidas.push(ultimo); }
  return { estado, saidas };
}

test("caso de 23/11: fotos e encaminhadas depois de um pedido antigo abrem pedido novo; 'Constituição' escolhe Abrir", () => {
  const T = Date.parse("2026-11-23T14:47:06Z");
  const velha = foto(0, Date.parse("2026-11-18T12:23:01Z"));
  const ini = enviado({ arquivosPendentes: [velha] });   // sem enviadoEm: pedido de antes desta versão
  const msgs = [1, 2, 3, 4, 5].map((i) => ({ midia: foto(i, T), texto: "", encaminhada: true, agora: T }))
    .concat(["79 99950-5533", "Nome da empresa \nRancho da brasa", "Restaurante e espetaria", "yaasminnascimento@icloud.com"].map((t) => ({ texto: t, encaminhada: true, agora: T })))
    .concat([{ texto: "Constituição", agora: T + 6000 }]);
  const { estado, saidas } = rodar(ini, msgs);
  // a foto antiga, sem tipo, vai para o pedido de antes (nada se perde)
  assert.equal(saidas[0].anexarEm, "WANTIGO");
  assert.equal(saidas[0].anexar.length, 1);
  assert.match(saidas[0].mensagens[0], /Pedido novo/);
  // nenhuma mensagem encaminhada vira comentário no pedido antigo
  assert.ok(saidas.every((s) => s.acao !== "comentar"));
  assert.equal(estado.solicId, "");
  assert.equal(estado.solicAnterior, "WANTIGO");
  assert.equal(estado.comentarios.length, 4);
  assert.equal(estado.fluxo, "abrir");
  assert.equal(estado.arquivosPendentes.length, 5);
  assert.match(saidas[9].mensagens.join("\n"), /Abrir empresa/);
});

test("tipo do processo escrito logo depois de um envio também começa pedido novo; frase comum continua comentário", () => {
  const agora = Date.now();
  const recente = enviado({ enviadoEm: new Date(agora - 2 * MIN).toISOString() });
  const a = rodar(recente, [{ texto: "Constituição" }]);
  assert.equal(a.estado.fluxo, "abrir");
  assert.equal(a.estado.solicId, "");
  const b = rodar(recente, [{ texto: "o cliente pediu urgência nisso" }]);
  assert.equal(b.saidas[0].acao, "comentar");
  assert.equal(b.estado.solicId, "WANTIGO");
  // arquivo e encaminhada dentro dos 30 minutos ainda são do pedido enviado
  const c = rodar(recente, [{ texto: "cliente disse que tem pressa", encaminhada: true }]);
  assert.equal(c.saidas[0].acao, "comentar");
  const d = rodar(recente, [{ midia: foto(9, agora), texto: "RG do João" }]);
  assert.equal(d.saidas[0].acao, "anexar");
  assert.equal(d.estado.solicId, "WANTIGO");
  // "comentário:" escrito à mão vai para o pedido enviado, mesmo antigo
  const e = rodar(enviado(), [{ texto: "comentário: abrir o protocolo amanhã" }]);
  assert.equal(e.saidas[0].acao, "comentar");
});

test("inatividade: avisa aos 10 minutos e envia 1 minuto depois; mensagem nova recomeça a contagem", () => {
  const T = Date.parse("2026-11-23T15:00:00Z");
  let e = rodar(D.novoEstado({ remetenteNome: "Raoni" }), [{ texto: "Constituição" }, { midia: foto(1, T), texto: "" }]).estado;
  e.ultimaMsgEm = new Date(T).toISOString();
  assert.equal(D.inatividade(e, T + 9 * MIN), null);
  assert.equal(D.inatividade(e, T + 10 * MIN), "avisar");
  e.autoAvisoEm = new Date(T + 10 * MIN).toISOString();
  assert.equal(D.inatividade(e, T + 10 * MIN + 30000), null);
  assert.equal(D.inatividade(e, T + 11 * MIN), "enviar");
  // mensagem depois do aviso: não envia, espera mais 10 minutos
  const e2 = Object.assign({}, e, { ultimaMsgEm: new Date(T + 10 * MIN + 20000).toISOString() });
  assert.equal(D.inatividade(e2, T + 11 * MIN), null);
  assert.equal(D.inatividade(e2, T + 20 * MIN + 20000), "avisar");
});

test("inatividade: sem arquivo, pedido enviado, pausado ou confirmando cancelamento não envia", () => {
  const T = Date.now() - 30 * MIN, velho = new Date(T).toISOString();
  const semArq = rodar(D.novoEstado(), [{ texto: "Constituição" }]).estado;
  assert.equal(D.inatividade(Object.assign(semArq, { ultimaMsgEm: velho }), Date.now()), null);
  const comArq = rodar(D.novoEstado(), [{ texto: "Constituição" }, { midia: foto(1, T) }]).estado;
  comArq.ultimaMsgEm = velho;
  assert.equal(D.inatividade(comArq, Date.now()), "avisar");
  assert.equal(D.inatividade(Object.assign({}, comArq, { pausaAte: Date.now() + MIN }), Date.now()), null);
  assert.equal(D.inatividade(Object.assign({}, comArq, { cancelando: "cancelar" }), Date.now()), null);
  assert.equal(D.inatividade(Object.assign({}, comArq, { respostas: { confirmar: "sim" } }), Date.now()), null);
  // a pausa conta como atividade: 5 minutos depois do fim dela ainda não avisa
  const pausaAcabou = Object.assign({}, comArq, { pausaAte: Date.now() - MIN });
  assert.equal(D.inatividade(pausaAcabou, Date.now()), null);
});

test("envio sozinho: manda com o que tem, fotos como Não identificado, encaminhadas na observação", () => {
  const T = Date.now() - 20 * MIN;
  let e = rodar(D.novoEstado({ remetenteNome: "Raoni" }), [
    { midia: foto(1, T) }, { midia: foto(2, T) },
    { texto: "Nome da empresa \nRancho da brasa", encaminhada: true }, { texto: "Restaurante e espetaria", encaminhada: true },
    { texto: "Constituição" },
  ]).estado;
  const r = D.enviarPorInatividade(Object.assign(e, { autoAvisoEm: new Date().toISOString() }));
  assert.equal(r.acao, "criar_solicitacao");
  assert.match(r.mensagens[0], /Enviado sozinho/);
  assert.match(r.mensagens[0], /2 arquivos foram sem dizer o que é/);
  assert.equal(r.dados.tipo, "const");
  assert.equal(r.dados.empresa, "Rancho da brasa");
  assert.equal(r.dados.anexos.length, 2);
  assert.ok(r.dados.anexos.every((a) => /^Não identificado — /.test(a.nome)));
  assert.match(r.dados.obs, /Mensagens encaminhadas: Nome da empresa Rancho da brasa \/ Restaurante e espetaria/);
  assert.equal(r.dados.comentarios.length, 2);
  assert.equal(r.estado.respostas.confirmar, "sim");
  assert.equal(r.estado.autoAvisoEm, null);
  assert.equal(D.inatividade(r.estado, Date.now() + 60 * MIN), null);
});

test("envio sozinho sem pedido escolhido: o tipo sai do que foi escrito, ou Outro assunto", () => {
  const T = Date.now() - 20 * MIN;
  const so = rodar(D.novoEstado(), [{ midia: foto(1, T) }]).estado;
  const r = D.enviarPorInatividade(so);
  assert.equal(r.dados.fluxo, "outro");
  assert.equal(r.dados.anexos.length, 1);
  const comAnotacao = rodar(D.novoEstado(), [{ midia: foto(1, T), texto: "RG do João" }, { texto: "cliente quer fechar a empresa dele" }]).estado;
  assert.equal(D.enviarPorInatividade(comAnotacao).dados.fluxo, "fechar");
});
