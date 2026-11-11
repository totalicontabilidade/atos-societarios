// node --test — arquivos: a documentação entende o que é cada arquivo (legenda, nome, mensagem);
// o que não der para saber, o robô pergunta.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dialogo");

const arq = (nome) => ({ nome, tipo: "application/pdf", caminho: "whatsapp/g/" + nome, url: "u", tamanho: 1000 });
const com = (legenda, nome) => ({ texto: legenda, midia: arq(nome) });
function conversa(linhas, estadoInicial) {
  let estado = estadoInicial || D.novoEstado({ lgpdEm: "x" }); const saidas = []; let ultimo = null;
  for (const l of linhas) { ultimo = D.receber(estado, typeof l === "string" ? { texto: l } : l); estado = ultimo.estado; saidas.push(ultimo.mensagens.join("\n")); }
  return { estado, saidas, ultimo };
}

test("documentação: lote sem legenda + mensagem depois; o que sobrar é perguntado no fim", () => {
  const r = conversa(["1", { midia: arq("a.jpg") }, { midia: arq("b.jpg") }, "documentos da Ana", { midia: arq("c.jpg") }, "ok", "5"]);
  assert.match(r.saidas[1], /Ainda não sei o que é/);
  assert.match(r.saidas[3], /2 arquivos marcados como \*Documentos pessoais de sócio\*/);
  assert.match(r.saidas[5], /Falta dizer o que é 1 arquivo/);
  assert.match(r.saidas[5], /\*c\.jpg\*: que documento é\?/);
  assert.match(r.saidas[6], /Comprovante do endereço da empresa: guardado/);
  assert.match(r.saidas[6], /\*Nome\* pretendido/);                 // seguiu para a próxima pergunta
  assert.deepEqual(r.estado.respostas.docs.map((a) => a.doc), ["pessoas", "pessoas", "endereco"]);
  assert.equal(r.estado.respostas.docs[0].legenda, "documentos da Ana");
  assert.equal(r.estado.arquivosPendentes.length, 0);
});

test("documentação: mensagem antes vale para os próximos arquivos; legenda manda mais que a mensagem", () => {
  const r = conversa(["1", "RG do João", { midia: arq("a.jpg") }, com("comprovante do João", "b.jpg"), "ok"]);
  assert.match(r.saidas[1], /próximos arquivos sem legenda entram como \*RG ou CNH\*/);
  assert.match(r.saidas[2], /RG ou CNH \(RG do João\) ✓/);
  assert.match(r.saidas[3], /Comprovante de residência de sócio \(comprovante do João\) ✓/);
  const s = D.montarSolicitacao(r.estado);
  assert.equal(s.anexos[0].nome, "RG ou CNH — RG do João · a.jpg"); assert.equal(s.anexos[0].passo, "docs");
  assert.ok(s.docsOk.includes("pessoas"));
});

test("documentação: texto sem tipo não é erro; 'voltar' depois do ok devolve os arquivos", () => {
  const r = conversa(["1", "segue", { midia: arq("cnh.pdf") }, "ok", "voltar"]);
  assert.match(r.saidas[1], /Pode mandar os arquivos/);
  assert.match(r.saidas[4], /Voltei para a documentação\. 1 arquivo/);
  assert.equal(r.estado.respostas["_arq.docs"].length, 1);
});

test("arquivo sem legenda no meio de uma pergunta de texto: pergunta o tipo e repete a pergunta", () => {
  const r = conversa(["1", "ok", { midia: arq("x.jpg") }, "1"]);
  assert.match(r.saidas[2], /\*x\.jpg\*: que documento é\?/);
  assert.match(r.saidas[2], /\*1\* — RG ou CNH/);
  assert.match(r.saidas[3], /RG ou CNH: guardado/);
  assert.match(r.saidas[3], /\*Nome\* pretendido/);
  const av = r.estado.respostas["_arq.avulsos"];
  assert.equal(av.length, 1); assert.equal(av[0].doc, "pessoas"); assert.equal(av[0].nome, "RG ou CNH — x.jpg");
});

test("arquivo com legenda fora da documentação: entende sem perguntar", () => {
  const r = conversa(["1", "ok", com("contrato social", "a.jpg")]);
  assert.match(r.saidas[2], /Contrato social, alteração, estatuto ou ata \(contrato social\): guardado/);
  assert.doesNotMatch(r.saidas[2], /que documento é/);
  assert.equal(r.estado.arquivosPendentes, undefined);
});

test("tipo respondido por escrito; resposta que não diz nada pergunta de novo sem perder o arquivo", () => {
  let r = conversa(["1", "ok", { midia: arq("x.jpg") }, "Padaria"]);
  assert.match(r.saidas[3], /Não entendi o tipo/); assert.equal(r.estado.arquivosPendentes.length, 1);
  r = conversa(["1", "ok", { midia: arq("x.jpg") }, "comprovante da Maria"]);
  const av = r.estado.respostas["_arq.avulsos"];
  assert.equal(av[0].docNome, "Comprovante de residência de sócio"); assert.equal(av[0].legenda, "comprovante da Maria");
});

test("vários arquivos seguidos fora da documentação: pergunta um de cada vez", () => {
  const r = conversa(["1", "ok", { midia: arq("a.jpg") }, { midia: arq("b.jpg") }, "7", "5"]);
  assert.match(r.saidas[3], /Recebi também \*b\.jpg\*/);
  assert.match(r.saidas[4], /Contrato social, alteração, estatuto ou ata: guardado/);
  assert.match(r.saidas[4], /\*b\.jpg\*: que documento é\?/);
  assert.match(r.saidas[5], /Comprovante do endereço da empresa: guardado/);
  assert.deepEqual(r.estado.respostas["_arq.avulsos"].map((a) => a.doc), ["contrato", "endereco"]);
});

test("mandei por engano (número ou escrito): o arquivo sai para ser apagado", () => {
  for (const resp of ["11", "mandei por engano"]) {
    const r = conversa(["1", "ok", { midia: arq("foto.jpg") }, resp]);
    assert.match(r.saidas[3], /Descartei \*foto\.jpg\*/);
    assert.equal(r.ultimo.descartar.length, 1); assert.equal(r.ultimo.descartar[0].caminho, "whatsapp/g/foto.jpg");
    assert.equal((r.estado.respostas["_arq.avulsos"] || []).length, 0);
  }
});

test("arquivo antes de escolher o pedido: pergunta o tipo, mostra o menu e o arquivo entra no pedido", () => {
  const r = conversa([{ midia: arq("foto.jpg") }, "1", "1"]);
  assert.match(r.saidas[0], /que documento é\?/);
  assert.match(r.saidas[1], /Qual é o pedido\?/);
  assert.match(r.saidas[2], /Vamos lá: \*Abrir empresa\*/);
  assert.equal(r.estado.respostas["_arq.docs"].length, 1);   // já conta na documentação do pedido
});

test("arquivo depois do pedido enviado: é juntado à solicitação já criada", () => {
  const fim = ["6", "pular", "regularizar", "ok", "pular", "1"];
  let r = conversa(fim.concat([{ midia: arq("iptu.pdf") }]));
  assert.equal(r.estado.respostas.confirmar, "sim");
  assert.equal(r.ultimo.acao, "anexar");
  assert.equal(r.ultimo.anexar[0].doc, "iptu"); assert.equal(r.ultimo.anexar[0].nome, "Carnê ou inscrição do IPTU — iptu.pdf");
  assert.match(r.saidas[6], /juntado ao pedido já enviado/);
  r = conversa(fim.concat([{ midia: arq("x.jpg") }, "6"]));
  assert.equal(r.ultimo.acao, "anexar"); assert.equal(r.ultimo.anexar[0].doc, "iptu");
});

test("pedido novo no mesmo grupo depois de um enviado não herda o processo anterior", () => {
  const est = D.novoEstado({ lgpdEm: "x", solicId: "S123", empresa: "EMPRESA A", cnpj: "00000000000191", vinculo: { codigo: "1" } });
  const r = conversa(["6", "regularizar", "ok", "pular", "1", "menu", "6"], est);
  assert.equal(r.saidas[4].includes("já está no Atos"), true);
  assert.equal(r.estado.solicId, ""); assert.equal(r.estado.empresa, ""); assert.equal(r.estado.vinculo, null);
  assert.match(r.saidas[5], /Qual é o pedido\?/);       // "menu" depois de enviado não pede confirmação
});
