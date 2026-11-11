// node --test — o diálogo é função pura: aqui ele é conversado de ponta a ponta, sem rede nem banco.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dialogo");
const P = require("../parser");

const arq = (nome) => ({ nome, tipo: "application/pdf", caminho: "whatsapp/g/" + nome, url: "u", tamanho: 1000 });
function conversa(linhas, estadoInicial) {
  let estado = estadoInicial || D.novoEstado({ remetenteNome: "Carla Comercial" });
  const saidas = []; let ultimo = null;
  for (const l of linhas) {
    const entrada = typeof l === "string" ? { texto: l } : l;
    ultimo = D.receber(estado, entrada); estado = ultimo.estado; saidas.push(ultimo.mensagens.join("\n"));
  }
  return { estado, saidas, ultimo };
}

test("primeira mensagem: aviso de LGPD e menu numerado, falando com a equipe", () => {
  const { saidas, estado } = conversa(["oi"]);
  assert.match(saidas[0], /LGPD/);
  assert.match(saidas[0], /Qual é o pedido\?/);
  assert.match(saidas[0], /\*1\* — Abrir uma empresa/);
  assert.ok(estado.lgpdEm);
});

test("nenhum texto do robô fala com cliente (você, seu nome, equipe vai falar com você)", () => {
  const textos = [D.LGPD, D.menuTexto({}), D.menuTexto({ empresa: "X LTDA", cnpj: "00000000000191" })];
  const r = { oQueMuda: ["endereco", "socios"] };
  Object.values(D.FLUXOS).forEach((f) => f.passos.forEach((p) => textos.push(typeof p.pergunta === "function" ? p.pergunta(r) : p.pergunta)));
  for (const t of textos) assert.doesNotMatch(t, /\bvocê\b|\bseu nome\b|\bsua empresa\b|contando você|com suas palavras/i, t);
});

test("cada pedido começa pela documentação (abrir e advocacia) ou logo depois do CNPJ", () => {
  for (const k of ["abrir", "advocacia"]) assert.equal(D.FLUXOS[k].passos[0].tipo, "arquivo", k);
  for (const k of ["fechar", "transformar"]) { assert.equal(D.FLUXOS[k].passos[0].id, "cnpj"); assert.equal(D.FLUXOS[k].passos[1].tipo, "arquivo", k); }
  const r = conversa(["1"]);
  assert.match(r.saidas[0], /Mande a \*documentação\*/);
  assert.match(r.saidas[0], /legenda/);
  assert.doesNotMatch(r.saidas[0], /nome/i);
});

test("fluxo 'fechar' de ponta a ponta: validações, documentação, resumo, confirmação e solicitação", () => {
  const { saidas, ultimo } = conversa([
    "menu", "3",                        // Fechar empresa
    "11.111.111/1111-11",               // CNPJ inválido
    "00.000.000/0001-91",               // CNPJ válido
    { texto: "", midia: arq("contrato.pdf") },   // o nome do arquivo já diz o que é
    "ok",
    "31/02/2026",                       // data inválida
    "30/06/2026",
    "José da Silva",                    // livros
    "9",                                // opção fora da lista
    "1",                                // débitos: não
    "Maria Souza",                      // nome do cliente
    "79 99999-0000",                    // telefone do cliente
    "não",                              // prazo
    "pular",                            // obs
    "1",                                // confirmar
  ]);
  assert.match(saidas[2], /CNPJ não confere/);
  assert.match(saidas[3], /documentação/);
  assert.match(saidas[4], /Contrato social ou alteração ✓/);
  assert.match(saidas[6], /dd\/mm\/aaaa/);
  assert.match(saidas[9], /número/);
  assert.match(saidas[10], /Nome do \*cliente\*/);
  assert.match(saidas[14], /Está tudo certo\?/);
  assert.match(saidas[15], /já está no Atos/);
  assert.equal(ultimo.acao, "criar_solicitacao");
  const s = ultimo.dados;
  assert.equal(s.tipo, "dist_ltda"); assert.deepEqual(s.pedidos, ["fechar"]);
  assert.equal(s.cnpj, "00.000.000/0001-91"); assert.equal(s.fone, "79999990000"); assert.equal(s.contato, "Maria Souza");
  assert.equal(s.solicitante, "Carla Comercial"); assert.match(s.obs, /feito por Carla Comercial/);
  assert.ok(s.docsOk.includes("contrato") && s.docsOk.includes("fechar"));
  assert.equal(s.anexos.length, 1); assert.equal(s.anexos[0].nome, "Contrato social ou alteração — contrato.pdf"); assert.equal(s.anexos[0].doc, "contrato");
  assert.match(s.obs, /Quem vai guardar os livros/);
});

test("abertura: documentação primeiro, sócio sem nascimento nem endereço, CPF validado e 'voltar'", () => {
  const r = conversa(["1", { texto: "RG da Ana", midia: arq("IMG-001.jpg") }, "ok", "Padaria Boa", "padaria e lanchonete", "Itabaiana/SE", "49500-000", "100", "pular", "2",
    "Ana Lima", "123.456.789-00", "111.444.777-35", "1", "padeira", "pular", "voltar"]);
  assert.match(r.saidas[1], /RG ou CNH \(RG da Ana\) ✓/);
  assert.match(r.saidas[2], /\*Nome\* pretendido/);
  assert.match(r.saidas[9], /1º sócio\*: nome completo/);
  assert.match(r.saidas[11], /CPF não confere/);
  assert.match(r.saidas[12], /Estado civil/);
  assert.match(r.saidas[15], /2º sócio/);
  assert.match(r.saidas[16], /Voltei uma pergunta/);
  const ids = D.passosAtivos(r.estado).map((p) => p.id);
  assert.ok(!ids.some((i) => /^s\d+\.(nasc|cep|endNum|docs)$/.test(i)));
  assert.equal(r.estado.respostas["s1.cpf"], "111.444.777-35");
  assert.equal(r.estado.respostas.docs.length, 1);
});

test("alterar: CNPJ pré-preenchido pelo vínculo; a documentação pede o que a mudança exige", () => {
  const est = D.novoEstado({ empresa: "COMERCIAL MODELO LTDA", cnpj: "00000000000191" });
  const r = conversa(["oi", "2", "1,2", "ok"], est);
  assert.match(r.saidas[0], /ligada a \*COMERCIAL MODELO LTDA\*/);
  assert.equal(r.estado.respostas.cnpj, "00.000.000/0001-91");
  assert.deepEqual(r.estado.respostas.oQueMuda, ["endereco", "socios"]);
  assert.match(r.saidas[2], /contrato social ou alteração/);
  assert.match(r.saidas[2], /quem entra/);
  assert.match(r.saidas[2], /novo endereço/);
  assert.match(r.saidas[3], /CEP do \*novo\* endereço/);
});

test("corrigir um item depois do resumo; 'equipe' e '0' não existem", () => {
  const r = conversa(["6", "pular", "preciso regularizar a empresa", "ok", "Bia", "pular", "não", "não", "2", "4", "Beatriz", "1"]);
  assert.match(r.saidas[3], /Sem documentos por enquanto/);
  assert.match(r.saidas[8], /Qual item quer corrigir/);
  assert.match(r.saidas[9], /Nome do \*cliente\*/);
  assert.equal(r.ultimo.acao, "criar_solicitacao");
  assert.equal(r.ultimo.dados.contato, "Beatriz");
  const h = conversa(["0"]);
  assert.notEqual(h.ultimo.acao, "humano");
  assert.doesNotMatch(h.saidas.join("\n"), /\*0\*|\*equipe\*|Falar com uma pessoa/);
});

test("cancelar e recomeçar pedem confirmação e apagam os arquivos do pedido", () => {
  const r = conversa(["1", { midia: arq("cnh.pdf") }, "cancelar", "2", "menu", "1"]);
  assert.match(r.saidas[2], /Confirma\?/);
  assert.match(r.saidas[3], /Seguimos/);
  assert.match(r.saidas[4], /Recomeçar apaga/);
  assert.equal(r.estado.fluxo, null);
  assert.equal(r.ultimo.descartar.length, 1); assert.equal(r.ultimo.descartar[0].caminho, "whatsapp/g/cnh.pdf");
});

test("classificarDoc: entende legenda, nome de arquivo e mensagem", () => {
  const c = D.classificarDoc;
  assert.equal(c("RG do João"), "rg"); assert.equal(c("cnh.pdf"), "rg"); assert.equal(c("Habilitação da Maria"), "rg");
  assert.equal(c("comprovante de residência"), "residencia"); assert.equal(c("conta de luz da Maria"), "residencia");
  assert.equal(c("comprovante da empresa"), "endereco"); assert.equal(c("contrato de locação"), "endereco"); assert.equal(c("conta de água da loja"), "endereco");
  assert.equal(c("IPTU"), "iptu"); assert.equal(c("contrato_social.pdf"), "contrato"); assert.equal(c("última alteração"), "contrato");
  assert.equal(c("CCMEI"), "ccmei"); assert.equal(c("carteira da OAB"), "oab");
  assert.equal(c("documentos da Maria"), "pessoais"); assert.equal(c("RG e comprovante do João"), "pessoais");
  assert.equal(c("foto.jpg"), null); assert.equal(c("comprovante"), null); assert.equal(c("contrato social e IPTU"), null); assert.equal(c(""), null);
});

test("parser: evento da Evolution vira mensagem; status e fromMe são ignorados; legenda vem como texto", () => {
  const ev = P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "5579999990000@s.whatsapp.net", fromMe: false, id: "ABC" }, pushName: "Maria", message: { conversation: "Vincular 123456" }, messageTimestamp: 1760000000 } });
  assert.equal(ev.evento, "mensagem"); assert.equal(ev.grupo, false); assert.equal(ev.remetenteTel, "5579999990000"); assert.equal(ev.codigoVinculo, "123456");
  assert.equal(P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "status@broadcast", id: "x" }, message: { conversation: "a" } } }).evento, "ignorado");
  assert.equal(P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "x@g.us", fromMe: true, id: "x" }, message: { conversation: "a" } } }).evento, "ignorado");
  const g = P.normalizarEvento({ event: "MESSAGES_UPSERT", data: { key: { remoteJid: "1203@g.us", fromMe: false, id: "Z", participant: "5579988887777@s.whatsapp.net" }, message: { imageMessage: { mimetype: "image/jpeg", caption: "RG do João" } } } });
  assert.equal(g.grupo, true); assert.equal(g.tipo, "imagem"); assert.equal(g.temMidia, true); assert.equal(g.remetenteTel, "5579988887777");
  assert.equal(g.texto, "RG do João");
  // a mensagem inteira vai junto para o download (a Evolution não guarda mensagens: só a chave dá "Message not found")
  assert.deepEqual(g.mensagemBruta, { imageMessage: { mimetype: "image/jpeg", caption: "RG do João" } });
  const doc = P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "1203@g.us", id: "D", participant: "5579988887777@s.whatsapp.net" },
    message: { documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "contrato.pdf", caption: "contrato social" } } } } } });
  assert.equal(doc.tipo, "documento"); assert.equal(doc.texto, "contrato social"); assert.equal(doc.midiaNome, "contrato.pdf"); assert.ok(doc.mensagemBruta.documentWithCaptionMessage);
  assert.equal(P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "1203@g.us", id: "T" }, message: { conversation: "oi" } } }).mensagemBruta, null);
});
