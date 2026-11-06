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

setGlobalOptions({ region: "southamerica-east1", maxInstances: 3, minInstances: 0, memory: "256MiB", timeoutSeconds: 120 });
admin.initializeApp();
const db = admin.firestore();
const bucket = () => admin.storage().bucket();

const WEBHOOK_TOKEN = defineSecret("WHATSAPP_WEBHOOK_TOKEN");
const API_KEY = defineSecret("WHATSAPP_API_KEY");

const ID_CFG_INTEGRA = "__integracao";   // mesmo documento reservado que o app usa para o Hub
const ID_CFG_WHATS = "__whatsapp";       // número conectado, para a tela do Atos mostrar
const LIMITE_ANEXO = 25 * 1024 * 1024;
const DIAS_EVENTOS = 30, DIAS_CODIGO = 1;

const tokenConfere = (recebido, esperado) => {
  const a = Buffer.from(String(recebido || "")), b = Buffer.from(String(esperado || ""));
  return !!esperado && a.length === b.length && crypto.timingSafeEqual(a, b);
};
const chaveChat = (jid) => String(jid || "").replace(/[^0-9A-Za-z]/g, "_");
const agoraISO = () => new Date().toISOString();

// ─── webhook ────────────────────────────────────────────────────────────────
exports.whatsappWebhook = onRequest({ secrets: [WEBHOOK_TOKEN, API_KEY] }, async (req, res) => {
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

  // de-duplicação pelo id da mensagem (a Evolution repete o webhook quando não recebe 200)
  if (ev.waId) {
    try { await db.collection("whatsapp_eventos").doc(ev.waId.replace(/[^0-9A-Za-z_-]/g, "_")).create({ em: admin.firestore.FieldValue.serverTimestamp(), chat: ev.chatJid }); }
    catch (e) { if (e && (e.code === 6 || /already exists/i.test(e.message || ""))) return { repetida: ev.waId }; throw e; }
  }

  // grupo só é atendido quando ligado a um processo (#vincular); privado sempre
  const chatRef = db.collection("conversas").doc(chaveChat(ev.chatJid));
  if (ev.codigoVinculo) return vincular(ev, chatRef);
  const snap = await chatRef.get();
  let estado = snap.exists ? snap.data() : null;
  if (ev.grupo && !(estado && estado.vinculo)) return { ignorado: "grupo não ligado a nenhum processo" };
  if (!estado) estado = dialogo.novoEstado({ chatJid: ev.chatJid, grupo: ev.grupo });

  // mídia: baixa pela Evolution e guarda no Storage antes de o diálogo decidir o que é
  let midia = null;
  if (ev.temMidia) {
    if (ev.tipo === "audio") { await responder(ev, "🎤 Não consigo ouvir áudio. Pode escrever, por favor?"); return { audio: true }; }
    if (ev.tipo === "figurinha") return { ignorado: "figurinha" };
    midia = await guardarMidia(ev, chatRef.id);
    if (!midia) { await responder(ev, "Não consegui baixar esse arquivo. Pode mandar de novo? Se for grande, o limite é 25 MB."); return { midiaFalhou: true }; }
  }

  const r = dialogo.receber(estado, { texto: ev.texto, midia, remetenteTel: ev.remetenteTel, remetenteNome: ev.remetenteNome });
  const novo = Object.assign(r.estado, { chatJid: ev.chatJid, grupo: ev.grupo, ultimaMsgEm: ev.enviadaEm.toISOString(), atualizadoEm: agoraISO() });
  let resultado = { acao: r.acao || null };
  if (r.acao === "criar_solicitacao") resultado.solicId = await gravarSolicitacao(novo, r.dados);
  if (r.acao === "humano") resultado.solicId = await pedirHumano(novo, ev);
  if (r.acao === "cancelado") novo.canceladoEm = agoraISO();
  await chatRef.set(novo, { merge: false });
  for (const m of r.mensagens) await responder(ev, m);
  return resultado;
}

async function responder(ev, texto) {
  const destino = ev.grupo ? ev.chatJid : (ev.remetenteTel || ev.chatJid);
  const r = await evolution.enviarTexto(destino, texto, { citar: ev.grupo ? { waId: ev.waId, participante: ev.participante } : null });
  if (!r.ok) logger.warn("não consegui responder", { destino, erro: r.erro });
  return r.ok;
}

// "#vincular 123456" — liga este chat (grupo ou privado) ao processo que gerou o código no Atos.
async function vincular(ev, chatRef) {
  const ref = db.collection("codigos_vinculo").doc(ev.codigoVinculo);
  const agora = new Date();
  const resultado = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (!s.exists) return { erro: "inexistente" };
    const c = s.data();
    if (c.usadoEm) return { erro: "usado" };
    const exp = c.expiraEm && c.expiraEm.toDate ? c.expiraEm.toDate() : new Date(c.expiraEm);
    if (!(exp > agora)) return { erro: "vencido" };
    tx.update(ref, { usadoEm: admin.firestore.FieldValue.serverTimestamp(), usadoPor: ev.remetenteNome || ev.remetenteTel || ev.chatJid, chatJid: ev.chatJid });
    return { ok: true, codigo: c };
  });
  if (!resultado.ok) { await responder(ev, "Código inválido ou vencido. Peça um novo à equipe da Totali (ele vale 10 minutos) e mande de novo: *vincular 123456*."); return { vinculo: resultado.erro }; }
  const c = resultado.codigo;
  const snap = await chatRef.get();
  const estado = dialogo.novoEstado(Object.assign(snap.exists ? snap.data() : {}, {
    chatJid: ev.chatJid, grupo: ev.grupo, empresa: c.empresa || "", cnpj: c.cnpj || "", solicId: c.solicId || "", casoId: c.casoId || "",
    vinculo: { codigo: ev.codigoVinculo, em: agoraISO(), por: ev.remetenteNome || ev.remetenteTel || "", autorUid: c.autorUid || "" }, fluxo: null, respostas: {}, ordem: [],
  }));
  await chatRef.set(estado, { merge: false });
  await db.collection("vinculos").doc(chatRef.id).set({ chatJid: ev.chatJid, grupo: ev.grupo, solicId: c.solicId || "", casoId: c.casoId || "", empresa: c.empresa || "", cnpj: c.cnpj || "", em: agoraISO(), por: ev.remetenteNome || ev.remetenteTel || "" });
  if (c.solicId) await db.collection("solicitacoes").doc(c.solicId).set({ whatsapp: { chatJid: ev.chatJid, grupo: ev.grupo, vinculadoEm: agoraISO() }, alteradoEm: agoraISO() }, { merge: true }).catch((e) => logger.warn("solicitação do código não atualizada", { e: e.message }));
  await responder(ev, `✅ Conversa ligada ao processo de *${c.empresa || "sua empresa"}* na Totali.\n\n${dialogo.LGPD}\n\n${dialogo.menuTexto(estado)}`);
  estado.lgpdEm = agoraISO(); await chatRef.set({ lgpdEm: estado.lgpdEm }, { merge: true });
  return { vinculo: "ok", solicId: c.solicId || null };
}

// Baixa a mídia pela Evolution e grava no Storage em whatsapp/{chat}/{waId}-{nome}; devolve o anexo no formato do app.
async function guardarMidia(ev, chatId) {
  const r = await evolution.baixarMidia({ id: ev.waId, remoteJid: ev.chatJid, fromMe: false, ...(ev.participante ? { participant: ev.participante } : {}) });
  if (!r.ok) { logger.warn("mídia não baixou", { erro: r.erro }); return null; }
  const buf = Buffer.from(r.data.base64, "base64");
  if (buf.length > LIMITE_ANEXO) return null;
  const mime = r.data.mime || ev.midiaMime || "application/octet-stream";
  const ext = mime.includes("pdf") ? ".pdf" : (mime.includes("png") ? ".png" : (mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : (mime.includes("webp") ? ".webp" : "")));
  const nomeBase = (ev.midiaNome || r.data.nome || (ev.tipo === "imagem" ? "foto" : "arquivo")).replace(/[^\w.\-]+/g, "_").slice(0, 80);
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
        cnpj: atual.cnpj || dados.cnpj, respostaNova: true, pendencia: "O cliente respondeu ao robô do WhatsApp: pedido completo, confira os dados e anexos.", pendenciaEm: agora,
        whatsapp: Object.assign({}, atual.whatsapp || {}, { respostasEm: agora, fluxo: dados.fluxo, respostas: dados.respostas }), alteradoEm: agora,
      }, { merge: true });
      await avisarHub("solicitacao.respondida", Object.assign({}, atual, { id, status: atual.status || "nova", pedidoTexto: dados.pedidoTexto, pendencia: "Cliente respondeu pelo WhatsApp" }));
      return id;
    }
  }
  id = "W" + Date.now().toString(36).toUpperCase() + crypto.randomInt(0, 36).toString(36).toUpperCase();
  const reg = {
    id, empresa: dados.empresa, cnpj: dados.cnpj, tipo: dados.tipo, pedidos: dados.pedidos, docsOk: dados.docsOk,
    status: "nova", obs: dados.obs, pedidoTexto: dados.pedidoTexto, contato: dados.contato, fone: dados.fone, prazo: dados.prazo,
    responsavel: "", anexos: dados.anexos, historico: [historicoItem], criadoEm: agora, alteradoEm: agora,
    abertaPor: "whatsapp", origem: "whatsapp", whatsapp: { chatJid: estado.chatJid, grupo: !!estado.grupo, fluxo: dados.fluxo, respostas: dados.respostas, respostasEm: agora },
  };
  await db.collection("solicitacoes").doc(id).set(reg);
  await avisarHub("solicitacao.criada", reg);
  return id;
}

async function pedirHumano(estado, ev) {
  const agora = agoraISO();
  const parcial = estado.fluxo ? dialogo.montarSolicitacao(estado) : null;
  const texto = `Cliente pediu para falar com a equipe pelo WhatsApp (${ev.remetenteTel || ev.chatJid}).`;
  if (estado.solicId) {
    await db.collection("solicitacoes").doc(estado.solicId).set({ pendencia: texto, pendenciaEm: agora, respostaNova: true, alteradoEm: agora, whatsapp: { pediuHumanoEm: agora, respostas: (parcial && parcial.respostas) || null } }, { merge: true }).catch(() => {});
    return estado.solicId;
  }
  const id = "W" + Date.now().toString(36).toUpperCase() + "H";
  const reg = Object.assign({
    id, empresa: (parcial && parcial.empresa) || (ev.remetenteNome ? "Contato de " + ev.remetenteNome : "Contato pelo WhatsApp"), cnpj: (parcial && parcial.cnpj) || "", tipo: (parcial && parcial.tipo) || "",
    pedidos: (parcial && parcial.pedidos) || ["outro"], docsOk: (parcial && parcial.docsOk) || [], status: "nova", obs: (parcial && parcial.obs) || texto, pedidoTexto: texto,
    contato: (parcial && parcial.contato) || ev.remetenteNome || "", fone: ev.remetenteTel || "", prazo: "", responsavel: "", anexos: (parcial && parcial.anexos) || [],
    historico: [{ status: "nova", em: agora, por: "robô do WhatsApp" }], criadoEm: agora, alteradoEm: agora, abertaPor: "whatsapp", origem: "whatsapp",
    pendencia: texto, pendenciaEm: agora, respostaNova: true, whatsapp: { chatJid: estado.chatJid, grupo: !!estado.grupo, pediuHumanoEm: agora, fluxo: estado.fluxo || null, respostas: (parcial && parcial.respostas) || null },
  });
  await db.collection("solicitacoes").doc(id).set(reg);
  estado.solicId = id;
  await avisarHub("solicitacao.criada", reg);
  return id;
}

// Aviso ao Hub (Apps Script), com o endereço e o segredo que o app guarda em solicitacoes/__integracao.
async function avisarHub(evento, reg) {
  try {
    const cfg = (await db.collection("solicitacoes").doc(ID_CFG_INTEGRA).get()).data() || {};
    if (!cfg.url || !/^https:\/\/script\.google(usercontent)?\.com\//.test(cfg.url)) return false;
    const TIPOS = { alt: "Alteração contratual", const: "Abertura", dist_ltda: "Baixa", transf_ei_ltda: "Transformação", sia_const: "Sociedade de advocacia" };
    const STATUS = { nova: "Nova", andamento: "Em andamento", cliente: "Aguardando cliente", protocolada: "Protocolada", exigencia: "Em exigência", concluida: "Finalizada", cancelada: "Cancelada" };
    const p = (reg.prazo || "").split("/");
    const pacote = { evento, segredo: cfg.segredo || "", em: agoraISO(), origem: "atos-whatsapp",
      id: String(reg.id || ""), empresa: reg.empresa || "", cnpj: reg.cnpj || "", tipo: reg.tipo || "", tipoNome: TIPOS[reg.tipo] || (reg.tipo ? reg.tipo : "A definir"),
      pedido: reg.pedidoTexto || "", prazo: p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : "", responsavel: reg.responsavel || "", contato: reg.contato || "", fone: reg.fone || "",
      status: reg.status || "nova", statusNome: STATUS[reg.status] || "Nova", obs: reg.obs || "", pendencia: reg.pendencia || "", abertaPor: reg.abertaPor || "whatsapp" };
    const r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(pacote), redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!r.ok) logger.warn("Hub respondeu", { status: r.status });
    return r.ok;
  } catch (e) { logger.warn("Hub não avisado", { erro: e && e.message }); return false; }
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
  logger.info("faxina", { apagados: n });
});

// exposto para testes locais (node --test)
exports._interno = { processarEvento, tokenConfere, chaveChat };
