// functions/dialogo.js — o "agente" do WhatsApp dos Atos: um diálogo GUIADO, sem modelo de
// linguagem. Perguntas numeradas, respostas por número ou em formato fixo, validação por código
// (CPF, CNPJ, CEP, data, telefone, e-mail, valor). Funções puras: recebem o estado e a mensagem,
// devolvem o estado novo, as respostas a mandar e, no fim, a solicitação pronta para o Atos.
//
// Quem conversa é a EQUIPE da Totali (comercial e legalização), num grupo interno: não há cliente
// na conversa (v1.75). Cada pedido começa pela documentação; o robô entende o que é cada arquivo
// pela legenda, pelo nome do arquivo ou por uma mensagem escrita antes ou depois (ex.: "RG do João").
//
// Estado: { fluxo, respostas:{id: valor}, ordem:[ids respondidos], aguardandoCorrecao, cancelando,
//           arquivosPendentes, destinoPendentes, rotuloProximo, lgpdEm, empresa, cnpj, solicId, ... }
"use strict";

const LIMITE_SOCIOS = 8;

// ─── validações ─────────────────────────────────────────────────────────────
const dig = (v) => String(v || "").replace(/\D/g, "");
function validaCPF(v) {
  const c = dig(v); if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i); let r = (s * 10) % 11; if (r === 10) r = 0; if (r !== Number(c[9])) return false;
  s = 0; for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i); r = (s * 10) % 11; if (r === 10) r = 0; return r === Number(c[10]);
}
const cnpjLimpo = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
function validaCNPJ(v) {
  const s = cnpjLimpo(v); if (s.length !== 14 || !/^[0-9]{2}$/.test(s.slice(12)) || /^(.)\1{13}$/.test(s)) return false;
  const val = (ch) => ch.charCodeAt(0) - 48;
  const calc = (len) => { const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let t = 0; for (let i = 0; i < len; i++) t += val(s[i]) * w[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(s[12]) && calc(13) === Number(s[13]);
}
const fmtCPF = (v) => dig(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
const fmtCNPJ = (v) => cnpjLimpo(v).replace(/^(..)(...)(...)(....)(..)$/, "$1.$2.$3/$4-$5");
function validaData(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || "").trim()); if (!m) return false;
  const d = new Date(+m[3], +m[2] - 1, +m[1]); return d.getFullYear() === +m[3] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] && +m[3] >= 1900 && +m[3] <= 2100;
}
function dinheiro(v) { const s = String(v || "").trim().replace(/^r\$\s*/i, "").replace(/\./g, "").replace(",", "."); const n = Number(s); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
const brl = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── que documento é? (legenda, nome do arquivo ou mensagem escrita) ─────────
// Tipo de arquivo: [chave, rótulo, documento da lista da solicitação]
const TIPOS_ARQ = [
  ["rg", "RG ou CNH", "pessoas"], ["cpf", "CPF", "pessoas"], ["residencia", "Comprovante de residência de sócio", "pessoas"],
  ["pessoais", "Documentos pessoais de sócio", "pessoas"],
  ["endereco", "Comprovante do endereço da empresa", "endereco"], ["iptu", "Carnê ou inscrição do IPTU", "iptu"],
  ["contrato", "Contrato social ou alteração", "contrato"], ["ccmei", "CCMEI ou requerimento de empresário", "contrato"],
  ["oab", "Carteira da OAB", "oab"], ["outro", "Outro documento", ""], ["descartar", "Mandei por engano (descartar)", ""],
];
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-.]+/g, " ");
// Devolve a chave do tipo, ou null quando não dá para saber (ou quando a mensagem fala de tipos
// diferentes ao mesmo tempo). "RG e comprovante do João" num arquivo só = documentos pessoais.
function classificarDoc(texto) {
  const t = " " + semAcento(texto) + " ";
  if (t.trim().length < 2) return null;
  const achou = new Set();
  if (/\boab\b|ordem dos advogados|carteira (da|de) advog/.test(t)) achou.add("oab");
  if (/\bccmei\b|certificado (do |de )?mei\b|requerimento de empresario|\bmei\b/.test(t)) achou.add("ccmei");
  const locacao = /locac|alugu/.test(t);
  if (!locacao && /contrato social|\bcontrato\b|alteracao contratual|\balteracao\b|aditivo|consolidac|\bestatuto\b/.test(t)) achou.add("contrato");
  if (/\biptu\b|\bcarne\b/.test(t)) achou.add("iptu");
  const daEmpresa = /\b(empresa|sede|loja|escritorio|ponto comercial|imovel|estabelecimento)\b/.test(t);
  if (locacao || (daEmpresa && /comprovante|\bconta\b|endereco|\bluz\b|\bagua\b|energia/.test(t))) achou.add("endereco");
  if (/\b(rg|cnh|identidade|habilitacao|carteira de motorista)\b/.test(t)) achou.add("rg");
  if (/\bcpf\b/.test(t)) achou.add("cpf");
  if (!daEmpresa && (/residenc/.test(t) || /\b(comprovante|conta)\b.*\b(do|da)\s+[a-z]{3,}/.test(t))) achou.add("residencia");
  if (!daEmpresa && /\b(documentos?|docs?)\s+(pessoais|pessoal|do|da|dos|das)\b/.test(t)) achou.add("pessoais");
  if (achou.size === 1) return [...achou][0];
  if (achou.size > 1 && [...achou].every((k) => ["rg", "cpf", "residencia", "pessoais"].includes(k))) return "pessoais";
  return null;
}
const defTipo = (k) => TIPOS_ARQ.find((x) => x[0] === k);
// Arquivo com o tipo e a descrição que a equipe escreveu
function rotular(arq, tipo, descricao) {
  const def = defTipo(tipo) || defTipo("outro"); const d = String(descricao || "").trim().slice(0, 120);
  const r = Object.assign({}, arq, { doc: def[2], docNome: def[1], nome: `${def[1]} — ${d ? d + " · " : ""}${arq.nome}` });
  delete r.pendente; if (d) r.legenda = d; else delete r.legenda;
  return r;
}
const descricaoCurta = (a) => (a.docNome || "Arquivo") + (a.legenda ? ` (${a.legenda})` : "");

// ─── catálogo ───────────────────────────────────────────────────────────────
// tipo ∈ texto | opcao | multi | cpf | cnpj | cep | data | fone | email | dinheiro | inteiro | arquivo
// `quando(r)` decide se a pergunta entra; `opcional` aceita "pular". `arquivo` = documentação:
// recebe vários arquivos e entende o que é cada um.
const ESTADOS_CIVIS = [["solteiro", "Solteiro(a)"], ["casado", "Casado(a)"], ["divorciado", "Divorciado(a)"], ["viuvo", "Viúvo(a)"], ["uniao", "União estável"]];
const REGIMES = [["comunhao_parcial", "Comunhão parcial de bens"], ["comunhao_universal", "Comunhão universal"], ["separacao", "Separação de bens"], ["participacao_final", "Participação final nos aquestos"]];

const COMO_MANDAR = "Pode mandar tudo junto. Para eu saber o que é cada arquivo, escreva na *legenda* (ex.: *RG do João*) ou mande uma mensagem antes (ex.: *documentos da Maria*). Quando terminar, digite *ok*.";
function documentos(id, itens) {
  return { id, tipo: "arquivo", opcional: true,
    pergunta: (r) => "📎 Mande a *documentação*:\n" + (typeof itens === "function" ? itens(r) : itens).map((x) => "• " + x).join("\n") + "\n\n" + COMO_MANDAR };
}
const DOC_SOCIOS = "RG ou CNH e comprovante de residência de *cada sócio*";

// Bloco de um sócio (prefixo s{n}.). Nascimento e endereço residencial estão nos documentos.
function blocoSocio(n, rotulo) {
  const p = `s${n}.`, q = rotulo || `${n}º sócio`;
  return [
    { id: p + "nome", tipo: "texto", pergunta: `*${q}*: nome completo` },
    { id: p + "cpf", tipo: "cpf", pergunta: `CPF de ${"{" + p + "nome}"}:` },
    { id: p + "civil", tipo: "opcao", opcoes: ESTADOS_CIVIS, pergunta: "Estado civil:" },
    { id: p + "regime", tipo: "opcao", opcoes: REGIMES, pergunta: "Regime de bens do casamento:", quando: (r) => r[p + "civil"] === "casado" },
    { id: p + "profissao", tipo: "texto", pergunta: "Profissão:" },
    { id: p + "email", tipo: "email", pergunta: "E-mail:", opcional: true },
  ];
}
function blocoEndereco(prefixo, rotulo) {
  const p = prefixo;
  return [
    { id: p + "cep", tipo: "cep", pergunta: `CEP ${rotulo}:` },
    { id: p + "num", tipo: "texto", pergunta: "Número e complemento (ex.: 1500, sala 3):" },
    { id: p + "iptu", tipo: "texto", pergunta: "Inscrição do imóvel no IPTU (está no carnê):", opcional: true, docKey: "iptu" },
  ];
}
// Contato do cliente, para a legalização falar com ele se precisar
const PERGUNTA_FIM = [
  { id: "contatoNome", tipo: "texto", pergunta: "Nome do *cliente* para contato:", opcional: true },
  { id: "contatoFone", tipo: "fone", pergunta: "Telefone do cliente, com DDD:", opcional: true },
  { id: "prazo", tipo: "texto", pergunta: "Data limite para ficar pronto? (dd/mm/aaaa, ou *não*)", opcional: true },
  { id: "obs", tipo: "texto", pergunta: "Alguma *observação* para a legalização? (ou *não*)", opcional: true },
];
function socios(prefixoQtd, rotuloFn) {
  const out = [];
  for (let n = 1; n <= LIMITE_SOCIOS; n++) blocoSocio(n, rotuloFn ? rotuloFn(n) : null).forEach((s) => out.push(Object.assign({}, s, { quando: (r) => Number(r[prefixoQtd]) >= n && (!s.quando || s.quando(r)) })));
  return out;
}
const muda = (r, k) => (r.oQueMuda || []).includes(k);

const FLUXOS = {
  abrir: {
    nome: "Abrir empresa", pedidos: ["abrir"], tipoAto: "const",
    passos: [
      documentos("docs", [DOC_SOCIOS, "comprovante do *endereço da empresa* (conta de luz/água ou contrato de locação) e o *IPTU*, se tiver"]),
      { id: "nomeEmpresa", tipo: "texto", pergunta: "*Nome* pretendido para a empresa (até 3 opções, em ordem de preferência):" },
      { id: "atividades", tipo: "texto", docKey: "atividades", pergunta: "*Atividades* da empresa (ex.: loja de roupas; serviços de pintura; desenvolvimento de sites):" },
      { id: "municipio", tipo: "texto", pergunta: "*Cidade/UF* da sede (ex.: Itabaiana/SE):" },
      ...blocoEndereco("sede.", "do endereço da empresa"),
      { id: "qtdSocios", tipo: "inteiro", min: 1, max: LIMITE_SOCIOS, pergunta: `Quantos *sócios*? (1 a ${LIMITE_SOCIOS})` },
      ...socios("qtdSocios"),
      { id: "capital", tipo: "dinheiro", docKey: "capital", pergunta: "*Capital social* (valor total em R$, ex.: 10.000,00):" },
      { id: "divisao", tipo: "texto", pergunta: "Divisão do capital entre os sócios (ex.: 50% cada; ou João 70% e Maria 30%):", quando: (r) => Number(r.qtdSocios) > 1 },
      { id: "admin", tipo: "texto", pergunta: "Quem vai *administrar* (assinar pela empresa)? Pode ser mais de um.", quando: (r) => Number(r.qtdSocios) > 1 },
      ...PERGUNTA_FIM,
    ],
  },
  alterar: {
    nome: "Alterar empresa", pedidos: (r) => (Array.isArray(r.oQueMuda) ? r.oQueMuda : ["outro"]), tipoAto: "alt",
    passos: [
      { id: "cnpj", tipo: "cnpj", pergunta: "*CNPJ* da empresa:" },
      { id: "oQueMuda", tipo: "multi", pergunta: "O que vai *mudar*? Pode marcar mais de um (ex.: 1,3).", opcoes: [["endereco", "Endereço"], ["socios", "Entrada ou saída de sócio"], ["atividades", "Atividades"], ["capital", "Capital social"], ["nome", "Nome da empresa"], ["outro", "Outra coisa"]] },
      documentos("docs", (r) => ["último *contrato social ou alteração* (do MEI, o CCMEI)"]
        .concat(muda(r, "socios") ? ["RG ou CNH e comprovante de residência de *quem entra* na sociedade"] : [])
        .concat(muda(r, "endereco") ? ["comprovante do *novo endereço* e o *IPTU*, se tiver"] : [])),
      ...blocoEndereco("novo.", "do *novo* endereço").map((s) => Object.assign({}, s, { quando: (r) => muda(r, "endereco") })),
      { id: "socioMov", tipo: "opcao", opcoes: [["entra", "Alguém entra"], ["sai", "Alguém sai"], ["ambos", "Um entra e outro sai"]], pergunta: "Na sociedade:", quando: (r) => muda(r, "socios") },
      { id: "qtdEntra", tipo: "inteiro", min: 1, max: 4, pergunta: "Quantas pessoas *entram*? (1 a 4)", quando: (r) => ["entra", "ambos"].includes(r.socioMov) },
      ...socios("qtdEntra", (n) => `${n}ª pessoa que entra`).map((s) => Object.assign({}, s, { quando: (r) => ["entra", "ambos"].includes(r.socioMov) && s.quando(r) })),
      { id: "quemSai", tipo: "texto", pergunta: "Quem *sai*? Nome completo e CPF (se mais de um, separe por ponto e vírgula).", quando: (r) => ["sai", "ambos"].includes(r.socioMov) },
      { id: "quotas", tipo: "texto", pergunta: "Como ficam as *quotas* depois da mudança? (ex.: João 60% e Maria 40%; valor pago pelas quotas, se houver venda)", quando: (r) => muda(r, "socios") },
      { id: "novasAtividades", tipo: "texto", docKey: "atividades", pergunta: "Quais passam a ser as *atividades*? O que entra e o que sai:", quando: (r) => muda(r, "atividades") },
      { id: "novoCapital", tipo: "dinheiro", docKey: "capital", pergunta: "*Novo capital social* (R$):", quando: (r) => muda(r, "capital") },
      { id: "capitalComo", tipo: "texto", pergunta: "Como será o aumento (ou a redução)? (ex.: em dinheiro, por cada sócio na proporção; ou com bens)", quando: (r) => muda(r, "capital") },
      { id: "novoNome", tipo: "texto", pergunta: "*Novo nome* da empresa (até 3 opções):", quando: (r) => muda(r, "nome") },
      { id: "outroDetalhe", tipo: "texto", pergunta: "Descreva o que muda:", quando: (r) => muda(r, "outro") },
      ...PERGUNTA_FIM,
    ],
  },
  fechar: {
    nome: "Fechar empresa", pedidos: ["fechar"], tipoAto: "dist_ltda",
    passos: [
      { id: "cnpj", tipo: "cnpj", pergunta: "*CNPJ* da empresa:" },
      documentos("docs", ["último *contrato social ou alteração* (do MEI, o CCMEI)"]),
      { id: "dataFim", tipo: "data", pergunta: "*Data* pretendida para o encerramento (dd/mm/aaaa):" },
      { id: "livros", tipo: "texto", docKey: "fechar", pergunta: "Quem vai *guardar os livros e documentos* depois do encerramento? Nome completo:" },
      { id: "debitos", tipo: "opcao", opcoes: [["nao", "Não, está tudo em dia"], ["sim", "Sim, há débitos"], ["naosei", "Não sei"]], pergunta: "A empresa tem *débitos* (impostos, FGTS, parcelamentos)?" },
      ...PERGUNTA_FIM,
    ],
  },
  transformar: {
    nome: "Mudar o tipo da empresa", pedidos: ["transformar"], tipoAto: "transf_ei_ltda",
    passos: [
      { id: "cnpj", tipo: "cnpj", pergunta: "*CNPJ* da empresa atual (MEI ou empresário individual):" },
      documentos("docs", ["*CCMEI ou requerimento de empresário* atual", DOC_SOCIOS]),
      { id: "qtdSocios", tipo: "inteiro", min: 1, max: LIMITE_SOCIOS, pergunta: `Quantos *sócios* na nova sociedade, contando o titular atual? (1 a ${LIMITE_SOCIOS})` },
      ...socios("qtdSocios"),
      { id: "capital", tipo: "dinheiro", docKey: "capital", pergunta: "*Capital social* da sociedade (R$):" },
      { id: "divisao", tipo: "texto", pergunta: "Divisão do capital entre os sócios:", quando: (r) => Number(r.qtdSocios) > 1 },
      ...PERGUNTA_FIM,
    ],
  },
  advocacia: {
    nome: "Sociedade de advocacia (OAB)", pedidos: ["advocacia"], tipoAto: "sia_const",
    passos: [
      documentos("docs", ["*carteira da OAB*, RG ou CNH e comprovante de residência de *cada advogado sócio*", "comprovante do *endereço do escritório* e o *IPTU*, se tiver"]),
      { id: "nomeEmpresa", tipo: "texto", pergunta: "*Nome* da sociedade (na OAB, leva o nome do advogado):" },
      ...blocoEndereco("sede.", "do escritório"),
      { id: "qtdSocios", tipo: "inteiro", min: 1, max: LIMITE_SOCIOS, pergunta: "Quantos *advogados sócios*? (1 = sociedade individual)" },
      ...socios("qtdSocios", (n) => `${n}º advogado`),
      { id: "capital", tipo: "dinheiro", docKey: "capital", pergunta: "*Capital social* (R$):" },
      ...PERGUNTA_FIM,
    ],
  },
  outro: {
    nome: "Outro assunto", pedidos: ["outro"], tipoAto: "",
    passos: [
      { id: "cnpj", tipo: "cnpj", pergunta: "*CNPJ* da empresa, se ela já existe:", opcional: true },
      { id: "descricao", tipo: "texto", pergunta: "Descreva o pedido:" },
      documentos("anexos", ["os documentos que ajudem no pedido"]),
      ...PERGUNTA_FIM,
    ],
  },
};
const MENU = [["abrir", "Abrir uma empresa"], ["alterar", "Alterar uma empresa que já existe"], ["fechar", "Fechar uma empresa"], ["transformar", "Mudar o tipo (MEI/EI → Ltda)"], ["advocacia", "Sociedade de advocacia (OAB)"], ["outro", "Outro assunto"]];

function perguntaTipoArquivo(estado) {
  const f = estado.arquivosPendentes[0];
  return `📎 *${f.nome}*${f.legenda ? ` ("${f.legenda}")` : ""}: que documento é? Responda com o número ou escreva (ex.: *RG da Maria*).\n` + TIPOS_ARQ.map((o, i) => `*${i + 1}* — ${o[1]}`).join("\n");
}
// Depois de resolver um arquivo, volta para onde a conversa estava
function retomar(estado, msgs) {
  if ((estado.arquivosPendentes || []).length) { msgs.push(perguntaTipoArquivo(estado)); return; }
  if (!estado.fluxo) { msgs.push(menuTexto(estado)); return; }
  if (estado.aguardandoCorrecao) { msgs.push("Qual item quer corrigir? Digite o *número* (veja o resumo)."); return; }
  const p0 = passoAtual(estado);
  if (p0 && p0.tipo === "arquivo" && Array.isArray(estado.respostas["_arq." + p0.id])) msgs.push("Mande mais arquivos ou digite *ok* para seguir.");
  else if (p0) msgs.push(textoPergunta(p0, estado));
  else if (estado.respostas.confirmar === undefined) msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo");
  else msgs.push("Para um pedido novo, mande *menu*.");
}

const LGPD = "🔒 Os dados e documentos mandados aqui vão para o Atos e só servem para preparar o ato (LGPD). Mande só o que for do processo.";
const AJUDA = "Comandos: *voltar* (pergunta anterior) · *resumo* · *menu* (recomeçar) · *cancelar*.";

// ─── motor ─────────────────────────────────────────────────────────────────
function novoEstado(extra) { return Object.assign({ fluxo: null, respostas: {}, ordem: [], criadoEm: new Date().toISOString() }, extra || {}); }
function passosAtivos(estado) { const f = FLUXOS[estado.fluxo]; if (!f) return []; return f.passos.filter((p) => !p.quando || p.quando(estado.respostas)); }
function passoAtual(estado) { return passosAtivos(estado).find((p) => estado.respostas[p.id] === undefined) || null; }
const passoPorId = (estado, id) => ((FLUXOS[estado.fluxo] || {}).passos || []).find((p) => p.id === id) || null;
function interpolar(texto, r) { return String(texto || "").replace(/\{([\w.]+)\}/g, (m, k) => (r[k] != null ? String(r[k]).split(" ")[0] : "")); }
function textoPergunta(p, estado) {
  let t = interpolar(typeof p.pergunta === "function" ? p.pergunta(estado.respostas) : p.pergunta, estado.respostas);
  if (p.tipo === "opcao" || p.tipo === "multi") t += "\n" + p.opcoes.map((o, i) => `*${i + 1}* — ${o[1]}`).join("\n") + (p.tipo === "multi" ? "\n(responda com os números, ex.: 1,3)" : "");
  if (p.opcional && p.tipo !== "arquivo") t += "\n_(ou digite *pular*)_";
  if (p.opcional && p.tipo === "arquivo") t += "\n_(sem documentos agora? digite *pular*)_";
  return t;
}
function menuTexto(estado) {
  const cab = estado.empresa ? `Esta conversa está ligada a *${estado.empresa}*${estado.cnpj ? " (CNPJ " + fmtCNPJ(estado.cnpj) + ")" : ""}.\n` : "🤖 Robô de pedidos de atos da Totali. Peço a documentação e os dados, e no fim o pedido entra no Atos para a legalização.\n";
  return cab + "\nQual é o pedido?\n" + MENU.map((o, i) => `*${i + 1}* — ${o[1]}`).join("\n") + "\n\n" + AJUDA;
}
function escolherOpcao(texto, opcoes) {
  const t = String(texto || "").trim().toLowerCase();
  const n = Number(t); if (Number.isInteger(n) && n >= 1 && n <= opcoes.length) return opcoes[n - 1][0];
  const o = opcoes.find((x) => x[1].toLowerCase() === t || x[0] === t || x[1].toLowerCase().startsWith(t) && t.length >= 4);
  return o ? o[0] : null;
}
function rotuloOpcao(p, valor) { const o = (p.opcoes || []).find((x) => x[0] === valor); return o ? o[1] : String(valor); }

// Valida a resposta de um passo de texto. Devolve { ok, valor } ou { ok:false, erro }.
function validar(p, texto) {
  const t = String(texto || "").trim();
  const pular = /^(pular|nao|não|n[aã]o tem|n[aã]o sei|sem|nenhum[ao]?)$/i.test(t);
  if (p.opcional && pular) return { ok: true, valor: "", pulado: true };
  switch (p.tipo) {
    case "texto": if (t.length < 2) return { ok: false, erro: "Não entendi. Escreva a resposta, por favor." }; return { ok: true, valor: t.slice(0, 600) };
    case "opcao": { const v = escolherOpcao(t, p.opcoes); return v ? { ok: true, valor: v } : { ok: false, erro: "Responda com o *número* de uma das opções." }; }
    case "multi": { const parts = t.split(/[\s,;e]+/).filter(Boolean); const vals = []; for (const x of parts) { const v = escolherOpcao(x, p.opcoes); if (!v) return { ok: false, erro: "Responda com os *números* das opções, separados por vírgula (ex.: 1,3)." }; if (!vals.includes(v)) vals.push(v); } return vals.length ? { ok: true, valor: vals } : { ok: false, erro: "Responda com os números das opções." }; }
    case "cpf": return validaCPF(t) ? { ok: true, valor: fmtCPF(t) } : { ok: false, erro: "Esse CPF não confere. Digite os 11 números (ex.: 123.456.789-09)." };
    case "cnpj": return validaCNPJ(t) ? { ok: true, valor: fmtCNPJ(t) } : { ok: false, erro: "Esse CNPJ não confere. Digite os 14 caracteres (ex.: 12.345.678/0001-95)." };
    case "cep": { const c = dig(t); return c.length === 8 ? { ok: true, valor: c.replace(/^(\d{5})(\d{3})$/, "$1-$2") } : { ok: false, erro: "CEP com 8 números, por favor (ex.: 49500-000)." }; }
    case "data": return validaData(t) ? { ok: true, valor: t } : { ok: false, erro: "Data no formato dd/mm/aaaa (ex.: 05/03/1990)." };
    case "fone": { const d = dig(t); return (d.length === 10 || d.length === 11 || (d.startsWith("55") && (d.length === 12 || d.length === 13))) ? { ok: true, valor: d } : { ok: false, erro: "Telefone com DDD (ex.: 79 99999-0000)." }; }
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? { ok: true, valor: t.toLowerCase() } : { ok: false, erro: "E-mail inválido (ex.: nome@dominio.com.br)." };
    case "dinheiro": { const n = dinheiro(t); return n ? { ok: true, valor: n } : { ok: false, erro: "Valor em reais, por favor (ex.: 10.000,00)." }; }
    case "inteiro": { const n = Number(dig(t)); return (Number.isInteger(n) && n >= (p.min || 0) && n <= (p.max || 99)) ? { ok: true, valor: n } : { ok: false, erro: `Digite um número de ${p.min || 0} a ${p.max || 99}.` }; }
    default: return { ok: true, valor: t };
  }
}
function valorLegivel(p, v) {
  if (v === "" || v == null) return "—";
  if (p.tipo === "opcao") return rotuloOpcao(p, v);
  if (p.tipo === "multi") return (v || []).map((x) => rotuloOpcao(p, x)).join(", ");
  if (p.tipo === "dinheiro") return brl(v);
  if (p.tipo === "arquivo") return (v || []).length ? (v.length + " arquivo" + (v.length > 1 ? "s" : "") + ": " + v.map(descricaoCurta).join("; ")) : "nenhum";
  return String(v);
}
function rotuloPasso(p, estado) {
  if (p.tipo === "arquivo") return "Documentação";
  // rótulo curto para o resumo: sem os exemplos entre parênteses e sem o que vem depois da pergunta
  let r = interpolar(typeof p.pergunta === "function" ? p.pergunta(estado.respostas) : p.pergunta, estado.respostas).split("\n")[0]
    .replace(/\*/g, "").replace(/\s*\([^)]*\)/g, "").trim();
  const q = r.indexOf("?"); if (q > 0) r = r.slice(0, q + 1);
  return r.replace(/:$/, "").slice(0, 70);
}
function resumo(estado) {
  const f = FLUXOS[estado.fluxo]; if (!f) return "Nada respondido ainda.";
  const linhas = passosAtivos(estado).filter((p) => estado.respostas[p.id] !== undefined).map((p, i) => `*${i + 1}.* ${rotuloPasso(p, estado)}: ${valorLegivel(p, estado.respostas[p.id])}`);
  const av = estado.respostas["_arq.avulsos"] || [];
  return `📋 *${f.nome}*\n` + (linhas.join("\n") || "—") + (av.length ? `\nOutros arquivos: ${av.map(descricaoCurta).join("; ")}` : "");
}
// Todos os arquivos guardados nesta conversa (para apagar do Storage quando o pedido é cancelado)
function todosArquivos(estado) {
  const out = [];
  Object.keys(estado.respostas || {}).forEach((k) => { const v = estado.respostas[k]; if (Array.isArray(v)) v.forEach((a) => { if (a && typeof a === "object" && a.caminho) out.push(a); }); });
  (estado.arquivosPendentes || []).forEach((a) => a && a.caminho && out.push(a));
  return out;
}
const RE_PRONTO = /^(ok|okay|pronto|continuar|seguir|terminei|só isso|so isso|é isso|e isso|acabou|fim|foi tudo|é tudo|e tudo)$/i;
const RE_PULAR = /^(pular|nao|não|n[aã]o tenho|sem|nenhum[ao]?|depois)$/i;
function zerarPedido(estado) { estado.fluxo = null; estado.respostas = {}; estado.ordem = []; estado.arquivosPendentes = []; estado.destinoPendentes = null; estado.rotuloProximo = null; estado.aguardandoCorrecao = false; }

// Mensagem recebida → estado novo + respostas. midia = { nome, mime, caminho, url, tamanho } ou null.
// Com mídia, `texto` é a legenda.
function receber(estadoIn, entrada) {
  const estado = JSON.parse(JSON.stringify(estadoIn || novoEstado()));
  const texto = String(entrada.texto || "").trim(), t = texto.toLowerCase();
  const midia = entrada.midia || null;
  if (entrada.remetenteTel) estado.remetenteTel = entrada.remetenteTel;
  if (entrada.remetenteNome) estado.remetenteNome = entrada.remetenteNome;
  estado.atualizadoEm = new Date().toISOString();
  const msgs = [], out = { estado, mensagens: msgs, acao: null };

  // comandos globais (só em mensagem de texto: legenda de arquivo nunca é comando)
  if (!midia) {
    if (/^(menu|recomeçar|recomecar|início|inicio|oi|olá|ola|bom dia|boa tarde|boa noite)$/i.test(t) && (!estado.fluxo || /^(menu|recomeçar|recomecar)$/i.test(t))) {
      if (estado.fluxo && Object.keys(estado.respostas).length && estado.respostas.confirmar !== "sim") { estado.cancelando = "menu"; msgs.push("Recomeçar apaga o que já foi respondido e os arquivos deste pedido. Confirma? *1* — Sim, recomeçar · *2* — Não, continuar"); return out; }
      const av = estado.fluxo ? null : estado.respostas["_arq.avulsos"], pend = estado.fluxo ? [] : (estado.arquivosPendentes || []);
      zerarPedido(estado); if (av) estado.respostas["_arq.avulsos"] = av; estado.arquivosPendentes = pend;
      if (!estado.lgpdEm) { msgs.push(LGPD); estado.lgpdEm = new Date().toISOString(); } msgs.push(menuTexto(estado)); return out;
    }
    if (estado.cancelando) {
      if (/^(1|sim|s)$/i.test(t)) {
        const modo = estado.cancelando; out.descartar = todosArquivos(estado); estado.cancelando = null; zerarPedido(estado);
        if (modo === "cancelar") { out.acao = "cancelado"; msgs.push("Pedido cancelado. Para começar outro, mande *menu*."); } else msgs.push(menuTexto(estado));
        return out;
      }
      estado.cancelando = null; msgs.push("Seguimos de onde paramos."); retomar(estado, msgs); return out;
    }
    if (/^cancelar$/i.test(t)) { if (!estado.fluxo) { msgs.push("Não há pedido em andamento. Mande *menu* para começar."); return out; } estado.cancelando = "cancelar"; msgs.push("Cancelar apaga este pedido e os arquivos dele. Confirma? *1* — Sim · *2* — Não"); return out; }
    if (/^resumo$/i.test(t)) { msgs.push(resumo(estado)); retomar(estado, msgs); return out; }
    if (/^voltar$/i.test(t) && !(estado.arquivosPendentes || []).length) {
      if (!estado.fluxo) { msgs.push(menuTexto(estado)); return out; }
      const ult = estado.ordem.pop();
      if (!ult) { msgs.push("Esta já é a primeira pergunta. Para trocar o pedido, mande *menu*."); retomar(estado, msgs); return out; }
      const pu = passoPorId(estado, ult), antigo = estado.respostas[ult];
      delete estado.respostas[ult]; delete estado.respostas.confirmar; estado.aguardandoCorrecao = false;
      if (pu && pu.tipo === "arquivo") { estado.respostas["_arq." + ult] = Array.isArray(antigo) ? antigo : []; msgs.push(`Voltei para a documentação. ${(antigo || []).length} arquivo(s) continuam guardados: mande mais ou digite *ok*.`); return out; }
      const p0 = passoAtual(estado); if (p0) msgs.push("Voltei uma pergunta.\n\n" + textoPergunta(p0, estado)); return out;
    }
    if (/^ajuda$/i.test(t)) { msgs.push(AJUDA); retomar(estado, msgs); return out; }
  }

  const pendentes = () => (estado.arquivosPendentes || []).length;
  const passoArq = (estado.fluxo && !estado.aguardandoCorrecao && !pendentes()) ? passoAtual(estado) : null;

  // ── na documentação: recebe quantos arquivos vierem e entende o que é cada um ──
  if (passoArq && passoArq.tipo === "arquivo") {
    const chave = "_arq." + passoArq.id, lista = Array.isArray(estado.respostas[chave]) ? estado.respostas[chave] : [];
    if (midia) {
      let tipo = classificarDoc(texto) || classificarDoc(midia.nome), desc = texto;
      if (!tipo && estado.rotuloProximo) { tipo = estado.rotuloProximo.tipo; desc = desc || estado.rotuloProximo.texto; }
      const item = tipo ? rotular(midia, tipo, desc) : Object.assign({}, midia, { pendente: true }, texto ? { legenda: texto.slice(0, 120) } : {});
      lista.push(item); estado.respostas[chave] = lista;
      msgs.push(tipo ? `📎 ${descricaoCurta(item)} ✓` : `📎 Recebi *${midia.nome}*. Ainda não sei o que é: escreva (ex.: *comprovante do João*) ou eu pergunto no fim.`);
      return out;
    }
    if (RE_PRONTO.test(t) || RE_PULAR.test(t)) {
      const pend = lista.filter((a) => a.pendente), prontos = lista.filter((a) => !a.pendente);
      estado.respostas[passoArq.id] = prontos; estado.ordem.push(passoArq.id); delete estado.respostas[chave]; estado.rotuloProximo = null;
      if (pend.length) {
        estado.arquivosPendentes = (estado.arquivosPendentes || []).concat(pend.map((a) => { const c = Object.assign({}, a); delete c.pendente; return c; }));
        estado.destinoPendentes = passoArq.id;
        msgs.push(`Falta dizer o que ${pend.length > 1 ? `são ${pend.length} arquivos` : "é 1 arquivo"}.`); msgs.push(perguntaTipoArquivo(estado)); return out;
      }
      if (!lista.length) msgs.push("Sem documentos por enquanto: podem ser mandados depois, aqui mesmo.");
      retomar(estado, msgs); return out;
    }
    // mensagem escrita no meio da documentação: diz o que são os arquivos sem nome (os de antes, ou os próximos)
    const tipo = classificarDoc(texto);
    if (tipo) {
      const pend = lista.filter((a) => a.pendente);
      if (pend.length) {
        estado.respostas[chave] = lista.map((a) => (a.pendente ? rotular(a, tipo, a.legenda || texto) : a));
        msgs.push(`Entendi: ${pend.length > 1 ? pend.length + " arquivos marcados" : "1 arquivo marcado"} como *${defTipo(tipo)[1]}* (${texto.slice(0, 80)}).`);
      } else {
        estado.rotuloProximo = { tipo, texto: texto.slice(0, 120) };
        msgs.push(`Certo: os próximos arquivos sem legenda entram como *${defTipo(tipo)[1]}* (${texto.slice(0, 80)}).`);
      }
      return out;
    }
    msgs.push("Pode mandar os arquivos. Para eu saber o que é cada um, escreva na legenda (ex.: *RG do João*). Quando terminar, digite *ok*.");
    return out;
  }

  // ── arquivo fora da documentação: entende pela legenda ou pelo nome; se não der, pergunta o que é ──
  if (midia) {
    const tipo = classificarDoc(texto) || classificarDoc(midia.nome);
    if (tipo) { guardarClassificado(estado, out, msgs, rotular(midia, tipo, texto)); retomar(estado, msgs); return out; }
    estado.arquivosPendentes = (estado.arquivosPendentes || []).concat([Object.assign({}, midia, texto ? { legenda: texto.slice(0, 120) } : {})]);
    if (pendentes() === 1) msgs.push(perguntaTipoArquivo(estado));
    else msgs.push(`📎 Recebi também *${midia.nome}*. Antes, me diga que documento é o anterior.`);
    return out;
  }
  if (pendentes()) {
    let tipo = escolherOpcao(texto, TIPOS_ARQ.map((x) => [x[0], x[1]])), desc = "";
    if (!tipo && /\b(engano|errad[oa]|descart|apag)/.test(semAcento(texto))) tipo = "descartar";
    if (!tipo) { tipo = classificarDoc(texto); desc = texto; }
    if (!tipo) { msgs.push("Não entendi o tipo. Responda com o *número* ou escreva o documento (ex.: *RG da Maria*).\n\n" + perguntaTipoArquivo(estado)); return out; }
    const arq = estado.arquivosPendentes.shift();
    if (tipo === "descartar") { out.descartar = (out.descartar || []).concat([arq]); msgs.push(`🗑 Descartei *${arq.nome}*.`); }
    else guardarClassificado(estado, out, msgs, rotular(arq, tipo, desc || arq.legenda));
    if (!pendentes()) estado.destinoPendentes = null;
    retomar(estado, msgs); return out;
  }

  // sem fluxo: a resposta é o menu
  if (!estado.fluxo) {
    if (!estado.lgpdEm) { estado.lgpdEm = new Date().toISOString(); msgs.push(LGPD); }
    const v = escolherOpcao(texto, MENU);
    if (!v) { msgs.push(menuTexto(estado)); return out; }
    // pedido novo depois de um enviado: não herda o processo nem a empresa do anterior
    if (estado.encerrado) { estado.solicId = ""; estado.empresa = ""; estado.cnpj = ""; estado.vinculo = null; estado.casoId = ""; estado.encerrado = false; }
    const av = estado.respostas["_arq.avulsos"];                    // arquivos mandados antes de escolher o pedido
    estado.fluxo = v; estado.respostas = av ? { "_arq.avulsos": av } : {}; estado.ordem = []; estado.rotuloProximo = null;
    if (estado.cnpj && FLUXOS[v].passos.some((p) => p.id === "cnpj")) { estado.respostas.cnpj = fmtCNPJ(estado.cnpj); estado.ordem.push("cnpj"); }
    msgs.push(`Vamos lá: *${FLUXOS[v].nome}*.`);
    const p0 = passoAtual(estado); if (p0) msgs.push(textoPergunta(p0, estado)); return out;
  }

  // correção depois do resumo: "corrigir" → número do item
  if (estado.aguardandoCorrecao) {
    const lista = passosAtivos(estado).filter((p) => estado.respostas[p.id] !== undefined && p.id !== "confirmar");
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= lista.length) {
      const p = lista[n - 1], antigo = estado.respostas[p.id];
      delete estado.respostas[p.id]; delete estado.respostas.confirmar;
      estado.ordem = estado.ordem.filter((x) => x !== p.id && x !== "confirmar"); estado.aguardandoCorrecao = false;
      if (p.tipo === "arquivo") { estado.respostas["_arq." + p.id] = Array.isArray(antigo) ? antigo : []; msgs.push(`${(antigo || []).length} arquivo(s) continuam guardados. Mande os que faltam e digite *ok*.`); return out; }
      msgs.push(textoPergunta(p, estado)); return out;
    }
    msgs.push("Digite o *número* do item que quer corrigir (veja o resumo acima), ou *voltar*."); return out;
  }

  const p = passoAtual(estado);
  if (!p) {
    // tudo respondido: confirmação final
    if (estado.respostas.confirmar === undefined) {
      if (/^(1|sim|confirmar|confirmo|ok)$/i.test(t)) { estado.respostas.confirmar = "sim"; estado.encerrado = true; out.acao = "criar_solicitacao"; out.dados = montarSolicitacao(estado); msgs.push("✅ Pedido enviado: já está no Atos, na lista de solicitações, para a legalização."); return out; }
      if (/^(2|corrigir|não|nao|n)$/i.test(t)) { estado.aguardandoCorrecao = true; msgs.push(resumo(estado) + "\n\nQual item quer corrigir? Digite o *número*."); return out; }
      msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo"); return out;
    }
    msgs.push("Este pedido já foi enviado. Arquivos mandados agora entram nele; para um pedido novo, mande *menu*."); return out;
  }

  const v = validar(p, texto);
  if (!v.ok) { msgs.push(v.erro); msgs.push(textoPergunta(p, estado)); return out; }
  estado.respostas[p.id] = v.valor; estado.ordem.push(p.id);
  const prox = passoAtual(estado);
  if (prox) msgs.push(textoPergunta(prox, estado));
  else msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo");
  return out;
}
// Arquivo já identificado: entra na documentação do pedido em andamento, ou é juntado ao pedido já enviado
function guardarClassificado(estado, out, msgs, item) {
  if (estado.respostas.confirmar === "sim") { out.anexar = (out.anexar || []).concat([item]); out.acao = out.acao || "anexar"; msgs.push(`📎 ${descricaoCurta(item)}: juntado ao pedido já enviado.`); return; }
  const dest = estado.destinoPendentes;
  if (dest && Array.isArray(estado.respostas[dest])) estado.respostas[dest].push(item);
  else estado.respostas["_arq.avulsos"] = (estado.respostas["_arq.avulsos"] || []).concat([item]);
  msgs.push(`📎 ${descricaoCurta(item)}: guardado.`);
}

// O pedido no formato da solicitação do Atos.
function montarSolicitacao(estado) {
  const f = FLUXOS[estado.fluxo] || FLUXOS.outro, r = estado.respostas, passos = passosAtivos(estado);
  const pedidos = typeof f.pedidos === "function" ? f.pedidos(r) : f.pedidos;
  const docsOk = []; const anexos = [];
  const marcaDoc = (k) => { if (k && !docsOk.includes(k)) docsOk.push(k); };
  passos.forEach((p) => { const v = r[p.id]; if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) return; marcaDoc(p.docKey);
    if (p.tipo === "arquivo") v.forEach((a) => { anexos.push(Object.assign({ passo: p.id }, a)); marcaDoc(a.doc); }); });
  (r["_arq.avulsos"] || []).forEach((a) => { anexos.push(Object.assign({ passo: "avulso" }, a)); marcaDoc(a.doc); });
  (estado.arquivosPendentes || []).forEach((a) => anexos.push(Object.assign({ passo: "avulso", doc: "", docNome: "Não identificado" }, a, { nome: `Não identificado — ${a.nome}` })));
  const linhas = passos.filter((p) => r[p.id] !== undefined && p.tipo !== "arquivo").map((p) => `${rotuloPasso(p, estado)}: ${valorLegivel(p, r[p.id])}`);
  const cnpj = r.cnpj ? cnpjLimpo(r.cnpj) : (estado.cnpj || "");
  const empresa = estado.empresa || r.nomeEmpresa || r.novoNome || (cnpj ? "CNPJ " + fmtCNPJ(cnpj) : "") || (r.contatoNome ? "Pedido de " + r.contatoNome : "Pedido pelo WhatsApp");
  const prazo = /^\d{2}\/\d{2}\/\d{4}$/.test(String(r.prazo || "")) ? r.prazo : "";
  const quem = estado.remetenteNome || estado.remetenteTel || "";
  return {
    empresa, cnpj: cnpj ? fmtCNPJ(cnpj) : "", tipo: f.tipoAto, pedidos, docsOk,
    contato: r.contatoNome || "", fone: r.contatoFone || "", prazo, solicitante: quem,
    pedidoTexto: `${f.nome} — pedido feito pelo WhatsApp${quem ? " por " + quem : ""}.` + (r.descricao ? " " + r.descricao : "") + (r.outroDetalhe ? " " + r.outroDetalhe : ""),
    obs: `Pedido pelo WhatsApp (${f.nome})${quem ? ", feito por " + quem : ""}, ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.\n` + linhas.join("\n"),
    anexos, respostas: r, fluxo: estado.fluxo,
  };
}

module.exports = { FLUXOS, MENU, LGPD, TIPOS_ARQ, novoEstado, receber, passoAtual, passosAtivos, resumo, montarSolicitacao, validaCPF, validaCNPJ, menuTexto, classificarDoc };
