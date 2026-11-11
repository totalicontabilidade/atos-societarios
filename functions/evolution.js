// functions/evolution.js — o pouco que o robô dos Atos precisa da Evolution API (v2.3.7, na
// VPS da Magalu, atrás do Traefik). Nada aqui lança para fora: { ok, data } ou { ok:false, erro }.
"use strict";

function cfg() {
  return {
    url: (process.env.WHATSAPP_URL || "").replace(/\/+$/, ""),
    apiKey: process.env.WHATSAPP_API_KEY || "",
    instancia: process.env.WHATSAPP_INSTANCIA || "atos",
  };
}
const inst = () => encodeURIComponent(cfg().instancia);

async function chamar(caminho, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const c = cfg();
  if (!c.url || !c.apiKey) return { ok: false, erro: "WHATSAPP_URL ou WHATSAPP_API_KEY não configurados" };
  try {
    const r = await fetch(`${c.url}${caminho}`, {
      method,
      headers: { apikey: c.apiKey, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await r.text();
    let j = null; try { j = texto ? JSON.parse(texto) : null; } catch { j = null; }
    if (r.ok) return { ok: true, data: j };
    const m = (j && (j.response && j.response.message || j.message || j.error)) || "";
    return { ok: false, status: r.status, erro: `Evolution HTTP ${r.status}${m ? ": " + (Array.isArray(m) ? m.join("; ") : m) : ""}` };
  } catch (e) {
    return { ok: false, erro: /abort|timeout/i.test(e && e.message || "") ? "a Evolution demorou demais" : `sem resposta da Evolution (${e && e.message})` };
  }
}

// Responde no chat (grupo ou privado). `citar` = { waId, participante } responde citando.
async function enviarTexto(destino, texto, { citar } = {}) {
  const corpo = { number: destino, text: texto, linkPreview: false };
  if (citar && citar.waId) corpo.quoted = { key: { id: citar.waId, remoteJid: destino, fromMe: false, ...(citar.participante ? { participant: citar.participante } : {}) }, message: { conversation: "" } };
  let r = await chamar(`/message/sendText/${inst()}`, { method: "POST", timeoutMs: 30000, body: corpo });
  if (!r.ok && corpo.quoted) { delete corpo.quoted; r = await chamar(`/message/sendText/${inst()}`, { method: "POST", timeoutMs: 30000, body: corpo }); }
  return r.ok ? { ok: true, data: { waId: r.data && r.data.key && r.data.key.id || null } } : r;
}

// Baixa a mídia de uma mensagem em base64 (a Evolution descriptografa e devolve). Vai a mensagem
// INTEIRA (com mediaKey e directPath): esta instância não guarda mensagens, e só com a chave a
// Evolution responde "Message not found".
async function baixarMidia(key, mensagem) {
  const message = mensagem ? { key, message: mensagem } : { key };
  const r = await chamar(`/chat/getBase64FromMediaMessage/${inst()}`, { method: "POST", timeoutMs: 60000, body: { message, convertToMp4: false } });
  if (!r.ok) return r;
  const d = r.data || {};
  if (!d.base64) return { ok: false, erro: "a Evolution não devolveu o arquivo" };
  return { ok: true, data: { base64: d.base64, mime: d.mimetype || d.mimeType || "", nome: d.fileName || "" } };
}

async function perfilInstancia() {
  const r = await chamar(`/instance/fetchInstances?instanceName=${inst()}`);
  if (!r.ok) return r;
  const lista = Array.isArray(r.data) ? r.data : [];
  const i = lista.find((x) => (x.name || x.instanceName) === cfg().instancia) || lista[0];
  const jid = i && (i.ownerJid || i.number) || null;
  const numero = jid ? String(jid).split("@")[0].split(":")[0].replace(/\D/g, "") || null : null;
  return { ok: true, data: { numero, nome: (i && i.profileName) || null, estado: (i && i.connectionStatus) || null } };
}

// Nome (assunto) do grupo, só para a tela. Falha aqui não impede nada.
async function nomeDoGrupo(groupJid) {
  const r = await chamar(`/group/findGroupInfos/${inst()}?groupJid=${encodeURIComponent(groupJid)}`, { timeoutMs: 30000 });
  return r.ok ? (r.data && r.data.subject) || null : null;
}

// QR code para conectar o número (imagem em base64). Sem QR quando já está conectado.
async function obterQr() {
  const r = await chamar(`/instance/connect/${inst()}`, { timeoutMs: 30000 });
  if (!r.ok) return r;
  if (r.data && r.data.instance && r.data.instance.state === "open") return { ok: true, data: { qr: null, estado: "open" } };
  return { ok: true, data: { qr: (r.data && r.data.base64) || null, estado: "connecting" } };
}

module.exports = { enviarTexto, baixarMidia, perfilInstancia, nomeDoGrupo, obterQr, cfg };
