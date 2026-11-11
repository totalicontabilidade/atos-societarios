// node --test — o diálogo é função pura: aqui ele é conversado de ponta a ponta, sem rede nem banco.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dialogo");
const P = require("../parser");

function conversa(linhas, estadoInicial) {
  let estado = estadoInicial || D.novoEstado();
  const saidas = []; let ultimo = null;
  for (const l of linhas) {
    const entrada = typeof l === "string" ? { texto: l } : l;
    ultimo = D.receber(estado, entrada); estado = ultimo.estado; saidas.push(ultimo.mensagens.join("\n"));
  }
  return { estado, saidas, ultimo };
}

test("primeira mensagem: aviso de LGPD e menu numerado", () => {
  const { saidas, estado } = conversa(["oi"]);
  assert.match(saidas[0], /LGPD/);
  assert.match(saidas[0], /\*1\* — Abrir uma empresa/);
  assert.ok(estado.lgpdEm);
});

test("fluxo 'fechar' de ponta a ponta: validações, arquivo, resumo, confirmação e solicitação", () => {
  const { saidas, ultimo } = conversa([
    "menu", "3",                       // Fechar empresa
    "Maria Souza",                      // contatoNome
    "este",                             // contatoFone (usa o do remetente)
    "11.111.111/1111-11",               // CNPJ inválido
    "00.000.000/0001-91",               // CNPJ válido
    "31/02/2026",                       // data inválida
    "30/06/2026",
    "José da Silva",                    // livros
    "9",                                // opção fora da lista
    "1",                                // débitos: não
    "texto em vez de arquivo",
    { texto: "", midia: { nome: "contrato.pdf", mime: "application/pdf", caminho: "x/contrato.pdf", url: "u", tamanho: 1000 } },
    "ok",
    "não",                              // prazo (opcional)
    "pular",                            // obs
    "1",                                // confirmar
  ], D.novoEstado({ remetenteTel: "5579999990000" }));
  assert.match(saidas[4], /CNPJ não confere/);
  assert.match(saidas[6], /dd\/mm\/aaaa/);
  assert.match(saidas[9], /número/);
  assert.match(saidas[11], /espero um \*arquivo\*/);
  assert.match(saidas[12], /Recebi \*contrato.pdf\*/);
  assert.match(saidas[13], /data limite/);
  assert.match(saidas[15], /Está tudo certo\?/);
  assert.equal(ultimo.acao, "criar_solicitacao");
  const s = ultimo.dados;
  assert.equal(s.tipo, "dist_ltda"); assert.deepEqual(s.pedidos, ["fechar"]);
  assert.equal(s.cnpj, "00.000.000/0001-91"); assert.equal(s.fone, "5579999990000"); assert.equal(s.contato, "Maria Souza");
  assert.ok(s.docsOk.includes("contrato") && s.docsOk.includes("fechar"));
  assert.equal(s.anexos.length, 1); assert.equal(s.anexos[0].nome, "Contrato social / CCMEI — contrato.pdf"); assert.equal(s.anexos[0].doc, "contrato");
  assert.match(s.obs, /Quem vai guardar os livros/);
});

test("abertura com dois sócios: o bloco de sócio repete, o CPF é validado e 'voltar' refaz a pergunta", () => {
  const r = conversa(["1", "Ana", "pular", "Padaria Boa", "padaria e lanchonete", "Aracaju/SE", "49010-000", "100", "pular", "pular", "2",
    "Ana Lima", "123.456.789-00", "111.444.777-35", "01/01/1990", "1", "padeira", "49010000", "10", "pular", "pular",
    "voltar"]);
  assert.match(r.saidas[12], /CPF não confere/);
  assert.match(r.saidas[13], /nascimento/);
  assert.match(r.saidas[20], /2º sócio/);
  assert.match(r.saidas[21], /Voltei uma pergunta/);
  assert.equal(r.estado.respostas["s1.docs"], undefined);
  assert.equal(r.estado.respostas["s1.cpf"], "111.444.777-35");
});

test("alterar: CNPJ pré-preenchido pelo vínculo, multi-escolha e perguntas condicionais", () => {
  const est = D.novoEstado({ empresa: "COMERCIAL MODELO LTDA", cnpj: "00000000000191" });
  const r = conversa(["oi", "2", "Carlos", "este", "1,4"], est);
  assert.match(r.saidas[0], /ligado a \*COMERCIAL MODELO LTDA\*/);
  assert.equal(r.estado.respostas.cnpj, "00.000.000/0001-91");
  assert.deepEqual(r.estado.respostas.oQueMuda, ["endereco", "capital"]);
  assert.match(r.saidas[4], /CEP do \*novo\* endereço/);
  const ativos = D.passosAtivos(r.estado).map((p) => p.id);
  assert.ok(ativos.includes("novoCapital") && !ativos.includes("novoNome") && !ativos.includes("socioMov"));
});

test("corrigir um item depois do resumo; 'equipe' e '0' não existem mais", () => {
  const r = conversa(["6", "Bia", "este", "pular", "preciso regularizar a empresa", "ok", "não", "não", "2", "1", "Beatriz", "1"]);
  assert.match(r.saidas[8], /Qual item quer corrigir/);
  assert.match(r.saidas[9], /seu nome/);
  assert.equal(r.ultimo.acao, "criar_solicitacao");
  assert.equal(r.ultimo.dados.contato, "Beatriz");
  const h = conversa(["0"]);
  assert.notEqual(h.ultimo.acao, "humano");
  assert.doesNotMatch(h.saidas.join("\n"), /\*0\*|\*equipe\*|Falar com uma pessoa/);
  const e = conversa(["1", "Zé", "equipe"]);
  assert.notEqual(e.ultimo.acao, "humano");
});

test("cancelar pede confirmação; recomeçar com respostas pede confirmação", () => {
  const r = conversa(["1", "Ana", "cancelar", "2", "menu", "1"]);
  assert.match(r.saidas[2], /Confirma\?/);
  assert.match(r.saidas[3], /Seguimos/);
  assert.match(r.saidas[4], /Recomeçar apaga/);
  assert.equal(r.estado.fluxo, null);
});

test("parser: evento da Evolution vira mensagem; privado é atendido, status e fromMe são ignorados; #vincular é lido", () => {
  const ev = P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "5579999990000@s.whatsapp.net", fromMe: false, id: "ABC" }, pushName: "Maria", message: { conversation: "Vincular 123456" }, messageTimestamp: 1760000000 } });
  assert.equal(ev.evento, "mensagem"); assert.equal(ev.grupo, false); assert.equal(ev.remetenteTel, "5579999990000"); assert.equal(ev.codigoVinculo, "123456");
  assert.equal(P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "status@broadcast", id: "x" }, message: { conversation: "a" } } }).evento, "ignorado");
  assert.equal(P.normalizarEvento({ event: "messages.upsert", data: { key: { remoteJid: "x@g.us", fromMe: true, id: "x" }, message: { conversation: "a" } } }).evento, "ignorado");
  const g = P.normalizarEvento({ event: "MESSAGES_UPSERT", data: { key: { remoteJid: "1203@g.us", fromMe: false, id: "Z", participant: "5579988887777@s.whatsapp.net" }, message: { imageMessage: { mimetype: "image/jpeg", caption: "" } } } });
  assert.equal(g.grupo, true); assert.equal(g.tipo, "imagem"); assert.equal(g.temMidia, true); assert.equal(g.remetenteTel, "5579988887777");
});
