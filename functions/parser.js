// functions/parser.js — traduz o evento da Evolution API para uma forma pequena e estável.
// Funções puras, sem banco. Copiado do robô do TotaliFinance (whatsapp.parser.js) e
// adaptado: o robô dos Atos atende também no PRIVADO (grupo só quando ligado por #vincular).
"use strict";

const somenteDigitos = (v) => String(v || "").replace(/\D/g, "");

// Telefone com DDI 55 e com o nono dígito.
function chaveTelefone(v) {
  let d = somenteDigitos(v);
  if (!d) return "";
  if ((d.length === 10 || d.length === 11) && !d.startsWith("55")) d = "55" + d;
  if (d.startsWith("55") && d.length === 12) {
    const ddd = d.slice(2, 4), resto = d.slice(4);
    if (/^[6-9]/.test(resto)) d = `55${ddd}9${resto}`;
  }
  return d;
}

function telefoneDoJid(jid) {
  const j = String(jid || "");
  if (!j.endsWith("@s.whatsapp.net") && !j.endsWith("@c.us")) return null;
  const d = somenteDigitos(j.split("@")[0].split(":")[0]);
  return d.length >= 8 ? chaveTelefone(d) : null;
}

const ehGrupo = (jid) => String(jid || "").endsWith("@g.us");

const TIPOS_MSG = [
  ["conversation", "texto"], ["extendedTextMessage", "texto"],
  ["imageMessage", "imagem"], ["videoMessage", "video"], ["audioMessage", "audio"],
  ["documentMessage", "documento"], ["documentWithCaptionMessage", "documento"],
  ["stickerMessage", "figurinha"], ["reactionMessage", "reacao"],
  ["protocolMessage", "protocolo"], ["ptvMessage", "video"],
];
const TIPOS_COM_MIDIA = ["imagem", "video", "audio", "documento", "figurinha"];

function miolo(msg) {
  let m = msg || {};
  for (let i = 0; i < 4; i++) {
    const w = m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage || m.editedMessage;
    if (!w || !w.message) break;
    m = w.message;
  }
  return m;
}
function tipoDaMensagem(message) {
  const m = miolo(message);
  for (const [k, tipo] of TIPOS_MSG) if (m[k] != null) return tipo;
  return "outro";
}
function textoDaMensagem(message) {
  const m = miolo(message);
  const t = m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text)
    || (m.imageMessage && m.imageMessage.caption) || (m.videoMessage && m.videoMessage.caption) || (m.documentMessage && m.documentMessage.caption) || "";
  return String(t).trim();
}
function midiaDaMensagem(message) {
  const m = miolo(message);
  const x = m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage || m.ptvMessage;
  if (!x) return null;
  return { mime: x.mimetype || "", nomeArquivo: x.fileName || "", tamanho: Number(x.fileLength && (x.fileLength.low || x.fileLength)) || 0 };
}
function dataDoTimestamp(ts) {
  const n = typeof ts === "object" && ts ? Number(ts.low != null ? ts.low : ts.seconds) : Number(ts);
  if (!(n > 0)) return new Date();
  return new Date(n > 1e12 ? n : n * 1000);
}
function remetenteDoGrupo(d) {
  const key = d.key || {};
  const candidatos = [key.participantPn, key.participantAlt, key.senderPn, d.participantPn, d.participantAlt, key.participant, d.participant].filter(Boolean).map(String);
  const comTelefone = candidatos.find((j) => telefoneDoJid(j));
  const jid = key.participant || d.participant || comTelefone || null;
  return { jid: jid ? String(jid) : null, telefone: comTelefone ? telefoneDoJid(comTelefone) : null };
}
// "#vincular 123456" (com ou sem espaço, maiúscula ou minúscula).
function codigoDeVinculo(texto) {
  const m = /^\s*#?\s*vincular\s*(\d{6})\b/i.exec(String(texto || ""));
  return m ? m[1] : null;
}

// evento ∈ mensagem | conexao | ignorado
function normalizarEvento(payload) {
  const ev = String((payload && payload.event) || "").toLowerCase().replace(/_/g, ".");
  const d = (payload && payload.data) || {};
  if (ev === "connection.update") return { evento: "conexao", estado: d.state || d.status || "", motivo: d.statusReason != null ? d.statusReason : null };
  if (ev !== "messages.upsert") return { evento: "ignorado", motivo: `evento ${(payload && payload.event) || "?"}` };
  const key = d.key || {};
  if (!key.remoteJid) return { evento: "ignorado", motivo: "sem destinatário" };
  if (key.fromMe) return { evento: "ignorado", motivo: "mensagem do próprio robô" };
  if (String(key.remoteJid).endsWith("@broadcast") || String(key.remoteJid) === "status@broadcast") return { evento: "ignorado", motivo: "status/broadcast" };
  if (d.messageStubType || !d.message) return { evento: "ignorado", motivo: "sem conteúdo" };
  const tipo = tipoDaMensagem(d.message);
  if (tipo === "protocolo" || tipo === "reacao") return { evento: "ignorado", motivo: tipo };
  const texto = textoDaMensagem(d.message);
  const midia = midiaDaMensagem(d.message);
  if (!texto && !midia) return { evento: "ignorado", motivo: "sem texto nem arquivo" };
  const grupo = ehGrupo(key.remoteJid);
  const rem = grupo ? remetenteDoGrupo(d) : { jid: String(key.remoteJid), telefone: telefoneDoJid(key.remoteJid) || (d.key && d.key.senderPn ? telefoneDoJid(d.key.senderPn) : null) };
  return {
    evento: "mensagem",
    waId: key.id || "",
    chatJid: String(key.remoteJid),
    grupo,
    participante: grupo ? (key.participant || d.participant || null) : null,
    remetenteJid: rem.jid,
    remetenteTel: rem.telefone,
    remetenteNome: String(d.pushName || "").trim() || null,
    tipo,
    texto,
    temMidia: TIPOS_COM_MIDIA.includes(tipo),
    midiaMime: midia ? midia.mime : null,
    midiaNome: midia ? midia.nomeArquivo : null,
    midiaTamanho: midia ? midia.tamanho : 0,
    enviadaEm: dataDoTimestamp(d.messageTimestamp),
    codigoVinculo: codigoDeVinculo(texto),
  };
}

module.exports = { normalizarEvento, codigoDeVinculo, chaveTelefone, telefoneDoJid, ehGrupo };
