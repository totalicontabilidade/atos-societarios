// functions/index.js — Robô do WhatsApp dos Atos Societários (Cloud Functions 2ª geração).
//
// Caminho da mensagem: WhatsApp → Evolution API (VPS da Magalu, container atos_whatsapp) →
// webhook HTTPS desta função (token no cabeçalho) → diálogo guiado (dialogo.js) → Firestore
// (conversas, solicitacoes) e Storage (anexos) → resposta pela API da Evolution.
//
// Custo zero dentro da cota gratuita: poucas instâncias, nenhuma mínima, região de São Paulo.
// Nenhum dado de cliente sai daqui para IA de terceiros: é conta, validação e gravação.
"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");
const parser = require("./parser");
const evolution = require("./evolution");
const dialogo = require("./dialogo");
const portaria = require("./portaria");
const painel = require("./painel");

// A conta de computação padrão do projeto nasce sem papéis nesta organização. As funções rodam com a
// conta do Admin SDK do Firebase, que já tem Firestore (Admin SDK) e Storage (administrador de armazenamento).
setGlobalOptions({ region: "southamerica-east1", maxInstances: 3, minInstances: 0, memory: "256MiB", timeoutSeconds: 120,
  serviceAccount: "firebase-adminsdk-fbsvc@atos-societarios.iam.gserviceaccount.com" });
admin.initializeApp();
const db = admin.firestore();
const bucket = () => admin.storage().bucket();

const WEBHOOK_TOKEN = defineSecret("WHATSAPP_WEBHOOK_TOKEN");
const API_KEY = defineSecret("WHATSAPP_API_KEY");

const ID_CFG_INTEGRA = "__integracao";   // mesmo documento reservado que o app usa para o Hub
const ID_CFG_WHATS = "__whatsapp";       // número conectado, para a tela do Atos mostrar
const LIMITE_ANEXO = 25 * 1024 * 1024;
// Só o que serve de documento: foto e PDF (e Word, que alguns clientes mandam). Vídeo, áudio, planilha,
// zip e o resto são recusados ANTES de baixar.
const MIME_OK = /^(image\/(jpeg|jpg|png|webp|heic|heif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i;
const DIAS_EVENTOS = 30, DIAS_CODIGO = 1;

const tokenConfere = (recebido, esperado) => {
  const a = Buffer.from(String(recebido || "")), b = Buffer.from(String(esperado || ""));
  return !!esperado && a.length === b.length && crypto.timingSafeEqual(a, b);
};
const chaveChat = (jid) => String(jid || "").replace(/[^0-9A-Za-z]/g, "_");
const agoraISO = () => new Date().toISOString();

// ─── webhook ────────────────────────────────────────────────────────────────
// Quem chama é a Evolution, que não tem identidade Google. A organização Totali bloqueia "allUsers"
// (Compartilhamento restrito de domínio), então o acesso público é feito no Cloud Run, só neste serviço,
// desligando a verificação de IAM do invocador (ver functions/README.md). A proteção é o token do
// webhook conferido logo abaixo, em tempo constante; sem ele, 401 e nada é lido.
exports.whatsappWebhook = onRequest({ secrets: [WEBHOOK_TOKEN, API_KEY] }, async (req, res) => {
  // /painel: a aba WhatsApp das Configurações do Atos (só administrador logado; ver painel.js)
  if (painel.ehPainel(req)) {
    process.env.WHATSAPP_API_KEY = API_KEY.value();
    try { await painel.atender(req, res, { admin, db, evolution, configWhats }); }
    catch (e) { logger.error("erro no painel", { erro: e && e.message }); if (!res.headersSent) res.status(500).json({ ok: false, erro: "erro no painel" }); }
    return;
  }
  if (req.method !== "POST") { res.status(405).send("POST"); return; }
  const recebido = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(req.headers["x-webhook-token"] || "");
  if (!tokenConfere(recebido, WEBHOOK_TOKEN.value())) { res.status(401).json({ ok: false, erro: "token do webhook inválido" }); return; }
  process.env.WHATSAPP_API_KEY = API_KEY.value();
  try {
    const r = await processarEvento(req.body || {});
    res.json({ ok: true, ...r });
  } catch (e) {
    logger.error("erro ao processar evento", { erro: e && e.message, stack: e && e.stack });
    res.status(500).json({ ok: false, erro: "erro ao processar" });   // a Evolution tenta de novo; repetir não duplica (waId único)
  }
});

async function processarEvento(payload) {
  const ev = parser.normalizarEvento(payload);
  if (ev.evento === "conexao") {
    const atual = { estado: ev.estado, motivo: ev.motivo, em: agoraISO() };
    if (ev.estado === "open") { const p = await evolution.perfilInstancia(); if (p.ok) Object.assign(atual, { numero: p.data.numero, nome: p.data.nome }); }
    await db.collection("solicitacoes").doc(ID_CFG_WHATS).set(Object.assign({ id: ID_CFG_WHATS, instancia: evolution.cfg().instancia, alteradoEm: agoraISO() }, atual), { merge: true });
    logger.info("conexão", atual);
    return { conexao: ev.estado };
  }
  if (ev.evento === "ignorado") return { ignorado: ev.motivo };

  // PORTARIA (v1.73): o número é o do escritório. Só o grupo ativado é atendido; privado e outros
  // grupos são descartados AQUI, antes de qualquer gravação e sem resposta nenhuma.
  const decisao = portaria.decidir(ev, await configWhats());
  if (decisao.acao === "ignorar") return { ignorado: decisao.motivo };

  // de-duplicação pelo id da mensagem (a Evolution repete o webhook quando não recebe 200)
  if (ev.waId) {
    try { await db.collection("whatsapp_eventos").doc(ev.waId.replace(/[^0-9A-Za-z_-]/g, "_")).create({ em: admin.firestore.FieldValue.serverTimestamp(), chat: ev.chatJid }); }
    catch (e) { if (e && (e.code === 6 || /already exists/i.test(e.message || ""))) return { repetida: ev.waId }; throw e; }
  }

  const chatRef = db.collection("conversas").doc(chaveChat(ev.chatJid));
  if (decisao.acao === "ativar") return ativarGrupo(ev, chatRef, decisao.codigo);
  // FILA: mensagens mandadas juntas (um PDF e duas mensagens, um lote de fotos) chegam em paralelo e o
  // arquivo demora para baixar. Cada uma pega um número na chegada, é tratada NA ORDEM em que chegou
  // e deixa seus avisos na fila; quem termina por último manda UMA resposta com tudo e a pergunta
  // que vale no fim, uma vez só.
  const filaRef = db.collection("conversas_fila").doc(chatRef.id);
  const n = await chegada(filaRef, ev);
  const saida = { avisos: [], perguntar: false, esperou: false };
  let resultado = null;
  try { resultado = await tratar(ev, chatRef, filaRef, n, saida); }
  finally {
    if (!saida.esperou) await esperarVez(filaRef, n).catch(() => null);
    await concluir(filaRef, n, saida).catch((e) => logger.warn("fila não concluída", { e: e.message }));
  }
  await despachar(filaRef, chatRef, ev).catch((e) => logger.warn("resposta da fila não saiu", { e: e.message }));
  return resultado;
}

async function tratar(ev, chatRef, filaRef, n, saida) {
  const falar = (m) => { saida.avisos.push(m); };
  const naVez = async () => { if (!saida.esperou) { await esperarVez(filaRef, n); saida.esperou = true; } };
  // dentro do grupo do robô, "vincular 123456" liga a conversa a um processo do Atos
  if (ev.codigoVinculo) { await naVez(); return vincular(ev, chatRef, falar); }
  // mídia: baixa pela Evolution e guarda no Storage antes de o diálogo decidir o que é
  let midia = null;
  // áudio vira texto (Whisper na VPS) e segue como se tivesse sido digitado
  if (ev.temMidia && ev.tipo === "audio") {
    const t = await transcreverAudio(ev);
    if (!t.ok) { falar(t.aviso); return { audio: t.erro }; }
    falar(`🎤 Entendi: _${t.texto.slice(0, 500)}_`);
    ev = Object.assign({}, ev, { texto: dialogo.textoFalado(t.texto), temMidia: false, mensagemBruta: null, midiaBase64: null });
  }
  if (ev.temMidia) {
    if (ev.tipo === "figurinha") return { ignorado: "figurinha" };
    if (ev.tipo === "video") { falar("🎬 Vídeo não serve para o processo. Mande *foto* ou *PDF* do documento, por favor."); return { recusado: "video" }; }
    if (ev.midiaMime && !MIME_OK.test(String(ev.midiaMime).split(";")[0].trim())) { falar(`Esse tipo de arquivo (${String(ev.midiaMime).split(";")[0]}) não serve para o processo. Mande *foto* ou *PDF* do documento, por favor.`); return { recusado: ev.midiaMime }; }
    if (ev.midiaTamanho && ev.midiaTamanho > LIMITE_ANEXO) { falar("Esse arquivo passa de 25 MB. Mande uma foto ou um PDF menor, por favor."); return { recusado: "tamanho" }; }
    midia = await guardarMidia(ev, chatRef.id);
    if (!midia) { falar("Não consegui baixar esse arquivo. Pode mandar de novo? Se for grande, o limite é 25 MB."); return { midiaFalhou: true }; }
  }

  // Ler, decidir e gravar a conversa numa TRANSAÇÃO: várias fotos mandadas de uma vez chegam em
  // paralelo, e sem isso uma gravação apagaria a outra (o diálogo é função pura: repetir é seguro).
  await naVez();
  let r = null, novo = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(chatRef);
    const estado = snap.exists ? snap.data() : dialogo.novoEstado({ chatJid: ev.chatJid, grupo: ev.grupo });
    r = dialogo.receber(estado, { texto: ev.texto, midia, remetenteTel: ev.remetenteTel, remetenteNome: ev.remetenteNome });
    novo = Object.assign(r.estado, { chatJid: ev.chatJid, grupo: ev.grupo, ultimaMsgEm: ev.enviadaEm.toISOString(), atualizadoEm: agoraISO() });
    if (r.acao === "cancelado") novo.canceladoEm = agoraISO();
    tx.set(chatRef, novo);
  });
  let resultado = { acao: r.acao || null };
  if (r.acao === "criar_solicitacao") { resultado.solicId = await gravarSolicitacao(novo, r.dados); novo.solicId = resultado.solicId; await chatRef.set({ solicId: resultado.solicId }, { merge: true }); }
  if (r.acao === "anexar" && r.anexar && r.anexar.length) resultado.anexados = await anexarNaSolicitacao(novo, r.anexar);
  if (r.descartar && r.descartar.length) await Promise.all(r.descartar.map((a) => a.caminho ? bucket().file(a.caminho).delete().catch((e) => logger.warn("arquivo descartado não apagado", { e: e.message })) : null));
  r.avisos.forEach(falar); if (r.pergunta) saida.perguntar = true;
  return resultado;
}

// ─── fila de respostas ────────────────────────────────────────────────────────
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Cada mensagem entra em `ativos` com a hora em que foi MANDADA no WhatsApp (a ordem de chegada aqui
// varia: o PDF é maior, a instância pode estar acordando). Vez = ninguém mandado antes ainda ativo.
async function chegada(filaRef, ev) {
  const ts = Math.floor((ev.enviadaEm ? ev.enviadaEm.getTime() : Date.now()) / 1000);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(filaRef), f = s.exists ? s.data() : {};
    const n = (f.chegou || 0) + 1, ativos = Object.assign({}, f.ativos || {});
    ativos[String(n)] = { ts, desde: Date.now() };
    tx.set(filaRef, { chegou: n, ativos, avisos: f.avisos || [], perguntar: !!f.perguntar, em: agoraISO() });
    return { n, ts };
  });
}
const antes = (a, b) => a.ts < b.ts || (a.ts === b.ts && a.n < b.n);
// Espera as mensagens mandadas antes desta terminarem (no máximo 60 s: se uma travou, segue)
async function esperarVez(filaRef, eu) {
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    const s = await filaRef.get();
    const ativos = s.exists ? (s.data().ativos || {}) : {};
    const travadas = Date.now() - 90000;
    const naFrente = Object.entries(ativos).some(([k, v]) => Number(k) !== eu.n && v.desde > travadas && antes({ n: Number(k), ts: v.ts }, eu));
    if (!naFrente) return;
    await dormir(500);
  }
  logger.warn("fila: a mensagem anterior não terminou; seguindo", { n: eu.n });
}
async function concluir(filaRef, eu, saida) {
  await db.runTransaction(async (tx) => {
    const s = await tx.get(filaRef), f = s.exists ? s.data() : {};
    const ativos = Object.assign({}, f.ativos || {}); delete ativos[String(eu.n)];
    const travadas = Date.now() - 90000;
    Object.keys(ativos).forEach((k) => { if (!(ativos[k].desde > travadas)) delete ativos[k]; });   // travou de vez: sai da fila
    tx.set(filaRef, { chegou: Math.max(f.chegou || 0, eu.n), ativos, avisos: (f.avisos || []).concat(saida.avisos),
      perguntar: !!f.perguntar || saida.perguntar, em: agoraISO() });
  });
}
// Depois de um respiro curto, se nada mais chegou nem está em andamento, manda tudo numa mensagem só
async function despachar(filaRef, chatRef, ev) {
  await dormir(2000);
  const lote = await db.runTransaction(async (tx) => {
    const s = await tx.get(filaRef); if (!s.exists) return null;
    const f = s.data();
    if (Object.keys(f.ativos || {}).length) return null;            // ainda tem mensagem sendo tratada: ela manda
    if (!(f.avisos || []).length && !f.perguntar) return null;
    tx.set(filaRef, Object.assign({}, f, { avisos: [], perguntar: false, em: agoraISO() }));
    return f;
  });
  if (!lote) return;
  const partes = [];
  for (const m of lote.avisos || []) if (m && !partes.includes(m)) partes.push(m);
  if (lote.perguntar) {
    const snap = await chatRef.get();
    const q = snap.exists ? dialogo.mensagemAtual(snap.data()) : null;
    if (q) { const i = partes.indexOf(q); if (i >= 0) partes.splice(i, 1); partes.push(q); }
  }
  if (!partes.length) return;
  const ok = await responder(ev, partes.join("\n\n"));
  logger.info("resposta do lote", { partes: partes.length, enviada: ok });
}

// Configuração do robô (solicitacoes/__whatsapp), lida com cache curto: o webhook recebe TODAS as
// mensagens do escritório e não pode ler o banco a cada uma.
let _cfgWhats = null, _cfgWhatsEm = 0;
async function configWhats(forcar) {
  if (!forcar && _cfgWhats && Date.now() - _cfgWhatsEm < 20000) return _cfgWhats;
  const s = await db.collection("solicitacoes").doc(ID_CFG_WHATS).get();
  _cfgWhats = s.exists ? (s.data() || {}) : {}; _cfgWhatsEm = Date.now();
  return _cfgWhats;
}

// Só responde DENTRO do grupo ativado. Trava dupla: mesmo que alguma linha acima errasse, nada sai
// para privado de cliente nem para outro grupo.
async function responder(ev, texto) {
  const cfg = await configWhats();
  if (!ev.grupo || !cfg.grupoJid || ev.chatJid !== cfg.grupoJid) { logger.warn("resposta bloqueada fora do grupo do robô", { chat: ev.chatJid }); return false; }
  const destino = ev.chatJid;
  const r = await evolution.enviarTexto(destino, texto, { citar: { waId: ev.waId, participante: ev.participante } });
  if (!r.ok) logger.warn("não consegui responder", { destino, erro: r.erro });
  return r.ok;
}

// "#ativar-atos 123456" — escolhe ESTE grupo como o grupo do robô. O código precisa ter sido gerado
// por um ADMINISTRADOR na tela do Atos (tipo "grupo", 10 minutos, uso único). Código inválido não
// recebe resposta: a mensagem pode ter vindo de um grupo de cliente.
async function ativarGrupo(ev, chatRef, codigo) {
  const ref = db.collection("codigos_vinculo").doc(codigo);
  const agora = new Date();
  const r = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) return { erro: "inexistente" };
    const c = s.data();
    if (c.tipo !== "grupo") return { erro: "não é código de grupo" };
    if (c.usadoEm) return { erro: "usado" };
    const exp = c.expiraEm && c.expiraEm.toDate ? c.expiraEm.toDate() : new Date(c.expiraEm);
    if (!(exp > agora)) return { erro: "vencido" };
    const eq = c.autorUid ? await tx.get(db.collection("equipe").doc(String(c.autorUid))) : null;
    if (!(eq && eq.exists && eq.data().ativo === true && eq.data().admin === true)) return { erro: "código não gerado por administrador" };
    tx.update(ref, { usadoEm: admin.firestore.FieldValue.serverTimestamp(), usadoPor: ev.remetenteNome || ev.remetenteTel || "", chatJid: ev.chatJid });
    return { ok: true, codigo: c };
  });
  if (!r.ok) { logger.warn("ativação de grupo recusada (sem resposta)", { motivo: r.erro, chat: ev.chatJid }); return { ativacao: r.erro }; }
  const nome = await evolution.nomeDoGrupo(ev.chatJid).catch(() => null);
  const anterior = (await configWhats(true)).grupoJid || "";
  await db.collection("solicitacoes").doc(ID_CFG_WHATS).set({ id: ID_CFG_WHATS, grupoJid: ev.chatJid, grupoNome: nome || "", grupoAtivadoEm: agoraISO(),
    grupoAtivadoPor: r.codigo.autorEmail || "", grupoAnterior: anterior && anterior !== ev.chatJid ? anterior : "", alteradoEm: agoraISO() }, { merge: true });
  _cfgWhats = Object.assign({}, _cfgWhats || {}, { grupoJid: ev.chatJid, grupoNome: nome || "" }); _cfgWhatsEm = Date.now();
  const estado = dialogo.novoEstado({ chatJid: ev.chatJid, grupo: true, lgpdEm: agoraISO() });
  await chatRef.set(estado, { merge: false });
  await responder(ev, `✅ Este grupo agora é o grupo do robô dos Atos Societários da Totali. Só aqui eu respondo.\n\n${dialogo.LGPD}\n\n${dialogo.menuTexto(estado)}`);
  logger.info("grupo do robô ativado", { grupo: ev.chatJid, anterior });
  return { ativacao: "ok" };
}

// "vincular 123456" (no grupo do robô) — liga a conversa do grupo ao processo que gerou o código no Atos.
async function vincular(ev, chatRef, falar) {
  const ref = db.collection("codigos_vinculo").doc(ev.codigoVinculo);
  const agora = new Date();
  const resultado = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) return { erro: "inexistente" };
    const c = s.data();
    if (c.tipo === "grupo") return { erro: "código de ativação de grupo" };
    if (c.usadoEm) return { erro: "usado" };
    const exp = c.expiraEm && c.expiraEm.toDate ? c.expiraEm.toDate() : new Date(c.expiraEm);
    if (!(exp > agora)) return { erro: "vencido" };
    tx.update(ref, { usadoEm: admin.firestore.FieldValue.serverTimestamp(), usadoPor: ev.remetenteNome || ev.remetenteTel || ev.chatJid, chatJid: ev.chatJid });
    return { ok: true, codigo: c };
  });
  if (!resultado.ok) { falar("Código inválido ou vencido. Gere outro na etapa 1 do processo no Atos (ele vale 10 minutos) e mande de novo: *vincular 123456*."); return { vinculo: resultado.erro }; }
  const c = resultado.codigo;
  const snap = await chatRef.get();
  const estado = dialogo.novoEstado(Object.assign(snap.exists ? snap.data() : {}, {
    chatJid: ev.chatJid, grupo: ev.grupo, empresa: c.empresa || "", cnpj: c.cnpj || "", solicId: c.solicId || "", casoId: c.casoId || "",
    vinculo: { codigo: ev.codigoVinculo, em: agoraISO(), por: ev.remetenteNome || ev.remetenteTel || "", autorUid: c.autorUid || "" }, fluxo: null, respostas: {}, ordem: [],
  }));
  await chatRef.set(estado, { merge: false });
  await db.collection("vinculos").doc(chatRef.id).set({ chatJid: ev.chatJid, grupo: ev.grupo, solicId: c.solicId || "", casoId: c.casoId || "", empresa: c.empresa || "", cnpj: c.cnpj || "", em: agoraISO(), por: ev.remetenteNome || ev.remetenteTel || "" });
  if (c.solicId) await db.collection("solicitacoes").doc(c.solicId).set({ whatsapp: { chatJid: ev.chatJid, grupo: ev.grupo, vinculadoEm: agoraISO() }, alteradoEm: agoraISO() }, { merge: true }).catch((e) => logger.warn("solicitação do código não atualizada", { e: e.message }));
  falar(`✅ Conversa ligada ao processo de *${c.empresa || "empresa sem nome"}* no Atos.\n\n${dialogo.LGPD}\n\n${dialogo.menuTexto(estado)}`);
  estado.lgpdEm = agoraISO(); await chatRef.set({ lgpdEm: estado.lgpdEm }, { merge: true });
  return { vinculo: "ok", solicId: c.solicId || null };
}

// Áudio: baixa pela Evolution e manda ao Whisper da VPS. Só o texto segue; o áudio não é gravado.
const LIMITE_AUDIO_S = 120;
async function transcreverAudio(ev) {
  if (ev.midiaSegundos > LIMITE_AUDIO_S) return { ok: false, erro: "longo", aviso: `🎤 Áudio de até ${LIMITE_AUDIO_S / 60} minutos, por favor (este tem ${Math.ceil(ev.midiaSegundos / 60)}). Pode dividir ou escrever.` };
  const key = { id: ev.waId, remoteJid: ev.chatJid, fromMe: false, ...(ev.participante ? { participant: ev.participante } : {}) };
  const b = ev.midiaBase64 ? { ok: true, data: { base64: ev.midiaBase64, mime: ev.midiaMime || "" } } : await evolution.baixarMidia(key, ev.mensagemBruta);
  if (!b.ok) { logger.warn("áudio não baixou", { erro: b.erro }); return { ok: false, erro: "download", aviso: "🎤 Não consegui baixar o áudio. Pode mandar de novo ou escrever?" }; }
  const t = await evolution.transcrever(b.data.base64, b.data.mime || ev.midiaMime);
  if (!t.ok) { logger.warn("áudio não transcrito", { erro: t.erro }); return { ok: false, erro: t.erro, aviso: t.erro === "áudio sem fala" ? "🎤 Não ouvi fala nesse áudio. Pode repetir ou escrever?" : "🎤 Não consegui entender o áudio agora. Pode escrever, por favor?" }; }
  return { ok: true, texto: t.data.texto };
}

// Baixa a mídia pela Evolution e grava no Storage em whatsapp/{chat}/{waId}-{nome}; devolve o anexo no formato do app.
async function guardarMidia(ev, chatId) {
  const key = { id: ev.waId, remoteJid: ev.chatJid, fromMe: false, ...(ev.participante ? { participant: ev.participante } : {}) };
  const r = ev.midiaBase64 ? { ok: true, data: { base64: ev.midiaBase64, mime: ev.midiaMime || "", nome: ev.midiaNome || "" } }
    : await evolution.baixarMidia(key, ev.mensagemBruta);
  if (!r.ok) { logger.warn("mídia não baixou", { erro: r.erro }); return null; }
  const buf = Buffer.from(r.data.base64, "base64");
  if (buf.length > LIMITE_ANEXO) return null;
  const mime = r.data.mime || ev.midiaMime || "application/octet-stream";
  const ext = mime.includes("pdf") ? ".pdf" : (mime.includes("png") ? ".png" : (mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : (mime.includes("webp") ? ".webp" : "")));
  // foto do WhatsApp não tem nome (a Evolution devolve o id da mensagem): vira "foto"
  const nomeBase = (ev.midiaNome || (ev.tipo === "imagem" ? "foto" : r.data.nome || "arquivo")).replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const nome = /\.[a-z0-9]{2,5}$/i.test(nomeBase) ? nomeBase : nomeBase + ext;
  const caminho = `whatsapp/${chatId}/${ev.waId.replace(/[^0-9A-Za-z_-]/g, "_")}-${nome}`;
  const token = crypto.randomUUID();
  await bucket().file(caminho).save(buf, { contentType: mime, resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: token, origem: "whatsapp", chat: ev.chatJid } } });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(caminho)}?alt=media&token=${token}`;
  return { id: "W" + Date.now().toString(36), nome, tipo: mime, tamanho: buf.length, caminho, url, em: agoraISO(), waId: ev.waId };
}

// Cria (ou completa) a solicitação no formato que o app já lê e avisa o Hub.
async function gravarSolicitacao(estado, dados) {
  const agora = agoraISO(), por = "robô do WhatsApp";
  let id = estado.solicId || "";
  const historicoItem = { status: "nova", em: agora, por };
  if (id) {
    const ref = db.collection("solicitacoes").doc(id), s = await ref.get();
    if (s.exists) {
      const atual = s.data() || {};
      const pedidos = Array.from(new Set([].concat(atual.pedidos || [], dados.pedidos || [])));
      const docsOk = Array.from(new Set([].concat(atual.docsOk || [], dados.docsOk || [])));
      await ref.set({
        pedidos, docsOk, anexos: [].concat(atual.anexos || [], dados.anexos || []),
        obs: ((atual.obs || "") + "\n\n" + dados.obs).trim(), pedidoTexto: atual.pedidoTexto || dados.pedidoTexto,
        contato: atual.contato || dados.contato, fone: atual.fone || dados.fone, prazo: atual.prazo || dados.prazo,
        cnpj: atual.cnpj || dados.cnpj, respostaNova: true, pendencia: "Pedido completo pelo robô do WhatsApp: confira os dados e anexos.", pendenciaEm: agora,
        whatsapp: Object.assign({}, atual.whatsapp || {}, { respostasEm: agora, fluxo: dados.fluxo, respostas: dados.respostas, solicitante: dados.solicitante || "" }), alteradoEm: agora,
      }, { merge: true });
      await avisarHub("solicitacao.respondida", Object.assign({}, atual, { id, status: atual.status || "nova", pedidoTexto: dados.pedidoTexto, pendencia: "Pedido completo pelo WhatsApp" }));
      return id;
    }
  }
  id = "W" + Date.now().toString(36).toUpperCase() + crypto.randomInt(0, 36).toString(36).toUpperCase();
  const reg = {
    id, empresa: dados.empresa, cnpj: dados.cnpj, tipo: dados.tipo, pedidos: dados.pedidos, docsOk: dados.docsOk,
    status: "nova", obs: dados.obs, pedidoTexto: dados.pedidoTexto, contato: dados.contato, fone: dados.fone, prazo: dados.prazo,
    responsavel: "", anexos: dados.anexos, historico: [historicoItem], criadoEm: agora, alteradoEm: agora,
    abertaPor: "whatsapp", origem: "whatsapp", whatsapp: { chatJid: estado.chatJid, grupo: !!estado.grupo, fluxo: dados.fluxo, respostas: dados.respostas, respostasEm: agora, solicitante: dados.solicitante || "" },
  };
  await db.collection("solicitacoes").doc(id).set(reg);
  await avisarHub("solicitacao.criada", reg);
  await reenviarHubPendentes().catch(() => 0);
  return id;
}

// Arquivo mandado depois de o pedido ter sido enviado: junta à solicitação e avisa quem cadastra.
async function anexarNaSolicitacao(estado, itens) {
  if (!estado.solicId) return 0;
  const ref = db.collection("solicitacoes").doc(estado.solicId), s = await ref.get();
  if (!s.exists) return 0;
  const atual = s.data() || {}, agora = agoraISO();
  const docsOk = Array.from(new Set([].concat(atual.docsOk || [], itens.map((a) => a.doc).filter(Boolean))));
  await ref.set({ anexos: [].concat(atual.anexos || [], itens), docsOk, respostaNova: true,
    pendencia: `Chegou pelo WhatsApp ${itens.length > 1 ? itens.length + " documentos novos" : "um documento novo"} pelo WhatsApp: ${itens.map((a) => a.docNome).join(", ")}.`, pendenciaEm: agora, alteradoEm: agora }, { merge: true });
  return itens.length;
}

// Aviso ao Hub (Apps Script), com o endereço e o segredo que o app guarda em solicitacoes/__integracao.
// MESMO formato do js/integracao.js do app: { evento, segredo, enviadoEm, solicitacao: {...} }. Até
// 11/11/2026 isto mandava os campos soltos, o recebedor respondia 200 com {ok:false, "solicitação sem
// identificador"} e aqui contava como entregue: nenhum pedido do WhatsApp chegou ao Hub. Agora a
// resposta é lida, e o que não entrou fica marcado em hubAviso para tentar de novo.
const TIPOS_HUB = { alt: "Alteração Contratual (Ltda)", const: "Constituição de Sociedade Limitada", dist_ltda: "Distrato de Sociedade Limitada",
  transf_ei_ltda: "Transformação de Empresário Individual em Sociedade Limitada", sia_const: "Ato Constitutivo de Sociedade Individual de Advocacia" };
const PEDIDOS_HUB = { abrir: "Abrir empresa", endereco: "Mudar endereço", socios: "Entrada ou saída de sócio", atividades: "Mudar atividades", capital: "Mudar capital",
  nome: "Mudar o nome", transformar: "Mudar o tipo (MEI/EI ↔ Ltda)", fechar: "Fechar a empresa", advocacia: "Sociedade de advocacia (OAB)", outro: "Outro / não sei" };
const STATUS_HUB = { nova: "Nova", andamento: "Em andamento", cliente: "Aguardando cliente", protocolada: "Protocolada", exigencia: "Em exigência", concluida: "Finalizada", cancelada: "Cancelada" };
function pacoteHub(evento, reg, segredo) {
  const p = String(reg.prazo || "").split("/");
  const pedidos = (reg.pedidos || []).map((k) => PEDIDOS_HUB[k]).filter(Boolean).join(", ");
  return { evento, segredo: segredo || "", enviadoEm: agoraISO(), origem: "atos-whatsapp",
    solicitacao: { id: String(reg.id || ""), empresa: reg.empresa || "", cnpj: reg.cnpj || "", tipo: reg.tipo || "",
      tipoNome: TIPOS_HUB[reg.tipo] || pedidos || "Solicitação", pedido: reg.pedidoTexto || pedidos,
      prazo: p.length === 3 && p[2].length === 4 ? `${p[2]}-${p[1]}-${p[0]}` : "", responsavel: reg.responsavel || "", contato: reg.contato || "", fone: reg.fone || "",
      status: reg.status || "nova", statusNome: STATUS_HUB[reg.status] || "Nova", obs: reg.obs || "", pendencia: reg.pendencia || "", abertaPor: reg.abertaPor || "whatsapp" } };
}
async function avisarHub(evento, reg) {
  let ok = false, erro = "", resposta = null;
  try {
    const cfg = (await db.collection("solicitacoes").doc(ID_CFG_INTEGRA).get()).data() || {};
    if (!cfg.url || !/^https:\/\/script\.google(usercontent)?\.com\//.test(cfg.url)) { erro = "integração com o Hub sem endereço"; }
    else {
      const r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(pacoteHub(evento, reg, cfg.segredo)), redirect: "follow", signal: AbortSignal.timeout(30000) });
      const t = await r.text(); try { resposta = JSON.parse(t); } catch { resposta = null; }
      ok = r.ok && !!resposta && resposta.ok !== false;
      if (!ok) erro = (resposta && resposta.erro) || `HTTP ${r.status}${resposta ? "" : " sem resposta legível"}`;
    }
  } catch (e) { erro = (e && e.message) || "falha de rede"; }
  if (reg.id) {
    const marca = ok ? { ok: true, evento, em: agoraISO(), pendencia: (resposta && resposta.pendencia) || "" }
      : { ok: false, pendente: true, evento, erro: String(erro).slice(0, 300), em: agoraISO(), tentativas: admin.firestore.FieldValue.increment(1) };
    await db.collection("solicitacoes").doc(String(reg.id)).set({ hubAviso: marca }, { merge: true }).catch((e) => logger.warn("marca do aviso ao Hub não gravada", { e: e.message }));
  }
  if (ok) logger.info("Hub avisado", { evento, id: reg.id, pendencia: resposta && resposta.pendencia, repetido: !!(resposta && resposta.repetido) });
  else logger.warn("Hub NÃO recebeu", { evento, id: reg.id, erro });
  return ok;
}
// Tenta de novo os avisos que não entraram (no máximo 10 vezes cada)
async function reenviarHubPendentes() {
  const q = await db.collection("solicitacoes").where("hubAviso.pendente", "==", true).limit(20).get();
  let n = 0;
  for (const d of q.docs) {
    const reg = Object.assign({ id: d.id }, d.data());
    if ((reg.hubAviso.tentativas || 0) >= 10) continue;
    if (await avisarHub(reg.hubAviso.evento || "solicitacao.criada", reg)) n++;
  }
  return n;
}

// ─── faxina diária: eventos de de-duplicação (30 dias) e códigos vencidos ───
exports.faxinaWhatsapp = onSchedule({ schedule: "20 3 * * *", timeZone: "America/Sao_Paulo" }, async () => {
  const limiteEv = new Date(Date.now() - DIAS_EVENTOS * 86400000), limiteCod = new Date(Date.now() - DIAS_CODIGO * 86400000);
  let n = 0;
  for (const [col, campo, lim] of [["whatsapp_eventos", "em", limiteEv], ["codigos_vinculo", "expiraEm", limiteCod]]) {
    for (;;) {
      const q = await db.collection(col).where(campo, "<", lim).limit(400).get();
      if (q.empty) break;
      const b = db.batch(); q.docs.forEach((d) => b.delete(d.ref)); await b.commit(); n += q.size;
      if (q.size < 400) break;
    }
  }
  const reavisados = await reenviarHubPendentes().catch((e) => { logger.warn("reenvio ao Hub falhou", { e: e.message }); return 0; });
  logger.info("faxina", { apagados: n, reavisadosHub: reavisados });
});

// exposto para testes locais (node --test)
exports._interno = { processarEvento, tokenConfere, chaveChat, pacoteHub };
