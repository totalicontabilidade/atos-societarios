// functions/dialogo.js — o "agente" do WhatsApp dos Atos: um diálogo GUIADO, sem modelo de
// linguagem. Perguntas numeradas, respostas por número ou em formato fixo, validação por código
// (CPF, CNPJ, CEP, data, telefone, e-mail, valor). Funções puras: recebem o estado e a mensagem,
// devolvem o estado novo, as respostas a mandar e, no fim, a solicitação pronta para o Atos.
//
// Estado: { fluxo, respostas:{id: valor}, ordem:[ids respondidos], aguardandoCorrecao, cancelando,
//           lgpdEm, empresa, cnpj, solicId, criadoEm, atualizadoEm }
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

// ─── catálogo ───────────────────────────────────────────────────────────────
// tipo ∈ texto | opcao | multi | cpf | cnpj | cep | data | fone | email | dinheiro | inteiro | arquivo
// `quando(r)` decide se a pergunta entra; `opcional` aceita "pular".
const ESTADOS_CIVIS = [["solteiro", "Solteiro(a)"], ["casado", "Casado(a)"], ["divorciado", "Divorciado(a)"], ["viuvo", "Viúvo(a)"], ["uniao", "União estável"]];
const REGIMES = [["comunhao_parcial", "Comunhão parcial de bens"], ["comunhao_universal", "Comunhão universal"], ["separacao", "Separação de bens"], ["participacao_final", "Participação final nos aquestos"]];

// Bloco de um sócio (prefixo s{n}.)
function blocoSocio(n, rotulo) {
  const p = `s${n}.`, q = rotulo || `${n}º sócio`;
  return [
    { id: p + "nome", tipo: "texto", pergunta: `*${q}* — Nome completo, como está no RG:` },
    { id: p + "cpf", tipo: "cpf", pergunta: `CPF de ${"{" + p + "nome}"}:` },
    { id: p + "nasc", tipo: "data", pergunta: "Data de nascimento (dd/mm/aaaa):" },
    { id: p + "civil", tipo: "opcao", opcoes: ESTADOS_CIVIS, pergunta: "Estado civil:" },
    { id: p + "regime", tipo: "opcao", opcoes: REGIMES, pergunta: "Regime de bens do casamento:", quando: (r) => r[p + "civil"] === "casado" },
    { id: p + "profissao", tipo: "texto", pergunta: "Profissão:" },
    { id: p + "cep", tipo: "cep", pergunta: "CEP do endereço residencial:" },
    { id: p + "endNum", tipo: "texto", pergunta: "Número e complemento do endereço residencial (ex.: 120, apto 301):" },
    { id: p + "email", tipo: "email", pergunta: "E-mail:", opcional: true },
    { id: p + "docs", tipo: "arquivo", docKey: "pessoas", pergunta: `Agora os documentos de ${"{" + p + "nome}"}: mande *foto ou PDF do RG ou CNH* e do *comprovante de residência*. Pode mandar um de cada vez; quando terminar, digite *ok*.` },
  ];
}
function blocoEndereco(prefixo, rotulo) {
  const p = prefixo;
  return [
    { id: p + "cep", tipo: "cep", pergunta: `CEP ${rotulo}:` },
    { id: p + "num", tipo: "texto", pergunta: "Número e complemento (ex.: 1500, sala 3):" },
    { id: p + "iptu", tipo: "texto", pergunta: "Inscrição do imóvel no IPTU (está no carnê). Se não souber, digite *pular*.", opcional: true, docKey: "iptu" },
    { id: p + "comprovante", tipo: "arquivo", docKey: "endereco", pergunta: "Mande o *comprovante do endereço* (conta de luz, água ou contrato de aluguel). Quando terminar, digite *ok*.", opcional: true },
  ];
}
const PERGUNTA_CONTATO = [
  { id: "contatoNome", tipo: "texto", pergunta: "Para começar, qual é o *seu nome*?" },
  { id: "contatoFone", tipo: "fone", pergunta: "Qual telefone com WhatsApp a equipe pode usar para falar com você? (se for este mesmo, digite *este*)", opcional: true },
];
const PERGUNTA_FIM = [
  { id: "prazo", tipo: "texto", pergunta: "Tem alguma *data limite* para isso ficar pronto? (dd/mm/aaaa, ou *não*)", opcional: true },
  { id: "obs", tipo: "texto", pergunta: "Quer deixar alguma *observação* para a equipe? (ou *não*)", opcional: true },
];
function socios(prefixoQtd, rotuloFn) {
  const out = [];
  for (let n = 1; n <= LIMITE_SOCIOS; n++) blocoSocio(n, rotuloFn ? rotuloFn(n) : null).forEach((s) => out.push(Object.assign({}, s, { quando: (r) => Number(r[prefixoQtd]) >= n && (!s.quando || s.quando(r)) })));
  return out;
}

const FLUXOS = {
  abrir: {
    nome: "Abrir empresa", pedidos: ["abrir"], tipoAto: "const",
    passos: [
      ...PERGUNTA_CONTATO,
      { id: "nomeEmpresa", tipo: "texto", pergunta: "Qual o *nome* pretendido para a empresa? Pode mandar até 3 opções, em ordem de preferência." },
      { id: "atividades", tipo: "texto", docKey: "atividades", pergunta: "O que a empresa vai *fazer*? Descreva as atividades com suas palavras (ex.: loja de roupas; serviços de pintura; desenvolvimento de sites)." },
      { id: "municipio", tipo: "texto", pergunta: "Em que *cidade/UF* fica a sede? (ex.: Aracaju/SE)" },
      ...blocoEndereco("sede.", "do endereço da empresa"),
      { id: "qtdSocios", tipo: "inteiro", min: 1, max: LIMITE_SOCIOS, pergunta: `Quantas pessoas serão *sócias* (contando você, se for)? Digite um número de 1 a ${LIMITE_SOCIOS}.` },
      ...socios("qtdSocios"),
      { id: "capital", tipo: "dinheiro", docKey: "capital", pergunta: "Qual o *capital social* (valor total em R$)? Ex.: 10.000,00" },
      { id: "divisao", tipo: "texto", pergunta: "Como o capital se divide entre os sócios? (ex.: 50% cada; ou João 70% e Maria 30%)", quando: (r) => Number(r.qtdSocios) > 1 },
      { id: "admin", tipo: "texto", pergunta: "Quem vai *administrar* a empresa (assinar por ela)? Pode ser mais de um.", quando: (r) => Number(r.qtdSocios) > 1 },
      ...PERGUNTA_FIM,
    ],
  },
  alterar: {
    nome: "Alterar empresa", pedidos: (r) => (Array.isArray(r.oQueMuda) ? r.oQueMuda : ["outro"]), tipoAto: "alt",
    passos: [
      ...PERGUNTA_CONTATO,
      { id: "cnpj", tipo: "cnpj", pergunta: "Qual o *CNPJ* da empresa?" },
      { id: "oQueMuda", tipo: "multi", pergunta: "O que vai *mudar*? Pode marcar mais de um (ex.: 1,3).", opcoes: [["endereco", "Endereço"], ["socios", "Entrada ou saída de sócio"], ["atividades", "Atividades"], ["capital", "Capital social"], ["nome", "Nome da empresa"], ["outro", "Outra coisa"]] },
      ...blocoEndereco("novo.", "do *novo* endereço").map((s) => Object.assign({}, s, { quando: (r) => (r.oQueMuda || []).includes("endereco") })),
      { id: "socioMov", tipo: "opcao", opcoes: [["entra", "Alguém entra"], ["sai", "Alguém sai"], ["ambos", "Um entra e outro sai"]], pergunta: "Na sociedade:", quando: (r) => (r.oQueMuda || []).includes("socios") },
      { id: "qtdEntra", tipo: "inteiro", min: 1, max: 4, pergunta: "Quantas pessoas *entram*? (1 a 4)", quando: (r) => ["entra", "ambos"].includes(r.socioMov) },
      ...socios("qtdEntra", (n) => `${n}ª pessoa que entra`).map((s) => Object.assign({}, s, { quando: (r) => ["entra", "ambos"].includes(r.socioMov) && s.quando(r) })),
      { id: "quemSai", tipo: "texto", pergunta: "Quem *sai*? Nome completo e CPF (se mais de um, separe por ponto e vírgula).", quando: (r) => ["sai", "ambos"].includes(r.socioMov) },
      { id: "quotas", tipo: "texto", pergunta: "Como ficam as *quotas* depois da mudança? (ex.: João 60% e Maria 40%; valor pago pelas quotas, se houver venda)", quando: (r) => (r.oQueMuda || []).includes("socios") },
      { id: "novasAtividades", tipo: "texto", docKey: "atividades", pergunta: "Quais passam a ser as *atividades*? Diga o que entra e o que sai.", quando: (r) => (r.oQueMuda || []).includes("atividades") },
      { id: "novoCapital", tipo: "dinheiro", docKey: "capital", pergunta: "Qual o *novo capital social* (R$)?", quando: (r) => (r.oQueMuda || []).includes("capital") },
      { id: "capitalComo", tipo: "texto", pergunta: "O aumento (ou redução) será como? (ex.: em dinheiro, por cada sócio na proporção; ou com bens)", quando: (r) => (r.oQueMuda || []).includes("capital") },
      { id: "novoNome", tipo: "texto", pergunta: "Qual o *novo nome* da empresa? Pode mandar até 3 opções.", quando: (r) => (r.oQueMuda || []).includes("nome") },
      { id: "outroDetalhe", tipo: "texto", pergunta: "Descreva com suas palavras o que precisa mudar:", quando: (r) => (r.oQueMuda || []).includes("outro") },
      { id: "contrato", tipo: "arquivo", docKey: "contrato", pergunta: "Mande o *último contrato social ou a última alteração* (PDF ou fotos de todas as páginas; do MEI, o CCMEI). Quando terminar, digite *ok*." },
      ...PERGUNTA_FIM,
    ],
  },
  fechar: {
    nome: "Fechar empresa", pedidos: ["fechar"], tipoAto: "dist_ltda",
    passos: [
      ...PERGUNTA_CONTATO,
      { id: "cnpj", tipo: "cnpj", pergunta: "Qual o *CNPJ* da empresa?" },
      { id: "dataFim", tipo: "data", pergunta: "Qual a *data* pretendida para o encerramento? (dd/mm/aaaa)" },
      { id: "livros", tipo: "texto", docKey: "fechar", pergunta: "Quem vai *guardar os livros e documentos* da empresa depois do encerramento? Nome completo." },
      { id: "debitos", tipo: "opcao", opcoes: [["nao", "Não, está tudo em dia"], ["sim", "Sim, há débitos"], ["naosei", "Não sei"]], pergunta: "A empresa tem *débitos* (impostos, FGTS, parcelamentos)?" },
      { id: "contrato", tipo: "arquivo", docKey: "contrato", pergunta: "Mande o *último contrato social ou alteração* (PDF ou fotos). Quando terminar, digite *ok*." },
      ...PERGUNTA_FIM,
    ],
  },
  transformar: {
    nome: "Mudar o tipo da empresa", pedidos: ["transformar"], tipoAto: "transf_ei_ltda",
    passos: [
      ...PERGUNTA_CONTATO,
      { id: "cnpj", tipo: "cnpj", pergunta: "Qual o *CNPJ* da empresa atual (MEI ou empresário individual)?" },
      { id: "qtdSocios", tipo: "inteiro", min: 1, max: LIMITE_SOCIOS, pergunta: `Quantas pessoas serão *sócias* na nova sociedade (contando o titular atual)? 1 a ${LIMITE_SOCIOS}.` },
      ...socios("qtdSocios"),
      { id: "capital", tipo: "dinheiro", docKey: "capital", pergunta: "Qual o *capital social* da sociedade (R$)?" },
      { id: "divisao", tipo: "texto", pergunta: "Como o capital se divide entre os sócios?", quando: (r) => Number(r.qtdSocios) > 1 },
      { id: "contrato", tipo: "arquivo", docKey: "contrato", pergunta: "Mande o *CCMEI ou o requerimento de empresário* atual (PDF ou foto). Quando terminar, digite *ok*." },
      ...PERGUNTA_FIM,
    ],
  },
  advocacia: {
    nome: "Sociedade de advocacia (OAB)", pedidos: ["advocacia"], tipoAto: "sia_const",
    passos: [
      ...PERGUNTA_CONTATO,
      { id: "nomeEmpresa", tipo: "texto", pergunta: "Qual o *nome* da sociedade? (na OAB, leva o nome do advogado; mande como prefere)" },
      ...blocoEndereco("sede.", "do escritório"),
      { id: "qtdSocios", tipo: "inteiro", min: 1, max: LIMITE_SOCIOS, pergunta: "Quantos advogados serão sócios? (1 = sociedade individual)" },
      ...socios("qtdSocios", (n) => `${n}º advogado`),
      { id: "oab", tipo: "arquivo", docKey: "oab", pergunta: "Mande a *carteira da OAB* de cada sócio (foto ou PDF). Quando terminar, digite *ok*." },
      { id: "capital", tipo: "dinheiro", docKey: "capital", pergunta: "Qual o *capital social* (R$)?" },
      ...PERGUNTA_FIM,
    ],
  },
  outro: {
    nome: "Outro assunto", pedidos: ["outro"], tipoAto: "",
    passos: [
      ...PERGUNTA_CONTATO,
      { id: "cnpj", tipo: "cnpj", pergunta: "Se for sobre uma empresa que já existe, qual o *CNPJ*? (ou *pular*)", opcional: true },
      { id: "descricao", tipo: "texto", pergunta: "Conte com suas palavras o que você precisa:" },
      { id: "anexos", tipo: "arquivo", docKey: "contrato", pergunta: "Se tiver documentos que ajudem, mande agora (ou digite *ok* para seguir).", opcional: true },
      ...PERGUNTA_FIM,
    ],
  },
};
const MENU = [["abrir", "Abrir uma empresa"], ["alterar", "Alterar uma empresa que já existe"], ["fechar", "Fechar uma empresa"], ["transformar", "Mudar o tipo (MEI/EI → Ltda)"], ["advocacia", "Sociedade de advocacia (OAB)"], ["outro", "Outro assunto"]];

// Tipo de um arquivo que chega fora de uma pergunta de documento. [chave, rótulo, documento da lista da solicitação]
const TIPOS_ARQ = [
  ["rg", "RG ou CNH", "pessoas"], ["cpf", "CPF", "pessoas"], ["residencia", "Comprovante de residência de sócio", "pessoas"],
  ["endereco", "Comprovante do endereço da empresa", "endereco"], ["iptu", "Carnê ou inscrição do IPTU", "iptu"],
  ["contrato", "Contrato social ou alteração", "contrato"], ["ccmei", "CCMEI ou requerimento de empresário", "contrato"],
  ["oab", "Carteira da OAB", "oab"], ["outro", "Outro documento", ""], ["descartar", "Mandei por engano (descartar)", ""],
];
// Rótulo do anexo pedido numa pergunta de documento, pela chave do documento
const ROTULO_DOC = { pessoas: "Documentos pessoais", endereco: "Comprovante de endereço", iptu: "IPTU", contrato: "Contrato social / CCMEI", oab: "Carteira da OAB", atividades: "Atividades", capital: "Capital", fechar: "Encerramento" };
function perguntaTipoArquivo(estado) {
  const f = estado.arquivosPendentes[0];
  return `📎 Recebi *${f.nome}*. Que documento é esse?\n` + TIPOS_ARQ.map((o, i) => `*${i + 1}* — ${o[1]}`).join("\n");
}
// Depois de resolver um arquivo, volta para onde a conversa estava
function retomar(estado, msgs) {
  if (!estado.fluxo) { msgs.push(menuTexto(estado)); return; }
  if (estado.aguardandoCorrecao) { msgs.push("Qual item quer corrigir? Digite o *número* (veja o resumo)."); return; }
  const p0 = passoAtual(estado);
  if (p0) msgs.push(textoPergunta(p0, estado));
  else if (estado.respostas.confirmar === undefined) msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo");
  else msgs.push("Se precisar de outra coisa, mande *menu*.");
}

const LGPD = "Ao continuar, você concorda que os dados e documentos enviados aqui sejam usados pela Totali Soluções Contábeis para preparar o ato da empresa (LGPD, art. 7º, V). Eles ficam guardados no sistema do escritório; as mensagens brutas são apagadas em 30 dias.";
const AJUDA = "A qualquer momento: *voltar* (pergunta anterior) · *resumo* · *menu* (recomeçar) · *equipe* (falar com uma pessoa) · *cancelar*.";

// ─── motor ─────────────────────────────────────────────────────────────────
function novoEstado(extra) { return Object.assign({ fluxo: null, respostas: {}, ordem: [], criadoEm: new Date().toISOString() }, extra || {}); }
function passosAtivos(estado) { const f = FLUXOS[estado.fluxo]; if (!f) return []; return f.passos.filter((p) => !p.quando || p.quando(estado.respostas)); }
function passoAtual(estado) { return passosAtivos(estado).find((p) => estado.respostas[p.id] === undefined) || null; }
function interpolar(texto, r) { return String(texto || "").replace(/\{([\w.]+)\}/g, (m, k) => (r[k] != null ? String(r[k]).split(" ")[0] : "")); }
function textoPergunta(p, estado) {
  let t = interpolar(typeof p.pergunta === "function" ? p.pergunta(estado.respostas) : p.pergunta, estado.respostas);
  if (p.tipo === "opcao" || p.tipo === "multi") t += "\n" + p.opcoes.map((o, i) => `*${i + 1}* — ${o[1]}`).join("\n") + (p.tipo === "multi" ? "\n(responda com os números, ex.: 1,3)" : "");
  if (p.opcional && p.tipo !== "arquivo") t += "\n_(ou digite *pular*)_";
  if (p.opcional && p.tipo === "arquivo") t += "\n_(sem arquivo agora? digite *pular*)_";
  return t;
}
function menuTexto(estado) {
  const cab = estado.empresa ? `Olá! Este atendimento está ligado a *${estado.empresa}*${estado.cnpj ? " (CNPJ " + fmtCNPJ(estado.cnpj) + ")" : ""}.\n` : "Olá! Sou o assistente da *Totali* para abertura e alteração de empresas. Vou fazer algumas perguntas e no fim a equipe recebe tudo organizado.\n";
  return cab + "\nO que você precisa?\n" + MENU.map((o, i) => `*${i + 1}* — ${o[1]}`).join("\n") + "\n*0* — Falar com uma pessoa da equipe\n\n" + AJUDA;
}
function escolherOpcao(texto, opcoes) {
  const t = String(texto || "").trim().toLowerCase();
  const n = Number(t); if (Number.isInteger(n) && n >= 1 && n <= opcoes.length) return opcoes[n - 1][0];
  const o = opcoes.find((x) => x[1].toLowerCase() === t || x[0] === t || x[1].toLowerCase().startsWith(t) && t.length >= 4);
  return o ? o[0] : null;
}
function rotuloOpcao(p, valor) { const o = (p.opcoes || []).find((x) => x[0] === valor); return o ? o[1] : String(valor); }

// Valida a resposta de um passo. Devolve { ok, valor } ou { ok:false, erro }.
function validar(p, texto, midia, estado) {
  const t = String(texto || "").trim();
  const pular = /^(pular|nao|não|n[aã]o tenho|sem|nenhum[ao]?)$/i.test(t);
  if (p.tipo === "arquivo") {
    const lista = Array.isArray(estado.respostas["_arq." + p.id]) ? estado.respostas["_arq." + p.id] : [];
    if (midia) return { ok: false, acumula: true, erro: `📎 Recebi *${midia.nome}*${lista.length ? ` (${lista.length + 1} arquivo${lista.length ? "s" : ""})` : ""}. Mande mais ou digite *ok* para seguir.` };
    if (/^(ok|pronto|continuar|segue|terminei|só isso|so isso|é isso|e isso)$/i.test(t)) { if (lista.length) return { ok: true, valor: lista }; if (p.opcional) return { ok: true, valor: [] }; return { ok: false, erro: "Ainda não recebi nenhum arquivo. Mande a foto ou o PDF, ou digite *pular* se não tiver agora." }; }
    if (pular) return { ok: true, valor: lista, pulado: !lista.length };
    return { ok: false, erro: "Aqui espero um *arquivo* (foto ou PDF). Mande o arquivo, ou digite *ok* quando terminar" + (p.opcional ? ", ou *pular*." : ".") };
  }
  if (midia && !t) return { ok: false, erro: "Recebi um arquivo, mas nesta pergunta preciso de *texto*. Guardei o arquivo; responda a pergunta por escrito." , guardaMidia: true };
  if (p.opcional && pular) return { ok: true, valor: "", pulado: true };
  switch (p.tipo) {
    case "texto": if (t.length < 2) return { ok: false, erro: "Não entendi. Escreva a resposta, por favor." }; return { ok: true, valor: t.slice(0, 600) };
    case "opcao": { const v = escolherOpcao(t, p.opcoes); return v ? { ok: true, valor: v } : { ok: false, erro: "Responda com o *número* de uma das opções." }; }
    case "multi": { const parts = t.split(/[\s,;e]+/).filter(Boolean); const vals = []; for (const x of parts) { const v = escolherOpcao(x, p.opcoes); if (!v) return { ok: false, erro: "Responda com os *números* das opções, separados por vírgula (ex.: 1,3)." }; if (!vals.includes(v)) vals.push(v); } return vals.length ? { ok: true, valor: vals } : { ok: false, erro: "Responda com os números das opções." }; }
    case "cpf": return validaCPF(t) ? { ok: true, valor: fmtCPF(t) } : { ok: false, erro: "Esse CPF não confere. Digite os 11 números (ex.: 123.456.789-09)." };
    case "cnpj": return validaCNPJ(t) ? { ok: true, valor: fmtCNPJ(t) } : { ok: false, erro: "Esse CNPJ não confere. Digite os 14 caracteres (ex.: 12.345.678/0001-95)." };
    case "cep": { const c = dig(t); return c.length === 8 ? { ok: true, valor: c.replace(/^(\d{5})(\d{3})$/, "$1-$2") } : { ok: false, erro: "CEP com 8 números, por favor (ex.: 49010-000)." }; }
    case "data": return validaData(t) ? { ok: true, valor: t } : { ok: false, erro: "Data no formato dd/mm/aaaa (ex.: 05/03/1990)." };
    case "fone": { if (/^(este|esse|mesmo|este mesmo)$/i.test(t)) return { ok: true, valor: estado.remetenteTel || "" }; const d = dig(t); return (d.length === 10 || d.length === 11 || (d.startsWith("55") && (d.length === 12 || d.length === 13))) ? { ok: true, valor: d } : { ok: false, erro: "Telefone com DDD (ex.: 79 99999-0000), ou *este* para usar este número." }; }
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
  if (p.tipo === "arquivo") return (v || []).length ? (v.length + " arquivo" + (v.length > 1 ? "s" : "") + ": " + v.map((a) => a.nome).join(", ")) : "nenhum";
  return String(v);
}
function rotuloPasso(p, estado) { return interpolar(typeof p.pergunta === "function" ? p.pergunta(estado.respostas) : p.pergunta, estado.respostas).split("\n")[0].replace(/\*/g, "").replace(/:$/, "").slice(0, 70); }
function resumo(estado) {
  const f = FLUXOS[estado.fluxo]; if (!f) return "Nada respondido ainda.";
  const linhas = passosAtivos(estado).filter((p) => estado.respostas[p.id] !== undefined).map((p, i) => `*${i + 1}.* ${rotuloPasso(p, estado)}: ${valorLegivel(p, estado.respostas[p.id])}`);
  return `📋 *${f.nome}*\n` + (linhas.join("\n") || "—");
}

// Mensagem recebida → estado novo + respostas. midia = { nome, mime, caminho, url, tamanho } ou null.
function receber(estadoIn, entrada) {
  const estado = JSON.parse(JSON.stringify(estadoIn || novoEstado()));
  const texto = String(entrada.texto || "").trim(), t = texto.toLowerCase();
  const midia = entrada.midia || null;
  if (entrada.remetenteTel) estado.remetenteTel = entrada.remetenteTel;
  if (entrada.remetenteNome && !estado.remetenteNome) estado.remetenteNome = entrada.remetenteNome;
  estado.atualizadoEm = new Date().toISOString();
  const msgs = [], out = { estado, mensagens: msgs, acao: null };
  const guardarMidiaSolta = () => { if (midia) { estado.respostas["_arq.avulsos"] = (estado.respostas["_arq.avulsos"] || []).concat([midia]); } };

  // comandos globais
  if (/^(0|equipe|atendente|humano|pessoa|falar com (alguém|alguem|a equipe))$/i.test(t)) { out.acao = "humano"; msgs.push("Certo, vou avisar a equipe da Totali para falar com você por aqui. O que você já respondeu fica guardado."); return out; }
  if (/^(menu|recomeçar|recomecar|início|inicio|oi|olá|ola|bom dia|boa tarde|boa noite)$/i.test(t) && (!estado.fluxo || /^(menu|recomeçar|recomecar)$/i.test(t))) {
    if (estado.fluxo && Object.keys(estado.respostas).length && estado.respostas.confirmar !== "sim") { estado.cancelando = "menu"; msgs.push("Recomeçar apaga o que já foi respondido neste pedido. Confirma? *1* — Sim, recomeçar · *2* — Não, continuar"); return out; }
    estado.fluxo = null; estado.respostas = {}; estado.ordem = []; if (!estado.lgpdEm) { msgs.push(LGPD); estado.lgpdEm = new Date().toISOString(); } msgs.push(menuTexto(estado)); return out;
  }
  if (estado.cancelando) {
    if (/^(1|sim|s)$/i.test(t)) { const modo = estado.cancelando; estado.cancelando = null; estado.fluxo = null; estado.respostas = {}; estado.ordem = []; if (modo === "cancelar") { out.acao = "cancelado"; msgs.push("Pedido cancelado. Quando quiser, é só mandar *menu*."); } else msgs.push(menuTexto(estado)); return out; }
    estado.cancelando = null; msgs.push("Seguimos de onde paramos."); const p0 = passoAtual(estado); if (p0) msgs.push(textoPergunta(p0, estado)); return out;
  }
  if (/^cancelar$/i.test(t)) { if (!estado.fluxo) { msgs.push("Não há pedido em andamento. Mande *menu* para começar."); return out; } estado.cancelando = "cancelar"; msgs.push("Cancelar apaga este pedido. Confirma? *1* — Sim · *2* — Não"); return out; }
  if (/^resumo$/i.test(t)) { msgs.push(resumo(estado)); const p0 = passoAtual(estado); if (p0) msgs.push(textoPergunta(p0, estado)); return out; }
  if (/^voltar$/i.test(t)) {
    if (!estado.fluxo) { msgs.push(menuTexto(estado)); return out; }
    const ult = estado.ordem.pop(); if (ult) { delete estado.respostas[ult]; delete estado.respostas["_arq." + ult]; delete estado.respostas["confirmar"]; } else { estado.fluxo = null; msgs.push(menuTexto(estado)); return out; }
    const p0 = passoAtual(estado); if (p0) msgs.push("Voltei uma pergunta.\n\n" + textoPergunta(p0, estado)); return out;
  }
  if (/^ajuda$/i.test(t)) { msgs.push(AJUDA); const p0 = passoAtual(estado); if (p0) msgs.push(textoPergunta(p0, estado)); return out; }

  // Arquivo que chega fora de uma pergunta de documento: o robô pergunta que documento é (v1.74)
  const passoArq = (estado.fluxo && !estado.aguardandoCorrecao) ? passoAtual(estado) : null;
  if (midia && !(passoArq && passoArq.tipo === "arquivo")) {
    estado.arquivosPendentes = (estado.arquivosPendentes || []).concat([midia]);
    if (estado.arquivosPendentes.length === 1) msgs.push(perguntaTipoArquivo(estado));
    else msgs.push(`📎 Recebi também *${midia.nome}*. Antes, me diga que documento é o anterior.`);
    return out;
  }
  if (Array.isArray(estado.arquivosPendentes) && estado.arquivosPendentes.length) {
    const tipo = escolherOpcao(texto, TIPOS_ARQ.map((x) => [x[0], x[1]]));
    if (!tipo) { msgs.push("Responda com o *número* do tipo de documento.\n\n" + perguntaTipoArquivo(estado)); return out; }
    const arq = estado.arquivosPendentes.shift(), def = TIPOS_ARQ.find((x) => x[0] === tipo);
    if (tipo === "descartar") { out.descartar = (out.descartar || []).concat([arq]); msgs.push(`🗑 Descartei *${arq.nome}*.`); }
    else {
      const item = Object.assign({}, arq, { doc: def[2], docNome: def[1], nome: `${def[1]} — ${arq.nome}` });
      if (estado.respostas.confirmar === "sim") { out.anexar = (out.anexar || []).concat([item]); out.acao = out.acao || "anexar"; msgs.push(`📎 *${arq.nome}* guardado como ${def[1]} e juntado ao pedido já enviado.`); }
      else { estado.respostas["_arq.avulsos"] = (estado.respostas["_arq.avulsos"] || []).concat([item]); msgs.push(`📎 *${arq.nome}* guardado como ${def[1]}.`); }
    }
    if (estado.arquivosPendentes.length) { msgs.push(perguntaTipoArquivo(estado)); return out; }
    retomar(estado, msgs); return out;
  }

  // sem fluxo: a resposta é o menu
  if (!estado.fluxo) {
    if (!estado.lgpdEm) { estado.lgpdEm = new Date().toISOString(); msgs.push(LGPD); }
    const v = escolherOpcao(texto, MENU);
    if (!v) { guardarMidiaSolta(); msgs.push(menuTexto(estado)); return out; }
    // pedido novo depois de um enviado: não herda o processo nem a empresa do anterior
    if (estado.encerrado) { estado.solicId = ""; estado.empresa = ""; estado.cnpj = ""; estado.vinculo = null; estado.casoId = ""; estado.encerrado = false; }
    estado.fluxo = v; estado.respostas = {}; estado.ordem = [];
    if (estado.cnpj && FLUXOS[v].passos.some((p) => p.id === "cnpj")) { estado.respostas.cnpj = fmtCNPJ(estado.cnpj); estado.ordem.push("cnpj"); }
    msgs.push(`Vamos lá: *${FLUXOS[v].nome}*.`);
    const p0 = passoAtual(estado); if (p0) msgs.push(textoPergunta(p0, estado)); return out;
  }

  // correção depois do resumo: "corrigir" → número do item
  if (estado.aguardandoCorrecao) {
    const lista = passosAtivos(estado).filter((p) => estado.respostas[p.id] !== undefined && p.id !== "confirmar");
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= lista.length) { const p = lista[n - 1]; delete estado.respostas[p.id]; delete estado.respostas["_arq." + p.id]; delete estado.respostas.confirmar; estado.ordem = estado.ordem.filter((x) => x !== p.id && x !== "confirmar"); estado.aguardandoCorrecao = false; msgs.push(textoPergunta(p, estado)); return out; }
    msgs.push("Digite o *número* do item que quer corrigir (veja o resumo acima), ou *voltar*."); return out;
  }

  const p = passoAtual(estado);
  if (!p) {
    // tudo respondido: confirmação final
    if (estado.respostas.confirmar === undefined) {
      if (/^(1|sim|confirmar|confirmo|ok)$/i.test(t)) { estado.respostas.confirmar = "sim"; estado.encerrado = true; out.acao = "criar_solicitacao"; out.dados = montarSolicitacao(estado); msgs.push("✅ Pedido enviado para a equipe da Totali. Em breve alguém entra em contato por aqui. Obrigado!"); return out; }
      if (/^(2|corrigir|não|nao|n)$/i.test(t)) { estado.aguardandoCorrecao = true; msgs.push(resumo(estado) + "\n\nQual item quer corrigir? Digite o *número*."); return out; }
      guardarMidiaSolta();
      msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo"); return out;
    }
    msgs.push("Este pedido já foi enviado. Se precisar de outra coisa, mande *menu*; para falar com a equipe, *equipe*."); guardarMidiaSolta(); return out;
  }

  const v = validar(p, texto, midia, estado);
  if (!v.ok) {
    if (v.acumula && midia) estado.respostas["_arq." + p.id] = (estado.respostas["_arq." + p.id] || []).concat([midia]);
    else if (v.guardaMidia) guardarMidiaSolta();
    msgs.push(v.erro); if (!v.acumula && !v.guardaMidia) msgs.push(textoPergunta(p, estado)); return out;
  }
  estado.respostas[p.id] = v.valor; estado.ordem.push(p.id); delete estado.respostas["_arq." + p.id];
  const prox = passoAtual(estado);
  if (prox) msgs.push(textoPergunta(prox, estado));
  else msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo");
  return out;
}

// O pedido no formato da solicitação do Atos.
function montarSolicitacao(estado) {
  const f = FLUXOS[estado.fluxo] || FLUXOS.outro, r = estado.respostas, passos = passosAtivos(estado);
  const pedidos = typeof f.pedidos === "function" ? f.pedidos(r) : f.pedidos;
  const docsOk = []; const anexos = [];
  passos.forEach((p) => { const v = r[p.id]; if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) return; if (p.docKey && !docsOk.includes(p.docKey)) docsOk.push(p.docKey);
    if (p.tipo === "arquivo") { const m = /^s(\d+)\./.exec(p.id), socio = m ? String(r[`s${m[1]}.nome`] || "").trim() : "", rot = (ROTULO_DOC[p.docKey] || "Documento") + (socio ? " de " + socio : "");
      v.forEach((a) => anexos.push(Object.assign({ passo: p.id, doc: p.docKey || "", docNome: rot }, a, { nome: `${rot} — ${a.nome}` }))); } });
  (r["_arq.avulsos"] || []).forEach((a) => { anexos.push(Object.assign({ passo: "avulso" }, a)); if (a.doc && !docsOk.includes(a.doc)) docsOk.push(a.doc); });
  (estado.arquivosPendentes || []).forEach((a) => anexos.push(Object.assign({ passo: "avulso", doc: "", docNome: "Não identificado" }, a, { nome: `Não identificado — ${a.nome}` })));
  const linhas = passos.filter((p) => r[p.id] !== undefined && p.tipo !== "arquivo").map((p) => `${rotuloPasso(p, estado)}: ${valorLegivel(p, r[p.id])}`);
  const cnpj = r.cnpj ? cnpjLimpo(r.cnpj) : (estado.cnpj || "");
  const empresa = estado.empresa || r.nomeEmpresa || r.novoNome || (cnpj ? "CNPJ " + fmtCNPJ(cnpj) : "") || (r.contatoNome ? "Pedido de " + r.contatoNome : "Pedido pelo WhatsApp");
  const prazo = /^\d{2}\/\d{2}\/\d{4}$/.test(String(r.prazo || "")) ? r.prazo : "";
  return {
    empresa, cnpj: cnpj ? fmtCNPJ(cnpj) : "", tipo: f.tipoAto, pedidos, docsOk,
    contato: r.contatoNome || estado.remetenteNome || "", fone: r.contatoFone || estado.remetenteTel || "", prazo,
    pedidoTexto: `${f.nome} — pedido feito pelo WhatsApp.` + (r.descricao ? " " + r.descricao : "") + (r.outroDetalhe ? " " + r.outroDetalhe : ""),
    obs: `Pedido pelo WhatsApp (${f.nome}), ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.\n` + linhas.join("\n") + (r.obs && r.obs !== "" ? "" : ""),
    anexos, respostas: r, fluxo: estado.fluxo,
  };
}

module.exports = { FLUXOS, MENU, LGPD, TIPOS_ARQ, novoEstado, receber, passoAtual, passosAtivos, resumo, montarSolicitacao, validaCPF, validaCNPJ, menuTexto };
