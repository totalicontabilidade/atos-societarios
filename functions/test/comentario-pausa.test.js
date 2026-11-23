// node --test — comandos "comentário" (vai para a solicitação do Atos e para o Hub) e "pausar"/"ativar".
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dialogo");

function conversa(linhas, estadoInicial) {
  let estado = estadoInicial || D.novoEstado({ remetenteNome: "Raoni" });
  const saidas = []; let ultimo = null;
  for (const l of linhas) { ultimo = D.receber(estado, typeof l === "string" ? { texto: l } : l); estado = ultimo.estado; saidas.push(ultimo.mensagens.join("\n")); }
  return { estado, saidas, ultimo };
}

test("comentário: reconhece as formas e separa o texto", () => {
  assert.equal(D.comentarioDoTexto("comentário: cliente tem pressa"), "cliente tem pressa");
  assert.equal(D.comentarioDoTexto("Comentario - ligar amanhã"), "ligar amanhã");
  assert.equal(D.comentarioDoTexto("comentar o sócio vai viajar"), "o sócio vai viajar");
  assert.equal(D.comentarioDoTexto("Comentário, o cliente pediu urgência"), "o cliente pediu urgência");
  assert.equal(D.comentarioDoTexto("comentário"), "");
  assert.equal(D.comentarioDoTexto("comentarios do contrato"), null);
  assert.equal(D.comentarioDoTexto("alteração de endereço"), null);
});

test("comentário antes de o pedido existir fica guardado e vai junto quando ele é enviado", () => {
  const r = conversa(["menu", "2", "12.345.678/0001-95", "5", "comentário: cliente quer protocolar até sexta"]);
  assert.equal(r.ultimo.acao, null);
  assert.equal(r.estado.comentarios.length, 1);
  assert.equal(r.estado.comentarios[0].texto, "cliente quer protocolar até sexta");
  assert.equal(r.estado.comentarios[0].por, "Raoni");
  assert.match(r.saidas[4], /Comentário guardado/);
  assert.match(r.saidas[4], /documentação/);              // e repete a pergunta que estava valendo
  assert.equal(r.estado.respostas._notas, undefined);   // não vira anotação do pedido
  const fim = conversa(["enviar"], r.estado);
  assert.equal(fim.ultimo.acao, "criar_solicitacao");
  assert.equal(fim.ultimo.dados.comentarios.length, 1);
  assert.deepEqual(fim.estado.comentarios, []);
});

test("comentário com processo no Atos sai na hora (acao comentar)", () => {
  const base = D.novoEstado({ remetenteNome: "Hesley", solicId: "WABC", empresa: "X LTDA" });
  const r = conversa(["comentario o cliente mandou o IPTU pelo e-mail"], base);
  assert.equal(r.ultimo.acao, "comentar");
  assert.equal(r.ultimo.comentario.texto, "o cliente mandou o IPTU pelo e-mail");
  assert.equal(r.ultimo.comentario.por, "Hesley");
  assert.ok(r.ultimo.comentario.id);
  assert.equal((r.estado.comentarios || []).length, 0);
});

test("'comentário' sozinho: a próxima mensagem é o comentário; comando continua sendo comando", () => {
  const base = D.novoEstado({ remetenteNome: "Hesley", solicId: "WABC" });
  const r = conversa(["comentário", "o sócio só assina na segunda"], base);
  assert.match(r.saidas[0], /próxima mensagem/);
  assert.equal(r.ultimo.acao, "comentar");
  assert.equal(r.ultimo.comentario.texto, "o sócio só assina na segunda");
  const c = conversa(["comentário", "menu"], D.novoEstado());
  assert.notEqual(c.ultimo.acao, "comentar");
  assert.equal(c.estado.aguardandoComentario, false);
});

test("legenda de arquivo nunca é comentário", () => {
  const r = conversa(["1", { texto: "comentário: RG do João", midia: { nome: "rg.jpg", tipo: "image/jpeg", caminho: "c", url: "u" } }]);
  assert.equal((r.estado.comentarios || []).length, 0);
});

test("cancelar o pedido descarta os comentários guardados dele", () => {
  const r = conversa(["1", "comentário: teste", "cancelar", "1"]);
  assert.deepEqual(r.estado.comentarios, []);
});

test("pausar e ativar: comandos e estado da pausa", () => {
  for (const t of ["pausar", "Pausar.", "pausa", "pausar robô", "PAUSAR O ROBO"]) assert.equal(D.comandoPausa(t), "pausar", t);
  for (const t of ["ativar", "Ativar!", "ativar o robô", "retomar"]) assert.equal(D.comandoPausa(t), "ativar", t);
  for (const t of ["voltar", "#ativar-atos 123456", "pausar a alteração do contrato", "ok"]) assert.equal(D.comandoPausa(t), null, t);
  const agora = Date.now();
  assert.equal(D.pausado({ pausaAte: agora + 1000 }, agora), true);
  assert.equal(D.pausado({ pausaAte: agora - 1 }, agora), false);
  assert.equal(D.pausado({}, agora), false);
  assert.equal(D.PAUSA_MS, 5 * 60000);
});

test("ajuda e menu mostram os comandos novos", () => {
  assert.match(D.menuTexto({}), /comentário/);
  assert.match(D.menuTexto({}), /pausar/);
});

// ─── pedido do Raoni (18/11/2026): descrição perdida ou escondida e autor errado ───
const arq = (nome) => ({ nome, tipo: "application/pdf", caminho: "whatsapp/g/" + nome, url: "u", tamanho: 1000 });

test("quem fez o pedido é quem começou; quem mandou 'enviar' entra como participante", () => {
  let e = D.novoEstado();
  e = D.receber(e, { texto: "Dar baixa na filial da ITN em riachoelo", remetenteNome: "Raoni" }).estado;
  const r = D.receber(e, { texto: "enviar", remetenteNome: "Hesley" });
  assert.equal(r.acao, "criar_solicitacao");
  assert.equal(r.dados.solicitante, "Raoni");
  assert.deepEqual(r.dados.participantes, ["Raoni", "Hesley"]);
  assert.match(r.dados.obs, /feito por Raoni \(com Hesley\)/);
  // a descrição abre a observação e o pedido
  assert.match(r.dados.obs, /^📝 Dar baixa na filial da ITN em riachoelo\n/);
  assert.match(r.dados.pedidoTexto, /^Dar baixa na filial da ITN em riachoelo — /);
  // o próximo pedido começa sem os participantes do anterior
  assert.deepEqual(r.estado.participantes, []);
});

test("texto escrito enquanto o robô pergunta o tipo do arquivo não se perde", () => {
  let e = D.novoEstado({ remetenteNome: "Raoni" });
  e = D.receber(e, { texto: "", midia: arq("Safari.pdf") }).estado;
  assert.equal(e.arquivosPendentes.length, 1);
  // frase que não é tipo de documento: anotação, e pergunta de novo
  let r = D.receber(e, { texto: "o cliente está com pressa nesse caso" });
  assert.match(r.mensagens.join("\n"), /Anotado/);
  assert.match(r.mensagens.join("\n"), /que documento é/);
  assert.equal(r.estado.arquivosPendentes.length, 1);
  assert.deepEqual(r.estado.respostas._notas, ["o cliente está com pressa nesse caso"]);
  // frase que descreve um pedido: escolhe o pedido e continua perguntando o tipo do arquivo
  r = D.receber(e, { texto: "baixa da empresa do João" });
  assert.equal(r.estado.fluxo, "fechar");
  assert.match(r.mensagens.join("\n"), /que documento é/);
  assert.deepEqual(r.estado.respostas._notas, ["baixa da empresa do João"]);
  const f = D.receber(r.estado, { texto: "contrato social" });
  assert.equal(f.estado.arquivosPendentes.length, 0);
  assert.equal(f.estado.respostas["_arq.docs"].length, 1);   // entrou na documentação do pedido
  assert.match(f.mensagens.join("\n"), /CNPJ/);
});

// ─── 18/11/2026 (tarde): a mensagem do cliente sobre CNAE, encaminhada pelo Raoni, foi descartada ───
test("parser: mensagem encaminhada é marcada (contextInfo no nível de data, como na Evolution 2.3.7)", () => {
  const P = require("../parser");
  const base = { event: "messages.upsert", data: { key: { remoteJid: "1203@g.us", id: "X1", participant: "1@lid", fromMe: false }, pushName: "Raoni",
    message: { conversation: "Porque aí coloco o CNAE\nASSISTENTE SOCIAL" }, messageTimestamp: 1795000783 } };
  assert.equal(P.normalizarEvento(base).encaminhada, false);
  const enc = JSON.parse(JSON.stringify(base)); enc.data.contextInfo = { isForwarded: true, forwardingScore: 1 };
  assert.equal(P.normalizarEvento(enc).encaminhada, true);
  const ext = JSON.parse(JSON.stringify(base)); ext.data.message = { extendedTextMessage: { text: "oi", contextInfo: { isForwarded: true } } };
  assert.equal(P.normalizarEvento(ext).encaminhada, true);
});

test("encaminhada vira comentário marcado, mesmo com arquivo esperando o tipo (o caso real)", () => {
  let e = D.novoEstado();
  e = D.receber(e, { texto: "4", remetenteNome: "Raoni" }).estado;
  e = D.receber(e, { texto: "", midia: arq("Safari.pdf"), remetenteNome: "Raoni" }).estado;
  assert.equal(e.arquivosPendentes.length, 1);
  const r = D.receber(e, { texto: "Porque aí coloco o CNAE\nASSISTENTE SOCIAL", remetenteNome: "Raoni", encaminhada: true });
  assert.equal(r.estado.comentarios.length, 1);
  assert.match(r.estado.comentarios[0].texto, /^↪️ Mensagem encaminhada:\nPorque aí coloco o CNAE/);
  assert.equal(r.estado.comentarios[0].por, "Raoni");
  assert.equal(r.estado.comentarios[0].encaminhada, true);
  assert.equal(r.estado.arquivosPendentes.length, 1);   // o arquivo continua esperando o tipo
  // com processo no Atos, sai na hora
  const s = D.receber(D.novoEstado({ solicId: "W1" }), { texto: "cnae 8299-7/99", remetenteNome: "Raoni", encaminhada: true });
  assert.equal(s.acao, "comentar"); assert.match(s.comentario.texto, /encaminhada/);
});

test("depois do pedido enviado, frase solta é pedido novo; o arquivo sem tipo que sobrou vai para o enviado", () => {
  const e = D.novoEstado({ remetenteNome: "Raoni", solicId: "W1", fluxo: "outro", respostas: { confirmar: "sim" }, arquivosPendentes: [arq("x.pdf")] });
  let r = D.receber(e, { texto: "O contato é o de Marina", remetenteNome: "Raoni" });
  assert.notEqual(r.acao, "comentar");
  assert.equal(r.anexarEm, "W1"); assert.equal(r.anexar.length, 1);
  assert.deepEqual(r.estado.respostas._notas, ["O contato é o de Marina"]);
  assert.equal(r.estado.solicId, ""); assert.equal(r.estado.solicAnterior, "W1");
  // "comentário: …" continua indo para o enviado
  r = D.receber(Object.assign(D.novoEstado({ solicId: "W1", fluxo: "outro" }), { respostas: { confirmar: "sim" } }), { texto: "comentário: cliente ligou agora há pouco", remetenteNome: "Hesley" });
  assert.equal(r.acao, "comentar");
  // "obrigado" depois do envio: nada
  r = D.receber(Object.assign(D.novoEstado({ solicId: "W1", fluxo: "outro" }), { respostas: { confirmar: "sim" } }), { texto: "Obrigado!", remetenteNome: "Hesley" });
  assert.equal(r.mensagens.length, 0); assert.equal(r.estado.solicId, "W1");
});
