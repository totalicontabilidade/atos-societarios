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

test("depois de enviado, o que chega é pedido novo (texto, arquivo, encaminhada); 'comentário' vai para o enviado", () => {
  const agora = Date.now();
  const recente = enviado({ enviadoEm: new Date(agora - 2 * MIN).toISOString() });
  const a = rodar(recente, [{ texto: "Constituição" }]);
  assert.equal(a.estado.fluxo, "abrir"); assert.equal(a.estado.solicId, ""); assert.equal(a.estado.solicAnterior, "WANTIGO");
  const b = rodar(recente, [{ texto: "o cliente pediu urgência nisso" }]);
  assert.notEqual(b.saidas[0].acao, "comentar"); assert.equal(b.estado.solicId, "");
  const c = rodar(recente, [{ texto: "cliente disse que tem pressa", encaminhada: true }]);
  assert.notEqual(c.saidas[0].acao, "comentar"); assert.equal(c.estado.comentarios.length, 1);
  const d = rodar(recente, [{ midia: foto(9, agora), texto: "RG do João" }]);
  assert.notEqual(d.saidas[0].acao, "anexar"); assert.equal(d.estado.solicId, "");
  // "comentário:" com um só pedido possível vai direto para ele
  const e = rodar(enviado(), [{ texto: "comentário: abrir o protocolo amanhã" }]);
  assert.equal(e.saidas[0].acao, "comentar"); assert.equal(e.estado.solicId, "WANTIGO");
  // "enviar" deixa o arquivo sem tipo como Não identificado e não pergunta mais
  const f = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "Constituição" }, { midia: foto(1, agora) }, { texto: "enviar" }]);
  assert.equal(f.saidas[2].acao, "criar_solicitacao");
  assert.ok(f.saidas[2].dados.anexos.some((x) => /^Não identificado/.test(x.nome)));
  assert.deepEqual(f.estado.arquivosPendentes, []);
  assert.match(f.saidas[2].mensagens.join("\n"), /pedido novo/);
});

test("20 minutos sem mensagem com pedido em andamento: o de antes vai como está e começa outro", () => {
  const T = Date.parse("2026-11-23T15:00:00Z");
  let e = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "Alteração da empresa", agora: T }, { texto: "12.345.678/0001-95", agora: T }]).estado;
  e.ultimaMsgEm = new Date(T).toISOString();
  const cedo = D.receber(e, { texto: "1", remetenteNome: "Raoni", agora: T + 19 * MIN });
  assert.equal(cedo.criarAnterior, undefined); assert.deepEqual(cedo.estado.respostas.oQueMuda, ["endereco"]);
  const tarde = D.receber(e, { texto: "Abertura de empresa para a Ana", remetenteNome: "Raoni", agora: T + 21 * MIN });
  assert.ok(tarde.criarAnterior); assert.equal(tarde.criarAnterior.dados.fluxo, "alterar");
  assert.equal(tarde.estado.fluxo, "abrir"); assert.equal(tarde.estado.cnpj, "");
  assert.match(tarde.mensagens[0], /20 minutos sem mensagem/);
  // comando depois do silêncio continua sendo do pedido em andamento
  const env = D.receber(e, { texto: "enviar", remetenteNome: "Raoni", agora: T + 30 * MIN });
  assert.equal(env.acao, "criar_solicitacao"); assert.equal(env.criarAnterior, undefined);
});

test("comentário com mais de um pedido possível: pergunta para qual vai (texto e arquivo)", () => {
  const agora = Date.now();
  const rec = [{ id: "WRANCHO", empresa: "Rancho da brasa", fluxo: "abrir", em: new Date(agora - 60 * MIN).toISOString() },
    { id: "WITN", empresa: "ITN", fluxo: "fechar", em: new Date(agora - 5 * 24 * 60 * MIN).toISOString() }];   // de 5 dias: fica de fora
  const e = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x", pedidosRecentes: rec }), [{ texto: "Alteração da empresa", agora }]).estado;
  const ops = D.opcoesDestino(e, agora);
  assert.equal(ops.length, 2); assert.ok(ops[0].atual); assert.equal(ops[1].id, "WRANCHO");
  let r = D.receber(e, { texto: "comentário: o cliente pagou a taxa", remetenteNome: "Raoni", agora });
  assert.match(r.pergunta, /Para qual pedido vai o comentário\?/); assert.match(r.pergunta, /Rancho da brasa/);
  const para2 = D.receber(r.estado, { texto: "2", remetenteNome: "Raoni", agora });
  assert.equal(para2.comentarEm.length, 1); assert.equal(para2.comentarEm[0].solicId, "WRANCHO");
  assert.equal(para2.comentarEm[0].comentario.texto, "o cliente pagou a taxa");
  assert.match(para2.pergunta, /CNPJ/);   // e volta à pergunta do pedido em andamento
  const para1 = D.receber(r.estado, { texto: "1", remetenteNome: "Raoni", agora });
  assert.equal(para1.comentarEm, undefined); assert.equal(para1.estado.comentarios.length, 1);
  // arquivo: "comentário" e depois o arquivo
  r = rodar(e, [{ texto: "comentário", agora }, { midia: foto(3, agora), texto: "", agora }, { texto: "2", agora }]);
  assert.match(r.saidas[1].mensagens.join("\n"), /Para qual pedido vai o arquivo/);
  assert.equal(r.saidas[2].anexarOutros[0].solicId, "WRANCHO");
  assert.match(r.saidas[2].anexarOutros[0].itens[0].nome, /^Não identificado/);
  // sem número: vai para a 1ª opção e a mensagem segue
  r = rodar(e, [{ texto: "comentário: urgente", agora }, { texto: "12.345.678/0001-95", agora }]);
  assert.equal(r.estado.comentarios.length, 1); assert.equal(r.estado.respostas.cnpj, "12.345.678/0001-95");
});

test("nome de outro ato no meio do pedido: pergunta a partir de qual mensagem é o novo", () => {
  const T = Date.parse("2026-11-23T16:00:00Z");
  const base = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "alteração da empresa X", agora: T }, { texto: "12.345.678/0001-95", agora: T },
    { midia: foto(1, T), agora: T }, { midia: foto(2, T), agora: T }]).estado;
  const q = D.receber(base, { texto: "Baixa", remetenteNome: "Raoni", agora: T + MIN });
  assert.match(q.pergunta, /A partir de qual mensagem/); assert.match(q.pergunta, /\*3\* — Só a partir de “Baixa”/);
  // 1: as duas fotos são do pedido novo
  const r1 = D.receber(q.estado, { texto: "1", remetenteNome: "Raoni", agora: T + MIN });
  assert.equal(r1.estado.fluxo, "fechar"); assert.equal(r1.estado.arquivosPendentes.length, 2);
  assert.equal(r1.criarAnterior.dados.fluxo, "alterar"); assert.equal(r1.criarAnterior.dados.anexos.length, 0);
  // 2: a 2ª foto é do novo, a 1ª fica no de antes
  const r2 = D.receber(q.estado, { texto: "2", remetenteNome: "Raoni", agora: T + MIN });
  assert.equal(r2.estado.arquivosPendentes.length, 1); assert.equal(r2.criarAnterior.dados.anexos.length, 1);
  // 3: as fotos ficam no de antes, como Não identificado
  const r3 = D.receber(q.estado, { texto: "3", remetenteNome: "Raoni", agora: T + MIN });
  assert.equal(r3.estado.arquivosPendentes.length, 0); assert.equal(r3.criarAnterior.dados.anexos.length, 2);
  // 4: não é pedido novo
  const r4 = D.receber(q.estado, { texto: "4", remetenteNome: "Raoni", agora: T + MIN });
  assert.equal(r4.criarAnterior, undefined); assert.equal(r4.estado.fluxo, "alterar"); assert.ok(r4.estado.respostas._notas.includes("Baixa"));
  // sem resposta por 11 minutos: o de antes vai, o novo fica aberto
  const s = D.enviarPorInatividade(q.estado);
  assert.ok(s.criarAnterior); assert.equal(s.estado.fluxo, "fechar"); assert.match(s.mensagens[0], /Ninguém respondeu/);
});

test("nome de outro ato sem nada solto antes: troca direto; com o pedido vazio, só troca o tipo", () => {
  const T = Date.parse("2026-11-23T16:00:00Z");
  const e = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "alteração da empresa X", agora: T }, { texto: "12.345.678/0001-95", agora: T }]).estado;
  const r = D.receber(e, { texto: "Constituição", remetenteNome: "Raoni", agora: T + MIN });
  assert.ok(r.criarAnterior); assert.equal(r.estado.fluxo, "abrir"); assert.match(r.mensagens[0], /Pedido novo/);
  const vazio = rodar(D.novoEstado({ remetenteNome: "Raoni", lgpdEm: "x" }), [{ texto: "1", agora: T }]).estado;
  const t = D.receber(vazio, { texto: "Baixa da filial", remetenteNome: "Raoni", agora: T + MIN });
  assert.equal(t.criarAnterior, undefined); assert.equal(t.estado.fluxo, "fechar"); assert.match(t.mensagens[0], /Troquei o pedido/);
  // o mesmo ato com o pedido já andando: pergunta se é novo
  const mesmo = D.receber(e, { texto: "Alteração contratual", remetenteNome: "Raoni", agora: T + MIN });
  assert.match(mesmo.pergunta, /\*1\* — É pedido novo/);
  assert.equal(D.nomeDoAto("o cliente quer abrir uma filial em Aracaju amanhã cedo"), null);
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
