// node --test — arquivo que chega fora da hora: o robô pergunta que documento é (v1.74).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dialogo");

const arq = (nome) => ({ nome, tipo: "application/pdf", caminho: "whatsapp/g/" + nome, url: "u", tamanho: 1000 });
function conversa(linhas, estadoInicial) {
  let estado = estadoInicial || D.novoEstado({ lgpdEm: "x" }); const saidas = []; let ultimo = null;
  for (const l of linhas) { ultimo = D.receber(estado, typeof l === "string" ? { texto: l } : l); estado = ultimo.estado; saidas.push(ultimo.mensagens.join("\n")); }
  return { estado, saidas, ultimo };
}

test("arquivo no meio de uma pergunta de texto: pergunta o tipo e depois repete a pergunta", () => {
  const r = conversa(["1", "Ana", { midia: arq("rg.pdf") }, "1"]);
  assert.match(r.saidas[2], /Recebi \*rg\.pdf\*\. Que documento é esse\?/);
  assert.match(r.saidas[2], /\*1\* — RG ou CNH/);
  assert.match(r.saidas[3], /guardado como RG ou CNH/);
  assert.match(r.saidas[3], /telefone/i);                      // voltou para a pergunta em que estava
  const av = r.estado.respostas["_arq.avulsos"];
  assert.equal(av.length, 1); assert.equal(av[0].doc, "pessoas"); assert.equal(av[0].nome, "RG ou CNH — rg.pdf");
});

test("resposta que não é número do tipo: pergunta de novo, sem perder o arquivo", () => {
  const r = conversa(["1", { midia: arq("x.pdf") }, "Ana"]);
  assert.match(r.saidas[2], /Responda com o \*número\* do tipo/);
  assert.equal(r.estado.arquivosPendentes.length, 1);
});

test("vários arquivos seguidos: pergunta um de cada vez", () => {
  const r = conversa(["1", { midia: arq("a.pdf") }, { midia: arq("b.pdf") }, "6", "4"]);
  assert.match(r.saidas[2], /Recebi também \*b\.pdf\*/);
  assert.match(r.saidas[3], /a\.pdf\* guardado como Contrato social/);
  assert.match(r.saidas[3], /Recebi \*b\.pdf\*\. Que documento é esse\?/);
  assert.match(r.saidas[4], /b\.pdf\* guardado como Comprovante do endereço da empresa/);
  assert.deepEqual(r.estado.respostas["_arq.avulsos"].map((a) => a.doc), ["contrato", "endereco"]);
});

test("mandei por engano: o arquivo sai para ser apagado", () => {
  const r = conversa(["1", { midia: arq("foto.jpg") }, "10"]);
  assert.match(r.saidas[2], /Descartei \*foto\.jpg\*/);
  assert.equal(r.ultimo.descartar.length, 1); assert.equal(r.ultimo.descartar[0].caminho, "whatsapp/g/foto.jpg");
  assert.equal((r.estado.respostas["_arq.avulsos"] || []).length, 0);
});

test("arquivo antes de escolher o pedido: pergunta o tipo e depois mostra o menu", () => {
  const r = conversa([{ midia: arq("cnh.pdf") }, "1"]);
  assert.match(r.saidas[0], /Que documento é esse\?/);
  assert.match(r.saidas[1], /O que você precisa\?/);
});

test("arquivo depois do pedido enviado: é juntado à solicitação já criada", () => {
  const r = conversa(["6", "Bia", "este", "pular", "regularizar", "ok", "não", "não", "1", { midia: arq("iptu.pdf") }, "5"], D.novoEstado({ lgpdEm: "x", remetenteTel: "5579" }));
  assert.equal(r.estado.respostas.confirmar, "sim");
  assert.equal(r.ultimo.acao, "anexar");
  assert.equal(r.ultimo.anexar[0].doc, "iptu"); assert.match(r.ultimo.anexar[0].nome, /^Carnê ou inscrição do IPTU — iptu\.pdf$/);
  assert.match(r.saidas[10], /juntado ao pedido já enviado/);
});

test("anexos pedidos na pergunta de documento saem com o rótulo e o nome do sócio", () => {
  const passos = ["1", "Ana", "pular", "Padaria Boa", "padaria", "Aracaju/SE", "49010000", "100", "pular", "pular", "1",
    "Ana Lima", "111.444.777-35", "01/01/1990", "1", "padeira", "49010000", "10", "pular", { midia: arq("cnh.pdf") }, "ok"];
  const r = conversa(passos);
  const s = D.montarSolicitacao(r.estado);
  const a = s.anexos.find((x) => x.passo === "s1.docs");
  assert.equal(a.nome, "Documentos pessoais de Ana Lima — cnh.pdf"); assert.equal(a.doc, "pessoas");
});

test("pedido novo no mesmo grupo depois de um enviado não herda o processo anterior", () => {
  const est = D.novoEstado({ lgpdEm: "x", solicId: "S123", empresa: "EMPRESA A", cnpj: "00000000000191", vinculo: { codigo: "1" } });
  const r = conversa(["6", "Bia", "este", "pular", "regularizar", "ok", "não", "não", "1", "menu", "6"], est);
  assert.equal(r.estado.solicId, ""); assert.equal(r.estado.empresa, ""); assert.equal(r.estado.vinculo, null);
  assert.match(r.saidas[9], /O que você precisa\?/);       // "menu" depois de enviado não pede confirmação
});
