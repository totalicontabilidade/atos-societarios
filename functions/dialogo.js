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
  ["contrato", "Contrato social, alteração, estatuto ou ata", "contrato"], ["ccmei", "CCMEI ou requerimento de empresário", "contrato"],
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
  if (!locacao && /contrato social|\bcontrato\b|alteracao contratual|\balteracao\b|aditivo|consolidac|\bestatuto\b|\bata\b/.test(t)) achou.add("contrato");
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
// Texto livre sem pedido escolhido ("alteração do nome da empresa", "baixa da X"): qual pedido é.
// Estatuto, ata, eleição e assembleia são de entidade (associação, cooperativa): vão para "Outro assunto".
function adivinharFluxo(texto) {
  const t = " " + semAcento(texto) + " ";
  if (/advocacia|advogad|\boab\b/.test(t)) return "advocacia";
  if (/transforma|desenquadr|de mei para|mei (para|pra) (ltda|sociedade)|virar ltda/.test(t)) return "transformar";
  if (/\b(estatuto|ata|atas|eleic\w*|assembleia|associacao|cooperativa|diretoria)\b/.test(t)) return "outro";
  if (/\b(fechar|fechamento|encerrar|encerramento|baixa|baixar|dissoluc\w*|distrato|extinc\w*|extinguir)\b/.test(t)) return "fechar";
  if (/\bfilial\b/.test(t)) return "alterar";
  if (/\b(abrir|abertura|constituir|constituicao|nova empresa|empresa nova)\b/.test(t)) return "abrir";
  if (/\b(alter\w*|denominac\w*|mud\w*|troc\w*|entrada|saida|incluir|retirar|aumento|reducao|endereco|capital|nome empresarial|razao social|cnae|atividade|administrador)\b/.test(t)) return "alterar";
  return null;
}
// O que muda numa alteração, dito em texto livre
function mudancasDoTexto(texto) {
  const t = " " + semAcento(texto) + " ", m = [];
  if (/\b(endereco|sede|mudanca de endereco|transferencia)\b/.test(t)) m.push("endereco");
  if (/\b(socios?|socias?|entrada|saida|retirada|quotas?|cotas?)\b/.test(t)) m.push("socios");
  if (/\b(atividades?|cnaes?|objeto social)\b/.test(t)) m.push("atividades");
  if (/\bcapital\b/.test(t)) m.push("capital");
  if (/\b(denominac\w*|nome empresarial|nome da empresa|razao social|nome fantasia|novo nome|troca de nome|mudanca de nome|alteracao do nome)\b/.test(t)) m.push("nome");
  return m;
}
// Anotação da equipe (texto que não é resposta de pergunta): vai junto na solicitação
function anotar(estado, texto) { estado.respostas._notas = (estado.respostas._notas || []).concat([String(texto).trim().slice(0, 300)]).slice(-10); }
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
// Uma pergunta só no fim (antes eram 4, quase sempre puladas): contato, telefone, prazo e observação
// numa mensagem; o telefone e a data são tirados do texto (ver extrasDoTexto).
const PERGUNTA_FIM = [
  { id: "extras", tipo: "texto", opcional: true,
    pergunta: "Algo mais para a legalização? Numa mensagem só: *contato do cliente* (nome e telefone), *prazo* (dd/mm/aaaa) e *observações*." },
];
function extrasDoTexto(texto) {
  let t = String(texto || "").trim(); const r = { contatoNome: "", contatoFone: "", prazo: "", obs: "" };
  if (!t) return r;
  const data = /\b(\d{2}\/\d{2}\/\d{4})\b/.exec(t); if (data && validaData(data[1])) { r.prazo = data[1]; t = t.replace(data[0], " "); }
  const fone = /(\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/.exec(t);
  if (fone) { const d = fone[0].replace(/\D/g, ""); if (d.length >= 10 && d.length <= 13) { r.contatoFone = d; t = t.replace(fone[0], " "); } }
  if (!data && !fone) { const so = t.trim(); return Object.assign(r, so.split(/\s+/).length <= 4 && /^[A-ZÀ-Ý][A-Za-zÀ-ÿ' ]+$/.test(so) ? { contatoNome: so } : { obs: so }); }
  t = t.replace(/\b(prazo|telefone|fone|tel|contato|whats(app)?)\b\s*:?/gi, " ").replace(/\b(cliente|at[eé])\s*:/gi, " ").replace(/[\s,;:.\-–]+$/g, "").replace(/^[\s,;:.\-–]+/g, "").replace(/\s+/g, " ").trim();
  // o nome é o começo em maiúsculas ("Maria da Silva 79 9…"); o resto é observação
  const m = /^([A-ZÀ-Ý][a-zà-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][a-zà-ÿ']+){0,4})(.*)$/.exec(t);
  if (m && r.contatoFone) { r.contatoNome = m[1].trim(); r.obs = m[2].replace(/^[\s,;:.\-–]+/, "").replace(/^(at[eé]|prazo)(?=\s|$)\s*/i, "").trim(); }
  else r.obs = t;
  return r;
}
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
const MENU = [["abrir", "Abrir uma empresa"], ["alterar", "Alterar uma empresa que já existe"], ["fechar", "Fechar uma empresa"], ["transformar", "Mudar o tipo (MEI/EI → Ltda)"], ["advocacia", "Sociedade de advocacia (OAB)"], ["outro", "Outro assunto"], ["recado", "Recado para a equipe (não é ato)"]];

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
const AJUDA = "Comandos: *enviar* (manda o pedido com o que já tem) · *voltar* (pergunta anterior) · *resumo* · *menu* (recomeçar) · *cancelar* · *comentário …* (vai para o Atos e o Hub) · *recado …* (o que não é ato: vira pendência só no Hub) · *pausar* (o robô fica quieto; *ativar* volta).";

// ─── comentário para o Hub e pausa do robô ───────────────────────────────────
// "comentário: cliente tem pressa" → entra na conversa da solicitação no Atos e vira comentário na pendência do Hub.
// "comentário" sozinho → a próxima mensagem escrita é o comentário.
const RE_COMENTARIO = /^\s*(?:coment[aá]rio|comentar|coment)(?=$|[\s:,;.\-–])[\s:,;.\-–]*/i;
function comentarioDoTexto(texto) {
  const t = String(texto || ""), m = RE_COMENTARIO.exec(t);
  return m ? t.slice(m[0].length).trim() : null;
}
// "pausar" deixa o grupo conversar sem o robô; volta com "ativar" ou depois de 5 minutos sem mensagem
const PAUSA_MS = 5 * 60000;
function comandoPausa(texto) {
  const t = semAcento(String(texto || "").trim()).replace(/[.!]+$/, "").replace(/\s+/g, " ").trim();
  if (/^(pausar|pausa|pause|pausar (o )?robo|robo pausa(do)?)$/.test(t)) return "pausar";
  if (/^(ativar|ativa|ativar (o )?robo|despausar|retomar|robo ativo)$/.test(t)) return "ativar";
  return null;
}
// Pausa ativa agora? (pausaAte em milissegundos)
const pausado = (estado, agoraMs) => !!(estado && estado.pausaAte && Number(estado.pausaAte) > (agoraMs || Date.now()));
const PALAVRAS_COMANDO = /^(menu|cancelar|enviar|resumo|voltar|ajuda|pausar|ativar|ok|pular)$/i;

// ─── motor ─────────────────────────────────────────────────────────────────
function novoEstado(extra) { return Object.assign({ fluxo: null, respostas: {}, ordem: [], criadoEm: new Date().toISOString() }, extra || {}); }
function passosAtivos(estado) { const f = FLUXOS[estado.fluxo]; if (!f) return []; return f.passos.filter((p) => !p.quando || p.quando(estado.respostas)); }
function passoAtual(estado) { return passosAtivos(estado).find((p) => estado.respostas[p.id] === undefined) || null; }
const passoPorId = (estado, id) => ((FLUXOS[estado.fluxo] || {}).passos || []).find((p) => p.id === id) || null;
function interpolar(texto, r) { return String(texto || "").replace(/\{([\w.]+)\}/g, (m, k) => (r[k] != null ? String(r[k]).split(" ")[0] : "")); }
function textoPergunta(p, estado) {
  let t = interpolar(typeof p.pergunta === "function" ? p.pergunta(estado.respostas) : p.pergunta, estado.respostas);
  if (p.tipo === "opcao" || p.tipo === "multi") t += "\n" + p.opcoes.map((o, i) => `*${i + 1}* — ${o[1]}`).join("\n") + (p.tipo === "multi" ? "\n(responda com os números, ex.: 1,3)" : "");
  const lista = p.tipo === "arquivo" ? estado.respostas["_arq." + p.id] : null;
  if (Array.isArray(lista) && lista.length) t += `\n\nJá recebi: ${lista.map((a) => (a.pendente ? a.nome : descricaoCurta(a))).join("; ")}.`;
  const env = temAlgo(estado) ? "*enviar* manda só o que já tem" : "";
  if (p.opcional && p.tipo !== "arquivo") t += `\n_(ou *pular*${env ? "; " + env : ""})_`;
  else if (p.tipo === "arquivo" && Array.isArray(lista) && lista.length) t += `\n_(mande mais ou digite *ok*${env ? "; " + env : ""})_`;
  else if (p.opcional && p.tipo === "arquivo") t += `\n_(sem documentos agora? *pular*${env ? "; " + env : ""})_`;
  else if (env) t += `\n_(${env})_`;
  return t;
}
// Já tem o que mandar? (algum arquivo, resposta ou anotação além do que veio do vínculo)
function temAlgo(estado) {
  if (!estado.fluxo) return false;
  const r = estado.respostas || {};
  if ((estado.arquivosPendentes || []).length) return true;
  return Object.keys(r).some((k) => k !== "confirmar" && (Array.isArray(r[k]) ? r[k].length > 0 : r[k] !== "" && r[k] != null) && !(k === "cnpj" && estado.cnpj && estado.ordem.length <= 1));
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
  const notas = estado.respostas._notas || [], coments = estado.comentarios || [];
  return `📋 *${f.nome}*\n` + (linhas.join("\n") || "—") + (av.length ? `\nOutros arquivos: ${av.map(descricaoCurta).join("; ")}` : "") + (notas.length ? `\nAnotações: ${notas.join(" / ")}` : "")
    + (coments.length ? `\nComentários: ${coments.length}` : "");
}
// Todos os arquivos guardados nesta conversa (para apagar do Storage quando o pedido é cancelado)
function todosArquivos(estado) {
  const out = [];
  Object.keys(estado.respostas || {}).forEach((k) => { const v = estado.respostas[k]; if (Array.isArray(v)) v.forEach((a) => { if (a && typeof a === "object" && a.caminho) out.push(a); }); });
  (estado.arquivosPendentes || []).forEach((a) => a && a.caminho && out.push(a));
  return out;
}
// Texto transcrito de áudio → como se tivesse sido digitado: sem o ponto final, número falado por
// extenso vira algarismo ("Um." → "1", "dois" → "2") e CPF/CNPJ/telefone ditados ficam só com os dígitos.
const POR_EXTENSO = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11 };
function textoFalado(texto) {
  let t = String(texto || "").replace(/\s+/g, " ").trim().replace(/[.!?…]+$/, "").trim();
  const sa = semAcento(t).replace(/^(opcao|numero|item)\s+/, "").trim();
  if (POR_EXTENSO[sa] !== undefined) return String(POR_EXTENSO[sa]);
  // número ditado: o Whisper separa as pausas com vírgula ou espaço ("0,0 0,0,0 0,0,0 0,0,0,1 9,1")
  if (/^[\d\s.,\-\/]+$/.test(t) && t.replace(/\D/g, "").length >= 8) return /[\s,]/.test(t) ? t.replace(/\D/g, "") : t;
  if (/^(sim|nao|não|ok|pular|cancelar|menu|resumo|voltar|ajuda|pronto)$/i.test(semAcento(t).replace(/[,.]/g, ""))) return semAcento(t).replace(/[,.]/g, "").replace("nao", "não");
  return t;
}
const NUMERICOS = ["cpf", "cnpj", "cep", "data", "fone", "dinheiro", "inteiro", "email"];
const RE_ENVIAR = /^(enviar|envia|envie|enviar assim|enviar agora|pode enviar|manda assim|mandar assim|pode mandar|enviar só isso|enviar so isso)$/i;
const RE_PRONTO = /^(ok|okay|pronto|continuar|seguir|terminei|só isso|so isso|é isso|e isso|acabou|fim|foi tudo|é tudo|e tudo)$/i;
const RE_PULAR = /^(pular|nao|não|n[aã]o tenho|sem|nenhum[ao]?|depois)$/i;
function zerarPedido(estado) { estado.participantes = estado.remetenteNome ? [estado.remetenteNome] : []; estado.fluxo = null; estado.respostas = {}; estado.ordem = []; estado.arquivosPendentes = []; estado.destinoPendentes = null; estado.rotuloProximo = null; estado.aguardandoCorrecao = false; }

const CONF_MENU = "Recomeçar apaga o que já foi respondido e os arquivos deste pedido. Confirma? *1* — Sim, recomeçar · *2* — Não, continuar";
const CONF_CANCELAR = "Cancelar apaga este pedido e os arquivos dele. Confirma? *1* — Sim · *2* — Não";
// A pergunta que está valendo agora (a mesma que o robô faria se a conversa parasse aqui)
function mensagemAtual(estado) {
  if (estado.cancelando === "menu") return CONF_MENU;
  if (estado.cancelando === "cancelar") return CONF_CANCELAR;
  if (estado.perguntaRecado) return perguntaRecadoTexto(estado);
  if (estado.aguardandoRecado) return PEDE_RECADO;
  if (estado.perguntaDestino) return perguntaDestinoTexto(estado);
  if (estado.perguntaInicio) return perguntaInicioTexto(estado);
  const m = []; retomar(estado, m); return m[m.length - 1] || null;
}
// Separa os avisos da pergunta final: quando chegam várias mensagens juntas, o webhook junta os
// avisos de todas numa resposta só e faz a pergunta que vale no fim, uma vez.
function receber(estadoIn, entrada) {
  const out = receberMensagem(estadoIn, entrada);
  registrarMensagem(estadoIn || {}, out, entrada);
  const atual = mensagemAtual(out.estado), m = out.mensagens;
  if (atual && m.length && m[m.length - 1] === atual) { out.avisos = m.slice(0, -1); out.pergunta = atual; }
  else { out.avisos = m.slice(); out.pergunta = null; }
  return out;
}

// Mensagem recebida → estado novo + respostas. midia = { nome, mime, caminho, url, tamanho } ou null.
// Com mídia, `texto` é a legenda.
function receberMensagem(estadoIn, entrada) {
  const estado = JSON.parse(JSON.stringify(estadoIn || novoEstado()));
  const texto = String(entrada.texto || "").trim(), t = texto.toLowerCase();
  const midia = entrada.midia || null;
  if (entrada.remetenteTel) estado.remetenteTel = entrada.remetenteTel;
  if (entrada.remetenteNome) estado.remetenteNome = entrada.remetenteNome;
  // quem participou deste pedido (o grupo é um só: um descreve, outro manda os arquivos, outro envia)
  const quemAgora = entrada.remetenteNome || entrada.remetenteTel || "";
  if (quemAgora && !(estado.participantes || []).includes(quemAgora)) estado.participantes = (estado.participantes || []).concat([quemAgora]).slice(-6);
  estado.atualizadoEm = new Date().toISOString();
  const msgs = [], out = { estado, mensagens: msgs, acao: null };
  const agora = entrada.agora || Date.now();
  // resposta a uma pergunta do robô: para qual pedido vai o comentário / a partir de qual mensagem é o pedido novo
  if (estado.perguntaDestino && responderDestino(estado, out, msgs, texto, midia)) return out;
  if (estado.perguntaInicio && responderInicio(estado, out, msgs, texto, midia) === "fim") return out;
  if (estado.perguntaRecado && responderRecado(estado, out, msgs, texto, midia, entrada)) return out;
  // RECADO (pedido que não é ato, como "ver na prefeitura se dá para abrir CNPJ nesse ponto"): não abre
  // pedido nem mexe no que está em andamento; vai só para o Hub, como pendência própria
  const rec = recadoDoTexto(texto);
  if (rec !== null || (estado.aguardandoRecado && (midia || (texto && !PALAVRAS_COMANDO.test(t))))) {
    estado.aguardandoRecado = false;
    if (rec === "" && !midia) { estado.aguardandoRecado = true; msgs.push(PEDE_RECADO); return out; }
    recadoAgora(estado, out, msgs, rec !== null ? rec : texto, midia);
    return out;
  }
  estado.aguardandoRecado = false;
  // PEDIDO NOVO (23/11/2026): o Raoni mandou 5 fotos, 4 mensagens encaminhadas e "Constituição" no grupo,
  // e o robô, ainda preso ao pedido de 18/11 (baixa de uma filial), pôs as mensagens como comentário NELE.
  // Agora: depois de um pedido enviado, o que chega é pedido novo (só "comentário" não é); e com um pedido
  // em andamento, 20 minutos sem mensagem também abrem um novo (o de antes vai do jeito que estava).
  if (!midia && enviadoJa(estado) && RE_CORTESIA.test(texto)) return out;   // "obrigado" depois do envio: nada a fazer
  if (abreNovoDepoisDeEnviado(estado, entrada, texto, midia)) abrirPedidoNovo(estado, out, msgs, agora);
  else if (silencioLongo(estado, entrada, texto, midia, agora)) trocarPedido(estado, out, msgs, [], "silencio");

  // comandos globais (só em mensagem de texto: legenda de arquivo nunca é comando)
  if (midia && (estado.aguardandoComentario || comentarioDoTexto(texto) !== null)) {
    // arquivo mandado como comentário ("comentário" e depois o arquivo, ou na legenda): pergunta para qual pedido vai
    estado.aguardandoComentario = false;
    comentarComDestino(estado, out, msgs, { arq: midia, legenda: (comentarioDoTexto(texto) || "").slice(0, 120) }, agora);
    if (!estado.perguntaDestino && emAndamento(estado) && !(estado.arquivosPendentes || []).length) { const q = mensagemAtual(estado); if (q) msgs.push(q); }
    return out;
  }
  if (!midia) {
    // comentário para o Hub: "comentário: …", ou a mensagem logo depois de "comentário" sozinho
    // mensagem ENCAMINHADA (em geral do cliente) não responde pergunta: é comentário, marcado como encaminhado
    if (entrada.encaminhada && texto) {
      estado.aguardandoComentario = false;
      comentar(estado, out, msgs, texto, true);
      if (((estado.fluxo && estado.respostas.confirmar !== "sim") || estado.cancelando) && !(estado.arquivosPendentes || []).length) { const q = mensagemAtual(estado); if (q) msgs.push(q); }
      return out;
    }
    let coment = comentarioDoTexto(texto);
    if (coment === null && estado.aguardandoComentario && texto && !PALAVRAS_COMANDO.test(t)) coment = texto;
    estado.aguardandoComentario = false;
    if (coment !== null) {
      if (!coment) { estado.aguardandoComentario = true; msgs.push("💬 Escreva o comentário (ou mande o arquivo) na próxima mensagem. Ele vai para a solicitação no Atos e para a pendência no Hub (não muda as respostas do pedido)."); return out; }
      comentarComDestino(estado, out, msgs, { texto: coment }, agora);
      if (!estado.perguntaDestino && ((estado.fluxo && estado.respostas.confirmar !== "sim") || estado.cancelando)) { const q = mensagemAtual(estado); if (q) msgs.push(q); }
      return out;
    }
    if (/^(menu|recomeçar|recomecar|início|inicio|oi|olá|ola|bom dia|boa tarde|boa noite)$/i.test(t) && (!estado.fluxo || /^(menu|recomeçar|recomecar)$/i.test(t))) {
      if (estado.fluxo && Object.keys(estado.respostas).length && estado.respostas.confirmar !== "sim") { estado.cancelando = "menu"; msgs.push(CONF_MENU); return out; }
      const av = estado.fluxo ? null : estado.respostas["_arq.avulsos"], pend = estado.fluxo ? [] : (estado.arquivosPendentes || []);
      const notas = estado.fluxo ? null : estado.respostas._notas;
      zerarPedido(estado); if (av) estado.respostas["_arq.avulsos"] = av; if (notas) estado.respostas._notas = notas; estado.arquivosPendentes = pend;
      if (!estado.lgpdEm) { msgs.push(LGPD); estado.lgpdEm = new Date().toISOString(); } msgs.push(menuTexto(estado)); return out;
    }
    if (estado.cancelando) {
      if (/^(1|sim|s)$/i.test(t)) {
        const modo = estado.cancelando; out.descartar = todosArquivos(estado); estado.cancelando = null; zerarPedido(estado);
        if ((estado.comentarios || []).length && !estado.solicId) estado.comentarios = [];   // eram do pedido descartado
        if (modo === "cancelar") { out.acao = "cancelado"; msgs.push("Pedido cancelado. Para começar outro, mande *menu*."); } else msgs.push(menuTexto(estado));
        return out;
      }
      estado.cancelando = null; msgs.push("Seguimos de onde paramos."); retomar(estado, msgs); return out;
    }
    if (/^cancelar$/i.test(t)) { if (!estado.fluxo) { msgs.push("Não há pedido em andamento. Mande *menu* para começar."); return out; } estado.cancelando = "cancelar"; msgs.push(CONF_CANCELAR); return out; }
    if (RE_ENVIAR.test(t)) {
      if (!estado.fluxo) { msgs.push("Primeiro escolha o pedido."); msgs.push(menuTexto(estado)); return out; }
      if (estado.respostas.confirmar === "sim") { msgs.push("Este pedido já foi enviado. " + DEPOIS_DO_ENVIO); return out; }
      if (!temAlgo(estado)) { msgs.push("Ainda não há nada para enviar: mande a documentação ou responda a pergunta."); retomar(estado, msgs); return out; }
      enviarAgora(estado, out, msgs); return out;
    }
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

  // NOME DE ATO no meio de um pedido em andamento ("Baixa", "Alteração contratual"): provavelmente é outro pedido
  if (!midia && !entrada.encaminhada && estado.fluxo && !enviadoJa(estado) && !estado.aguardandoCorrecao && !estado.cancelando) {
    const v = nomeDoAto(texto);
    if (v && atoNoMeio(estado, out, msgs, v, texto, agora)) return out;
  }
  // sem pedido escolhido, frase que fala de consulta, prefeitura, viabilidade, alvará…: pergunta se é recado
  if (!midia && !entrada.encaminhada && !entrada.semRecado && !estado.fluxo && !enviadoJa(estado) && pareceRecado(texto)) {
    estado.perguntaRecado = { texto: texto.slice(0, 3000) };
    msgs.push(perguntaRecadoTexto(estado)); return out;
  }
  const pendentes = () => (estado.arquivosPendentes || []).length;
  const passoArq = (estado.fluxo && !estado.aguardandoCorrecao && !pendentes() && estado.respostas.confirmar !== "sim") ? passoAtual(estado) : null;

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
    if (texto.split(/\s+/).length >= 3) { anotar(estado, texto); msgs.push(`📝 Anotado: _${texto.slice(0, 120)}_ (vai junto no pedido).`); return out; }
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
  // Arquivo sem tipo esperando resposta. Texto que não é tipo de documento NÃO é jogado fora (até
  // 18/11/2026 era: a descrição do pedido escrita nessa hora se perdia): se descreve um pedido e ainda
  // não há pedido escolhido, escolhe o pedido; frase com 3+ palavras vira anotação. Depois pergunta de novo.
  if (pendentes()) {
    let tipo = escolherOpcao(texto, TIPOS_ARQ.map((x) => [x[0], x[1]])), desc = "";
    if (!tipo && /\b(engano|errad[oa]|descart|apag)/.test(semAcento(texto))) tipo = "descartar";
    if (!tipo) { tipo = classificarDoc(texto); desc = texto; }
    if (!tipo && !estado.fluxo && texto.length >= 4 && adivinharFluxo(texto)) { /* segue: escolhe o pedido logo abaixo */ }
    else if (!tipo && texto.split(/\s+/).length >= 3) { anotarOuComentar(estado, out, msgs, texto); msgs.push(perguntaTipoArquivo(estado)); return out; }
    else if (!tipo) { msgs.push("Não entendi o tipo. Responda com o *número* ou escreva o documento (ex.: *RG da Maria*).\n\n" + perguntaTipoArquivo(estado)); return out; }
    else {
      const arq = estado.arquivosPendentes.shift();
      if (tipo === "descartar") { out.descartar = (out.descartar || []).concat([arq]); msgs.push(`🗑 Descartei *${arq.nome}*.`); }
      else guardarClassificado(estado, out, msgs, rotular(arq, tipo, desc || arq.legenda));
      if (!pendentes()) estado.destinoPendentes = null;
      retomar(estado, msgs); return out;
    }
  }

  // sem fluxo: a resposta é o menu
  if (!estado.fluxo) {
    if (!estado.lgpdEm) { estado.lgpdEm = new Date().toISOString(); msgs.push(LGPD); }
    let v = escolherOpcao(texto, MENU), adivinhado = false;
    if (v === "recado") { estado.aguardandoRecado = true; msgs.push(PEDE_RECADO); return out; }
    const livre = texto.length >= 4 && !/^\d+([,\s]+\d+)*$/.test(t);
    if (!v && livre) { v = adivinharFluxo(texto); adivinhado = !!v; anotar(estado, texto); }
    if (!v) { if (livre) msgs.push(`📝 Anotei: _${texto.slice(0, 120)}_ (vai junto no pedido).`); msgs.push(menuTexto(estado)); return out; }
    escolherFluxo(estado, msgs, v, adivinhado); return out;
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

  // pedido já enviado (inclusive com "enviar" antes do fim): nada mais responde pergunta dele
  const p = estado.respostas.confirmar === "sim" ? null : passoAtual(estado);
  if (!p) {
    // tudo respondido: confirmação final
    if (estado.respostas.confirmar === undefined) {
      if (/^(1|sim|confirmar|confirmo|ok)$/i.test(t)) { estado.respostas.confirmar = "sim"; estado.encerrado = true; estado.enviadoEm = new Date().toISOString(); out.acao = "criar_solicitacao"; out.dados = montarSolicitacao(estado); levarComentarios(estado, out.dados); msgs.push("✅ Pedido enviado: já está no Atos, na lista de solicitações, para a legalização.\n" + DEPOIS_DO_ENVIO); return out; }
      if (/^(2|corrigir|não|nao|n)$/i.test(t)) { estado.aguardandoCorrecao = true; msgs.push(resumo(estado) + "\n\nQual item quer corrigir? Digite o *número*."); return out; }
      msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo"); return out;
    }
    // pedido já enviado: frase solta vira comentário nele (antes era respondida com este aviso e se perdia)
    if (texto.split(/\s+/).length >= 3 && estado.solicId) { comentar(estado, out, msgs, texto); return out; }
    msgs.push("Este pedido já foi enviado. " + DEPOIS_DO_ENVIO); return out;
  }

  const v = validar(p, texto);
  // "está no documento" / "consta na ata": a informação já veio nos arquivos; não insiste
  if (!v.ok && NUMERICOS.includes(p.tipo) && !/\d/.test(texto) && /\b(document\w*|ata|contrato|anexo|cabecalho|consta|arquivo|pdf|ccmei|cartao)\b/.test(semAcento(texto))) {
    anotar(estado, `${rotuloPasso(p, estado)}: ${texto.slice(0, 200)}`); estado.respostas[p.id] = ""; estado.ordem.push(p.id);
    msgs.push(`📝 Certo, ${rotuloPasso(p, estado).replace(/\?$/, "")} fica para ver no documento.`);
    const prox = passoAtual(estado);
    if (prox) msgs.push(textoPergunta(prox, estado)); else msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo");
    return out;
  }
  // frase sem número numa pergunta de número/data/e-mail ("cliente com pressa" no CNPJ) é anotação, não erro
  if (!v.ok && NUMERICOS.includes(p.tipo) && !/\d/.test(texto) && texto.split(/\s+/).length >= 3) {
    anotar(estado, texto); msgs.push(`📝 Anotado: _${texto.slice(0, 120)}_ (vai junto no pedido).`); msgs.push(textoPergunta(p, estado)); return out;
  }
  if (!v.ok) { msgs.push(v.erro); msgs.push(textoPergunta(p, estado)); return out; }
  estado.respostas[p.id] = v.valor; estado.ordem.push(p.id);
  const prox = passoAtual(estado);
  if (prox) msgs.push(textoPergunta(prox, estado));
  else msgs.push(resumo(estado) + "\n\nEstá tudo certo? *1* — Confirmar e enviar · *2* — Corrigir algo");
  return out;
}
// Pedido escolhido (pelo menu, pela mensagem ou pelo nome do ato): o que veio antes entra nele
function escolherFluxo(estado, msgs, v, adivinhado) {
  // pedido novo depois de um enviado: não herda o processo nem a empresa do anterior
  if (estado.encerrado) { estado.solicId = ""; estado.empresa = ""; estado.cnpj = ""; estado.vinculo = null; estado.casoId = ""; estado.encerrado = false; }
  const av = estado.respostas["_arq.avulsos"], notas = estado.respostas._notas;   // mandados antes de escolher o pedido
  estado.fluxo = v; estado.respostas = {}; estado.ordem = []; estado.rotuloProximo = null;
  const passoDocs = FLUXOS[v].passos.find((p) => p.tipo === "arquivo");
  if (av && av.length && passoDocs) estado.respostas["_arq." + passoDocs.id] = av; else if (av) estado.respostas["_arq.avulsos"] = av;
  if (notas && notas.length) { if (v === "outro") estado.respostas.descricao = notas.join(" / "); else estado.respostas._notas = notas; }
  if (estado.cnpj && FLUXOS[v].passos.some((p) => p.id === "cnpj")) { estado.respostas.cnpj = fmtCNPJ(estado.cnpj); estado.ordem.push("cnpj"); }
  if (estado.respostas.descricao) estado.ordem.push("descricao");
  // alteração: o que muda já dito na mensagem ("altere a denominação social") não é perguntado
  if (v === "alterar" && notas && notas.length) { const m = mudancasDoTexto(notas.join(" ")); if (m.length) { estado.respostas.oQueMuda = m; estado.ordem.push("oQueMuda"); } }
  msgs.push(`Vamos lá: *${FLUXOS[v].nome}*.` + (adivinhado ? " (Entendi pela mensagem. Se não for isso, mande *menu*.)" : ""));
  if (av && av.length && !passoDocs) msgs.push(`Já está guardado: ${av.map(descricaoCurta).join("; ")}.`);
  // arquivo ainda sem tipo (o pedido foi escrito enquanto o robô perguntava): entra na documentação do pedido
  if ((estado.arquivosPendentes || []).length) { if (passoDocs) { estado.respostas["_arq." + passoDocs.id] = estado.respostas["_arq." + passoDocs.id] || []; estado.destinoPendentes = "_arq." + passoDocs.id; } msgs.push(perguntaTipoArquivo(estado)); return; }
  const p0 = passoAtual(estado); if (p0) msgs.push(textoPergunta(p0, estado));
}
// "enviar": fecha a documentação em aberto e manda o pedido com o que já tem; o que faltou vai listado.
// Arquivo ainda sem tipo vai como "Não identificado" (montarSolicitacao) e não é mais perguntado: o que
// chega depois do envio já é pedido novo.
function enviarAgora(estado, out, msgs) {
  const r = estado.respostas;
  Object.keys(r).filter((k) => k.startsWith("_arq.") && k !== "_arq.avulsos").forEach((k) => {
    const id = k.slice(5), lista = Array.isArray(r[k]) ? r[k] : [];
    const pend = lista.filter((a) => a.pendente).map((a) => { const c = Object.assign({}, a); delete c.pendente; return c; });
    if (r[id] === undefined) { r[id] = lista.filter((a) => !a.pendente); estado.ordem.push(id); } else r[id] = (r[id] || []).concat(lista.filter((a) => !a.pendente));
    estado.arquivosPendentes = (estado.arquivosPendentes || []).concat(pend); delete r[k];
  });
  estado.cancelando = null; estado.aguardandoCorrecao = false; estado.rotuloProximo = null;
  r.confirmar = "sim"; estado.encerrado = true; estado.enviadoAntesDoFim = true; estado.enviadoEm = new Date().toISOString();
  out.acao = "criar_solicitacao"; out.dados = montarSolicitacao(estado); levarComentarios(estado, out.dados);
  const semTipo = (estado.arquivosPendentes || []).length;
  estado.arquivosPendentes = []; estado.destinoPendentes = null; estado.perguntaInicio = null; estado.ultimas = [];
  const faltou = out.dados.faltou || [];
  msgs.push(resumo(estado) + "\n\n✅ Pedido enviado com o que já tem: está no Atos, na lista de solicitações, para a legalização." +
    (faltou.length ? `\nFicou para a legalização ver nos documentos: ${faltou.join("; ").replace(/\?$/, "")}.` : "") +
    (semTipo ? `\n${semTipo > 1 ? semTipo + " arquivos foram" : "1 arquivo foi"} como *Não identificado*.` : "") + "\n" + DEPOIS_DO_ENVIO);
}
const DEPOIS_DO_ENVIO = "O que chegar agora (arquivo ou mensagem) começa um *pedido novo*. Para juntar a este, escreva *comentário* antes.";
const naoIdentificado = (a) => { const c = Object.assign({}, a, { doc: "", docNome: "Não identificado", nome: `Não identificado — ${a.nome}` }); delete c.pendente; return c; };

// ─── pedido novo ──────────────────────────────────────────────────────────────
// Regras dele (23/11/2026). É pedido novo:
//  • o que chega depois de um pedido enviado ("enviar", confirmação ou envio sozinho), menos "comentário";
//  • o que chega depois de 20 minutos sem mensagem, com um pedido em andamento (que vai do jeito que estava);
//  • o nome de outro ato no meio de um pedido ("Baixa", "Alteração contratual"). Se antes dele vieram
//    arquivos ou frases soltas, o robô pergunta a partir de qual mensagem é o pedido novo.
// "comentário …" (texto ou arquivo) pergunta para qual pedido vai, quando há mais de um possível.
const SILENCIO_NOVO_MS = 20 * 60000, RECENTES_MS = 3 * 24 * 3600 * 1000;
const RE_CORTESIA = /^(obrigad[oa]s?|muito obrigad[oa]|obg|valeu|vlw|blz|beleza|show|certo|ok+|okay|perfeito|top|massa|[👍🙏👏✅]+)[\s!.]*$/iu;
const RE_INICIO_ATO = /^(abrir|abertura|constitui\w*|nova empresa|empresa nova|alterac\w*|alterar|baixa|baixar|fechar|fechamento|encerra\w*|distrato|dissoluc\w*|transforma\w*|advocacia|sociedade de advocacia)\b/;
const enviadoJa = (e) => !!(e && e.respostas && e.respostas.confirmar === "sim");
const emAndamento = (e) => !enviadoJa(e) && !!(e.fluxo || todosArquivos(e).length);
const fuso = { timeZone: "America/Sao_Paulo" };
const horaCurta = (iso) => new Date(iso || Date.now()).toLocaleString("pt-BR", Object.assign({ hour: "2-digit", minute: "2-digit" }, fuso));
const diaHora = (iso) => new Date(iso || Date.now()).toLocaleString("pt-BR", Object.assign({ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }, fuso));
// "Constituição", "Baixa da filial", "Alteração contratual" → o fluxo; frase comum → null
function nomeDoAto(texto) {
  const t = String(texto || "").trim();
  if (!t || t.split(/\s+/).length > 5) return null;
  return RE_INICIO_ATO.test(semAcento(t).replace(/^[^a-z]+/, "")) ? adivinharFluxo(t) : null;
}
function abreNovoDepoisDeEnviado(estado, entrada, texto, midia) {
  if (!enviadoJa(estado) || estado.cancelando || estado.aguardandoComentario || comentarioDoTexto(texto) !== null) return false;
  if (midia || (entrada.encaminhada && texto)) return true;
  if (!texto || /^\d{1,2}$/.test(texto) || PALAVRAS_COMANDO.test(texto) || RE_ENVIAR.test(texto) || comandoPausa(texto)) return false;
  return true;
}
function silencioLongo(estado, entrada, texto, midia, agora) {
  if (!emAndamento(estado) || estado.cancelando || estado.aguardandoComentario || comentarioDoTexto(texto) !== null) return false;
  const ultima = ultimaAtividade(estado);
  if (!ultima || agora - ultima < SILENCIO_NOVO_MS) return false;
  return !(!midia && texto && (PALAVRAS_COMANDO.test(texto) || RE_ENVIAR.test(texto) || RE_CORTESIA.test(texto)));
}
// Zera a conversa para um pedido novo (não herda processo, empresa, vínculo nem comentários)
function novoPedido(estado, extra) {
  zerarPedido(estado);
  Object.assign(estado, { solicId: "", empresa: "", cnpj: "", vinculo: null, casoId: "", encerrado: false, enviadoAntesDoFim: false, enviadoEm: null,
    comentarios: [], autoAvisoEm: null, aguardandoComentario: false, perguntaInicio: null, perguntaDestino: null, ultimas: [] }, extra || {});
}
// Depois de um pedido enviado
function abrirPedidoNovo(estado, out, msgs) {
  const anterior = estado.solicId || "", nomeAnterior = (FLUXOS[estado.fluxo] || {}).nome || "";
  // arquivo sem tipo que sobrou do pedido enviado (de antes da versão de 23/11): não se perde, vai para ele
  const pend = estado.arquivosPendentes || [];
  if (pend.length && anterior) { out.anexar = pend.map(naoIdentificado); out.anexarEm = anterior; out.acao = "anexar"; }
  novoPedido(estado, { solicAnterior: anterior, arquivosPendentes: anterior ? [] : pend });
  msgs.push(`📂 Pedido novo${nomeAnterior ? ` (o anterior, *${nomeAnterior}*, já foi enviado)` : ""}.`);
}
// Com um pedido em andamento: ele vai do jeito que está (menos o que foi `movidos` para o novo) e começa outro.
// movidos = mensagens de estado.ultimas que passam para o pedido novo (arquivos, anotações, comentários).
function trocarPedido(estado, out, msgs, movidos, motivo) {
  const velho = JSON.parse(JSON.stringify(estado));
  const caminhos = new Set(movidos.map((m) => m.caminho).filter(Boolean)), ids = new Set(movidos.map((m) => m.comentId).filter(Boolean));
  const arqs = [];
  const tira = (lista) => lista.filter((a) => { if (a && typeof a === "object" && a.caminho && caminhos.has(a.caminho)) { arqs.push(a); return false; } return true; });
  Object.keys(velho.respostas || {}).forEach((k) => { if (k !== "_notas" && Array.isArray(velho.respostas[k])) velho.respostas[k] = tira(velho.respostas[k]); });
  velho.arquivosPendentes = tira(velho.arquivosPendentes || []);
  const notas = (velho.respostas._notas || []).slice(), notasNovo = [];
  movidos.filter((m) => m.nota).forEach((m) => { const i = notas.indexOf(m.nota); if (i >= 0) { notas.splice(i, 1); notasNovo.push(m.nota); } });
  velho.respostas._notas = notas;
  let comNovo = (velho.comentarios || []).filter((c) => ids.has(c.id));
  velho.comentarios = (velho.comentarios || []).filter((c) => !ids.has(c.id));
  const nomeVelho = (FLUXOS[velho.fluxo] || {}).nome || "";
  let tinha = -1;
  if (velho.fluxo || todosArquivos(velho).length) {
    const tmp = { estado: velho, mensagens: [], acao: null };
    tinha = fecharComoEsta(velho, tmp, tmp.mensagens);
    out.criarAnterior = { solicId: velho.solicId || "", dados: tmp.dados };
  } else { comNovo = velho.comentarios.concat(comNovo); notasNovo.unshift(...notas); }
  novoPedido(estado, { solicAnterior: velho.solicId || "" });
  const classificados = arqs.filter((a) => a.doc && !a.pendente);
  if (classificados.length) estado.respostas["_arq.avulsos"] = classificados;
  if (notasNovo.length) estado.respostas._notas = notasNovo;
  estado.arquivosPendentes = arqs.filter((a) => !classificados.includes(a)).map((a) => { const c = Object.assign({}, a); delete c.pendente; return c; });
  estado.comentarios = comNovo; estado.ultimas = movidos.slice();
  msgs.push("📂 Pedido novo." + (tinha >= 0 ? ` O pedido em andamento (*${nomeVelho}*) foi enviado do jeito que estava${motivo === "silencio" ? ", porque ficou 20 minutos sem mensagem" : ""}` +
    (tinha ? ` (${tinha > 1 ? tinha + " arquivos sem tipo foram" : "1 arquivo sem tipo foi"} como *Não identificado*)` : "") + "." : "") +
    (arqs.length ? ` ${arqs.length > 1 ? arqs.length + " arquivos vieram" : "1 arquivo veio"} para o pedido novo.` : ""));
}
// As últimas mensagens que podem ser do pedido novo: arquivos, anotações e comentários depois da
// última resposta a uma pergunta do robô (até 8, dos últimos 20 minutos)
function mensagensSoltas(estado, agora) {
  const u = estado.ultimas || [], soltas = [];
  for (let i = u.length - 1; i >= 0 && soltas.length < 8; i--) {
    const m = u[i];
    if (m.uso === "resposta" || agora - (Date.parse(m.em || "") || 0) > SILENCIO_NOVO_MS) break;
    soltas.unshift(m);
  }
  return soltas;
}
// Nome de ato com pedido em andamento. Devolve true quando a mensagem para aqui.
function atoNoMeio(estado, out, msgs, v, texto, agora) {
  const mesmo = v === estado.fluxo;
  if (!temAlgo(estado) && !todosArquivos(estado).length) {
    if (mesmo) return false;
    // pedido escolhido, mas nada respondido ainda: só troca
    const notas = estado.respostas._notas, av = estado.respostas["_arq.avulsos"], antes = FLUXOS[estado.fluxo].nome;
    estado.respostas = {}; if (notas) estado.respostas._notas = notas; if (av) estado.respostas["_arq.avulsos"] = av;
    msgs.push(`Troquei o pedido (era *${antes}*, sem nada respondido).`);
    anotar(estado, texto); escolherFluxo(estado, msgs, v, false); return true;
  }
  const soltas = mensagensSoltas(estado, agora);
  if (!soltas.length && !mesmo) { trocarPedido(estado, out, msgs, [], "ato"); anotar(estado, texto); escolherFluxo(estado, msgs, v, false); return true; }
  estado.perguntaInicio = { fluxo: v, texto: texto.slice(0, 300), itens: soltas, mesmo };
  msgs.push(perguntaInicioTexto(estado)); return true;
}
function perguntaInicioTexto(estado) {
  const pi = estado.perguntaInicio, n = pi.itens.length, atual = (FLUXOS[estado.fluxo] || {}).nome || "pedido", curto = pi.texto.slice(0, 50);
  return `📂 “${curto}” parece um *pedido novo* (${FLUXOS[pi.fluxo].nome}), e há um pedido em andamento (*${atual}*).` +
    (n ? " A partir de qual mensagem é o pedido novo?\n" + pi.itens.map((m, i) => `*${i + 1}* — ${m.rotulo}`).join("\n") : "") +
    `\n*${n + 1}* — ${n ? `Só a partir de “${curto}”` : "É pedido novo"}\n*${n + 2}* — Não é pedido novo (continua o de *${atual}*)` +
    `\n_O pedido em andamento vai do jeito que está${n ? ", com o que veio antes da mensagem escolhida" : ""}._`;
}
// "fim": a mensagem era a resposta; "segue": não respondeu, vale o mais provável e a mensagem continua
function responderInicio(estado, out, msgs, texto, midia) {
  const pi = estado.perguntaInicio, n = pi.itens.length; estado.perguntaInicio = null;
  const k = !midia && /^\s*\d+\s*$/.test(texto) ? Number(texto) : NaN, respondeu = k >= 1 && k <= n + 2;
  if (k === n + 2 || (!respondeu && pi.mesmo)) {
    anotar(estado, pi.texto);
    if (!respondeu) return "segue";
    msgs.push(`Certo: continua o pedido de *${FLUXOS[estado.fluxo].nome}* (anotei “${pi.texto.slice(0, 50)}”).`); retomar(estado, msgs); return "fim";
  }
  trocarPedido(estado, out, msgs, k >= 1 && k <= n ? pi.itens.slice(k - 1) : [], "ato");
  anotar(estado, pi.texto); escolherFluxo(estado, msgs, pi.fluxo, false);
  if (respondeu) return "fim";
  msgs.push(`(Sem número na resposta: o pedido novo começou em “${pi.texto.slice(0, 50)}”.)`);
  return "segue";
}

// ─── recado: pedido que não é ato ─────────────────────────────────────────────
// Caso de 18/11/2026: o Raoni mandou a foto de um ponto e um áudio ("preciso ver consulta e prefeitura
// para ver se esse ponto a gente pode abrir um CNPJ"). Não é ato: é trabalho para a equipe. Virou
// comentário do pedido da ITN; com as regras de pedido novo viraria um "Abrir empresa". Agora é RECADO:
// sai em out.recado e o index.js abre uma PENDÊNCIA PRÓPRIA NO HUB. Nada fica no Atos (decisão dele:
// "o Atos é só para atos") — nem solicitação, nem lista, nem o arquivo.
//  • "recado: …", ou "recado" e depois o texto, o áudio ou o arquivo; ou a opção do menu;
//  • sem pedido escolhido, frase que fala de consulta, prefeitura, viabilidade, alvará, certidão… → o robô pergunta.
// Sem pedido escolhido, o recado leva o que estava solto (arquivos, anotações, encaminhadas): era o contexto dele.
const RE_RECADO = /^\s*(?:recado|tarefa)(?=$|[\s:,;.\-–])[\s:,;.\-–]*/i;
const RE_SERVICO = /\b(consult\w*|prefeitura|viabilidade|alvara\w*|certid\w*|analis\w*|parecer|uso do solo|bombeiros?|vigilancia sanitaria|licenca\w*|licenciamento|habite se|habitese|zoneamento|inscricao (municipal|estadual))\b/;
const PEDE_RECADO = "📌 Escreva o recado (ou mande o áudio ou o arquivo) na próxima mensagem. Ele vira uma pendência no Hub, sem abrir pedido de ato.";
function recadoDoTexto(texto) {
  const t = String(texto || ""), m = RE_RECADO.exec(t);
  return m ? t.slice(m[0].length).trim() : null;
}
function pareceRecado(texto) {
  const t = String(texto || "").trim();
  if (t.split(/\s+/).length < 6 || comentarioDoTexto(t) !== null) return false;
  const s = semAcento(t).replace(/^[^a-z]+/, "");
  return RE_SERVICO.test(" " + s + " ") && !RE_INICIO_ATO.test(s);
}
function perguntaRecadoTexto(estado) {
  const soltos = !estado.fluxo ? todosArquivos(estado).length : 0;
  return "📌 Isso parece um *recado para a equipe*, não um pedido de ato. É isso?\n*1* — Sim, é recado (vira pendência no Hub)\n*2* — Não, é um pedido de ato" +
    (soltos ? `\n_${soltos > 1 ? "Os " + soltos + " arquivos mandados antes contam" : "O arquivo mandado antes conta"} como parte do recado._` : "");
}
// true: a mensagem era a resposta. Sem resposta, fica como recado (foi o que o robô entendeu) e a mensagem segue.
function responderRecado(estado, out, msgs, texto, midia, entrada) {
  const pr = estado.perguntaRecado; estado.perguntaRecado = null;
  const s = midia ? "" : semAcento(texto).trim();
  const k = /^(1|sim|s|e recado|recado)$/.test(s) ? 1 : (/^(2|nao|n|ato|e ato)$/.test(s) ? 2 : 0);
  if (k === 2) {
    // não é recado: o texto segue como se tivesse acabado de chegar (escolhe o pedido ou vira anotação)
    const sub = receberMensagem(estado, Object.assign({}, entrada, { texto: pr.texto, midia: null, encaminhada: false, semRecado: true }));
    Object.keys(estado).forEach((x) => delete estado[x]); Object.assign(estado, sub.estado);
    ["acao", "dados", "anexar", "anexarEm", "descartar", "comentario", "comentarEm", "anexarOutros", "criarAnterior", "recado"].forEach((x) => { if (sub[x] != null) out[x] = sub[x]; });
    msgs.push(...sub.mensagens); return true;
  }
  criarRecado(estado, out, msgs, pr.texto, !estado.fluxo && !enviadoJa(estado));
  if (k === 1) return true;
  msgs.push("(Sem resposta: ficou como recado.)");
  if (!midia && RE_CORTESIA.test(texto)) return true;   // "Certo", "ok": nada mais a fazer
  return false;
}
function recadoAgora(estado, out, msgs, texto, midia) {
  const absorver = !estado.fluxo && !enviadoJa(estado);
  criarRecado(estado, out, msgs, texto || (midia && midia.legenda) || "", absorver, midia);
  if (emAndamento(estado) || estado.cancelando) { const q = mensagemAtual(estado); if (q) msgs.push(q); }
}
// O arquivo do recado não fica no Atos: vai em out.descartar (o index apaga do Storage) e a pendência diz
// que ele está no grupo, com o nome e a hora.
function criarRecado(estado, out, msgs, texto, absorver, midia) {
  const r = estado.respostas || {}, arquivos = [], notas = [], mensagens = [];
  if (absorver) {
    Object.keys(r).forEach((k) => { if (k !== "_notas" && Array.isArray(r[k])) r[k].forEach((a) => { if (a && typeof a === "object" && a.caminho) arquivos.push(a); }); });
    (estado.arquivosPendentes || []).forEach((a) => arquivos.push(a));
    (r._notas || []).forEach((n) => notas.push(String(n)));
    (estado.comentarios || []).forEach((c) => mensagens.push((c.encaminhada ? "↪️ " : "💬 ") + String(c.texto).replace(MARCA_ENCAMINHADA, "").replace(/\s*\n\s*/g, " ").trim()));
  }
  if (midia) arquivos.push(midia);
  out.recado = { texto: String(texto || "").trim().slice(0, 3000), por: estado.remetenteNome || estado.remetenteTel || "",
    participantes: (estado.participantes || []).slice(), notas, mensagens, em: new Date().toISOString(),
    arquivos: arquivos.map((a) => ({ nome: a.nome || "arquivo", em: a.em || "", legenda: a.legenda || "" })) };
  out.descartar = (out.descartar || []).concat(arquivos.filter((a) => a.caminho));
  if (absorver) { estado.respostas = {}; estado.ordem = []; estado.arquivosPendentes = []; estado.destinoPendentes = null; estado.comentarios = []; estado.ultimas = []; estado.rotuloProximo = null; estado.autoAvisoEm = null; }
  const n = arquivos.length;
  msgs.push("📌 *Recado* anotado para a equipe (não é ato): vai para o Hub como pendência." + (n ? ` ${n > 1 ? "Os " + n + " arquivos ficam" : "O arquivo fica"} só aqui no grupo.` : "") +
    (absorver ? "" : " O pedido em andamento continua."));
}

// ─── comentário: para qual pedido vai ─────────────────────────────────────────
function rotuloPedido(p) {
  const nome = p.fluxoNome || (FLUXOS[p.fluxo] || {}).nome || "";
  return `${p.empresa || "Pedido " + p.id}${nome ? " — " + nome : ""}${p.em ? ", enviado " + diaHora(p.em) : ""}`;
}
// O pedido em andamento (ou o processo vinculado) e os enviados nos últimos 3 dias, até 4
function opcoesDestino(estado, agora) {
  const ops = [];
  if (emAndamento(estado) || (estado.solicId && !enviadoJa(estado)))
    ops.push({ atual: true, rotulo: "O pedido em andamento" + (estado.fluxo ? ` (${FLUXOS[estado.fluxo].nome}${estado.empresa ? ", " + estado.empresa : ""})` : "") });
  const lista = [];
  if (enviadoJa(estado) && estado.solicId) lista.push({ id: estado.solicId, empresa: estado.empresa, fluxo: estado.fluxo, em: estado.enviadoEm });
  const rec = (estado.pedidosRecentes || []).filter((p) => p && p.id && agora - (Date.parse(p.em || "") || 0) <= RECENTES_MS);
  lista.push(...rec);
  if (!rec.length && estado.solicAnterior) lista.push({ id: estado.solicAnterior });
  lista.forEach((p) => { if (ops.length < 4 && !ops.some((o) => o.id === p.id)) ops.push({ id: p.id, rotulo: rotuloPedido(Object.assign({}, rec.find((x) => x.id === p.id) || {}, p)) }); });
  return ops;
}
// item = { texto } ou { arq, legenda }
function comentarComDestino(estado, out, msgs, item, agora) {
  const ops = opcoesDestino(estado, agora);
  if (ops.length <= 1) { aplicarDestino(estado, out, msgs, item, ops[0] || null); return; }
  estado.perguntaDestino = { item, opcoes: ops };
  msgs.push(perguntaDestinoTexto(estado));
}
function perguntaDestinoTexto(estado) {
  const pd = estado.perguntaDestino;
  return `💬 Para qual pedido vai ${pd.item.arq ? `o arquivo *${pd.item.arq.nome}*` : "o comentário"}?\n` + pd.opcoes.map((o, i) => `*${i + 1}* — ${o.rotulo}`).join("\n");
}
function aplicarDestino(estado, out, msgs, item, op) {
  const paraOutro = !!(op && op.id && op.id !== estado.solicId);
  if (!item.arq) {
    if (!paraOutro) { comentar(estado, out, msgs, item.texto); return; }
    out.comentarEm = (out.comentarEm || []).concat([{ solicId: op.id, comentario: novoComentario(estado, item.texto) }]);   // o webhook diz se entrou
    return;
  }
  const tipo = classificarDoc(item.legenda) || classificarDoc(item.arq.nome);
  const doc = tipo ? rotular(item.arq, tipo, item.legenda) : null;
  if (paraOutro) {
    const it = doc || naoIdentificado(item.arq);
    out.anexarOutros = (out.anexarOutros || []).concat([{ solicId: op.id, itens: [it] }]);
    msgs.push(`📎 ${descricaoCurta(it)}: juntado a *${op.rotulo}*.`); return;
  }
  if (enviadoJa(estado)) {
    const it = doc || naoIdentificado(item.arq);
    out.anexar = (out.anexar || []).concat([it]); out.acao = out.acao || "anexar"; msgs.push(`📎 ${descricaoCurta(it)}: juntado ao pedido já enviado.`); return;
  }
  if (doc) { guardarClassificado(estado, out, msgs, doc); return; }
  estado.arquivosPendentes = (estado.arquivosPendentes || []).concat([Object.assign({}, item.arq, item.legenda ? { legenda: item.legenda } : {})]);
}
// true: a mensagem era a resposta. Sem número, vai para a 1ª opção (a mais provável) e a mensagem continua.
function responderDestino(estado, out, msgs, texto, midia) {
  const pd = estado.perguntaDestino; estado.perguntaDestino = null;
  const k = !midia && /^\s*\d+\s*$/.test(texto) ? Number(texto) : NaN, ok = k >= 1 && k <= pd.opcoes.length, op = pd.opcoes[ok ? k - 1 : 0];
  aplicarDestino(estado, out, msgs, pd.item, op);
  if (!ok) { msgs.push(`(Sem número na resposta: ${pd.item.arq ? "o arquivo" : "o comentário"} foi para *${op.rotulo}*.)`); return false; }
  if (emAndamento(estado) || estado.cancelando) { const q = mensagemAtual(estado); if (q) msgs.push(q); }
  return true;
}
// O que cada mensagem foi, para a pergunta "a partir de qual mensagem" (estado.ultimas)
function registrarMensagem(antes, out, entrada) {
  const e = out.estado;
  if (enviadoJa(e)) { e.ultimas = []; return; }
  const midia = entrada.midia, texto = String(entrada.texto || "").trim(), em = new Date(entrada.agora || Date.now()).toISOString();
  let m = null;
  if (midia && midia.caminho) m = { uso: "arquivo", caminho: midia.caminho, rotulo: `📎 ${midia.nome}${texto ? ` (“${texto.slice(0, 30)}”)` : ""}, ${horaCurta(em)}` };
  else if (texto) {
    const ca = new Set((antes.comentarios || []).map((c) => c.id)), c = (e.comentarios || []).find((x) => !ca.has(x.id));
    const na = (antes.respostas && antes.respostas._notas) || [], nd = (e.respostas && e.respostas._notas) || [];
    if (c) m = { uso: "comentario", comentId: c.id, rotulo: `${c.encaminhada ? "↪️ " : "💬 "}“${String(c.texto).replace(MARCA_ENCAMINHADA, "").replace(/\s+/g, " ").slice(0, 40)}”, ${horaCurta(em)}` };
    else if (nd.length && (nd.length > na.length || nd[nd.length - 1] !== na[na.length - 1])) m = { uso: "nota", nota: nd[nd.length - 1], rotulo: `📝 “${nd[nd.length - 1].slice(0, 40)}”, ${horaCurta(em)}` };
    else m = { uso: "resposta", rotulo: `“${texto.slice(0, 40)}”` };
  }
  if (m) { m.em = em; e.ultimas = (e.ultimas || []).concat([m]).slice(-12); }
}

// ─── envio automático por falta de resposta ────────────────────────────────────
// Pedido em andamento, com arquivo, parado há 10 minutos: o robô avisa que manda em 1 minuto; sem
// mensagem nova nesse minuto, manda do jeito que está (como o comando "enviar") e diz no grupo.
// Quem chama é o relógio do index.js (a cada minuto). "agora" e as marcas são em milissegundos/ISO.
const AVISO_INATIVO_MS = 10 * 60000, ENVIO_DEPOIS_AVISO_MS = 60000;
function ultimaAtividade(estado) {
  return Math.max(Date.parse(estado.ultimaMsgEm || "") || 0, estado.pausaAte ? Number(estado.pausaAte) - PAUSA_MS : 0);
}
// "avisar", "enviar" ou null
function inatividade(estado, agora) {
  if (!estado || estado.cancelando || pausado(estado, agora)) return null;
  if (!estado.respostas || estado.respostas.confirmar === "sim") return null;
  if (!todosArquivos(estado).length) return null;
  const ultima = ultimaAtividade(estado); if (!ultima) return null;
  const aviso = Date.parse(estado.autoAvisoEm || "") || 0;
  // o relógio bate a cada minuto: 10 s de folga para o envio não escorregar para o minuto seguinte
  if (aviso > ultima) return agora - aviso >= ENVIO_DEPOIS_AVISO_MS - 10000 ? "enviar" : null;
  return agora - ultima >= AVISO_INATIVO_MS ? "avisar" : null;
}
const AVISO_INATIVO = "⏳ Faz 10 minutos que não chega mensagem neste pedido. Se ninguém mandar mais nada em *1 minuto*, eu envio do jeito que está (documentos e informações) para o Atos.";
// Manda o pedido do jeito que está (sem pedido escolhido, o tipo sai do que foi escrito, ou "Outro
// assunto"); arquivo sem tipo entra na documentação como "Não identificado". Devolve quantos eram sem tipo.
function fecharComoEsta(estado, out, msgs) {
  if (!estado.fluxo) {
    const notas = estado.respostas._notas || [];
    const v = adivinharFluxo(notas.concat((estado.comentarios || []).map((c) => c.texto)).join(" ")) || "outro";
    estado.fluxo = v;
    if (v === "outro" && notas.length) estado.respostas.descricao = notas.join(" / ");
  }
  const passoDocs = FLUXOS[estado.fluxo].passos.find((p) => p.tipo === "arquivo");
  let tinha = 0;
  Object.keys(estado.respostas).filter((k) => k.startsWith("_arq.") && k !== "_arq.avulsos").forEach((k) => {
    estado.respostas[k] = (estado.respostas[k] || []).map((a) => (a.pendente ? (tinha++, naoIdentificado(a)) : a)); });
  if ((estado.arquivosPendentes || []).length && passoDocs) {
    tinha += estado.arquivosPendentes.length;
    const destino = estado.respostas[passoDocs.id] !== undefined ? passoDocs.id : "_arq." + passoDocs.id;
    estado.respostas[destino] = (estado.respostas[destino] || []).concat(estado.arquivosPendentes.map(naoIdentificado));
    estado.arquivosPendentes = []; estado.destinoPendentes = null;
  } else tinha += (estado.arquivosPendentes || []).length;
  estado.perguntaInicio = null;
  enviarAgora(estado, out, msgs);
  return tinha;
}
function enviarPorInatividade(estadoIn) {
  const estado = JSON.parse(JSON.stringify(estadoIn)), msgs = [], out = { estado, mensagens: msgs, acao: null };
  const agora = Date.now();
  // pergunta do robô sem resposta: vale a opção mais provável
  if (estado.perguntaDestino) {
    const pd = estado.perguntaDestino; estado.perguntaDestino = null;
    aplicarDestino(estado, out, [], pd.item, pd.opcoes[0]);
    if (out.acao === "comentar" && out.comentario) { out.comentarEm = (out.comentarEm || []).concat([{ solicId: estado.solicId, comentario: out.comentario }]); out.acao = null; out.comentario = null; }
    if (out.acao === "anexar") out.acao = null;
  }
  if (estado.perguntaRecado) {
    // o robô achou que era recado e ninguém respondeu: fica como recado (sem criar pedido de ato)
    const pr = estado.perguntaRecado; estado.perguntaRecado = null;
    criarRecado(estado, out, msgs, pr.texto, !estado.fluxo);
    msgs[msgs.length - 1] = "⏱️ Ninguém respondeu por 11 minutos. " + msgs[msgs.length - 1];
    estado.autoAvisoEm = null; estado.autoEnviadoEm = new Date(agora).toISOString();
    return out;
  }
  if (estado.perguntaInicio && !estado.perguntaInicio.mesmo) {
    const pi = estado.perguntaInicio; estado.perguntaInicio = null;
    trocarPedido(estado, out, msgs, [], "ato"); anotar(estado, pi.texto); escolherFluxo(estado, msgs, pi.fluxo, false);
    msgs[0] = "⏱️ Ninguém respondeu por 11 minutos. " + msgs[0];
    estado.autoAvisoEm = null; estado.autoEnviadoEm = new Date(agora).toISOString();
    return out;
  }
  if (estado.perguntaInicio) anotar(estado, estado.perguntaInicio.texto);
  const tinha = fecharComoEsta(estado, out, msgs);
  estado.autoAvisoEm = null; estado.autoEnviadoEm = new Date(agora).toISOString();
  msgs[0] = "⏱️ *Enviado sozinho*: ninguém mandou mensagem por 11 minutos.\n\n" + msgs[0] +
    (tinha ? `\n${tinha > 1 ? tinha + " arquivos foram" : "1 arquivo foi"} sem dizer o que é: entram como *Não identificado*.` : "");
  return out;
}

// Comentário para o Hub. Com processo no Atos (pedido já enviado ou conversa vinculada), sai na hora
// (acao "comentar"; quem avisa se o Hub recebeu é o webhook). Sem processo ainda, fica guardado e vai
// junto quando o pedido for enviado (levarComentarios).
const MARCA_ENCAMINHADA = "↪️ Mensagem encaminhada:\n";
function novoComentario(estado, texto, encaminhada) {
  const c = { id: "C" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), texto: ((encaminhada ? MARCA_ENCAMINHADA : "") + String(texto).trim()).slice(0, 1500),
    por: estado.remetenteNome || estado.remetenteTel || "", em: new Date().toISOString() };
  if (encaminhada) c.encaminhada = true;
  return c;
}
function comentar(estado, out, msgs, texto, encaminhada) {
  const c = novoComentario(estado, texto, encaminhada);
  if (estado.solicId) { out.acao = "comentar"; out.comentario = c; return; }
  estado.comentarios = (estado.comentarios || []).concat([c]).slice(-20);
  msgs.push(encaminhada ? "💬 Mensagem encaminhada guardada como comentário: vai para o Atos e o Hub junto com o pedido."
    : "💬 Comentário guardado: vai para o Atos e para o Hub junto com o pedido, quando ele for enviado.");
}
// Frase solta: antes do envio vira anotação do pedido; com o pedido já enviado, vira comentário (não se perde)
function anotarOuComentar(estado, out, msgs, texto) {
  if (estado.respostas.confirmar === "sim" && estado.solicId) { comentar(estado, out, msgs, texto); return; }
  anotar(estado, texto); msgs.push(`📝 Anotado: _${texto.slice(0, 120)}_ (vai junto no pedido).`);
}
// Na hora de enviar: os comentários guardados vão junto, e a lista de quem participou recomeça para o próximo pedido
function levarComentarios(estado, dados) { dados.comentarios = (estado.comentarios || []).slice(); estado.comentarios = []; estado.participantes = []; }

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
  const linhas = passos.filter((p) => r[p.id] !== undefined && p.tipo !== "arquivo" && p.id !== "descricao" && p.id !== "outroDetalhe").map((p) => `${rotuloPasso(p, estado)}: ${valorLegivel(p, r[p.id])}`);
  const cnpj = r.cnpj ? cnpjLimpo(r.cnpj) : (estado.cnpj || "");
  const ex = extrasDoTexto(r.extras);
  // "Nome da empresa: Rancho da Brasa" numa anotação ou mensagem encaminhada, quando a pergunta não foi respondida
  const nomeEscrito = (() => { for (const x of (r._notas || []).concat((estado.comentarios || []).map((c) => String(c.texto).replace(MARCA_ENCAMINHADA, "")))) {
    const m = /^\s*nome (?:da empresa|empresarial|pretendido)\s*[:\-–\n]\s*([^\n]{2,80})/i.exec(String(x)); if (m) return m[1].trim(); } return ""; })();
  const empresa = estado.empresa || r.nomeEmpresa || r.novoNome || nomeEscrito || (cnpj ? "CNPJ " + fmtCNPJ(cnpj) : "") || (r.contatoNome || ex.contatoNome ? "Pedido de " + (r.contatoNome || ex.contatoNome) : "Pedido pelo WhatsApp");
  const contatoNome = r.contatoNome || ex.contatoNome, contatoFone = r.contatoFone || ex.contatoFone;
  const prazoTxt = r.prazo || ex.prazo;
  const prazo = /^\d{2}\/\d{2}\/\d{4}$/.test(String(prazoTxt || "")) ? prazoTxt : "";
  const faltou = passos.filter((p) => !p.opcional && p.tipo !== "arquivo" && (r[p.id] === undefined || r[p.id] === "")).map((p) => rotuloPasso(p, estado));
  // Quem fez o pedido é quem COMEÇOU (o primeiro a escrever), não quem mandou a última mensagem: o
  // grupo é um só, e até 18/11/2026 o pedido descrito pelo Raoni e enviado pelo Hesley saía "feito por Hesley".
  const pessoas = (estado.participantes || []).length ? estado.participantes : [estado.remetenteNome || estado.remetenteTel || ""].filter(Boolean);
  const quem = pessoas[0] || "", outros = pessoas.slice(1);
  const autoria = quem ? quem + (outros.length ? " (com " + outros.join(", ") + ")" : "") : "";
  // A descrição escrita pela equipe vem PRIMEIRO na observação: é ela que diz o que fazer. Antes ficava
  // na 3ª linha, depois do texto padrão, e o cartão do Atos mostra só 4 linhas.
  const desc = [r.descricao, r.outroDetalhe].concat(r._notas || []).filter((x) => x && String(x).trim()).map((x) => String(x).trim());
  const descricao = desc.filter((x, i) => desc.indexOf(x) === i);
  // mensagens encaminhadas (em geral do cliente: nome, atividade, telefone): também na observação, que o cartão mostra
  const encaminhadas = (estado.comentarios || []).filter((c) => c.encaminhada).map((c) => String(c.texto).replace(MARCA_ENCAMINHADA, "").replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  return {
    empresa, cnpj: cnpj ? fmtCNPJ(cnpj) : "", tipo: f.tipoAto, pedidos, docsOk,
    contato: contatoNome || "", fone: contatoFone || "", prazo, solicitante: quem, participantes: pessoas, faltou, descricao,
    pedidoTexto: (descricao.length ? descricao.join(" / ") + " — " : "") + `${f.nome}, pedido feito pelo WhatsApp${autoria ? " por " + autoria : ""}.`,
    obs: (descricao.length ? "📝 " + descricao.join("\n📝 ") + "\n\n" : "")
      + `Pedido pelo WhatsApp (${f.nome})${autoria ? ", feito por " + autoria : ""}, ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`
      + (linhas.length ? "\n" + linhas.join("\n") : "")
      + (faltou.length ? "\nEnviado antes do fim; ver nos documentos: " + faltou.join("; ") : "")
      + (encaminhadas.length ? "\n↪️ Mensagens encaminhadas: " + encaminhadas.join(" / ") : ""),
    anexos, respostas: r, fluxo: estado.fluxo,
  };
}

module.exports = { FLUXOS, MENU, LGPD, TIPOS_ARQ, novoEstado, receber, passoAtual, passosAtivos, resumo, montarSolicitacao, validaCPF, validaCNPJ, menuTexto, classificarDoc, adivinharFluxo, mensagemAtual, textoFalado, extrasDoTexto, mudancasDoTexto,
  comentarioDoTexto, comandoPausa, pausado, PAUSA_MS, inatividade, enviarPorInatividade, AVISO_INATIVO, AVISO_INATIVO_MS, ENVIO_DEPOIS_AVISO_MS, todosArquivos,
  opcoesDestino, nomeDoAto, SILENCIO_NOVO_MS, pareceRecado, recadoDoTexto };
