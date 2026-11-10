// functions/portaria.js — decide, ANTES de gravar qualquer coisa, se uma mensagem é do robô.
//
// O número conectado é o WhatsApp do ESCRITÓRIO: chegam aqui as mensagens de todos os clientes.
// O robô só existe dentro de UM grupo, escolhido pela equipe com um código de administrador
// ("#ativar-atos 123456"). Tudo o mais — privado, outros grupos, status — é descartado em silêncio:
// nada é gravado, nada é respondido. Funções puras, testadas em test/portaria.test.js.
"use strict";

// "#ativar-atos 123456" (aceita sem #, com espaço no lugar do hífen, maiúsculas, e o código com espaço no meio)
function codigoDeAtivacao(texto) {
  const m = /^\s*#?\s*ativar[\s-]*atos\s*:?\s*(\d{3})\s?(\d{3})\b/i.exec(String(texto || ""));
  return m ? m[1] + m[2] : null;
}

// ev: o evento normalizado pelo parser (evento "mensagem"); cfg: solicitacoes/__whatsapp (pode ser {}).
// → { acao: "ativar", codigo } | { acao: "atender" } | { acao: "ignorar", motivo }
function decidir(ev, cfg) {
  if (!ev || ev.evento !== "mensagem") return { acao: "ignorar", motivo: "não é mensagem" };
  if (!ev.grupo) return { acao: "ignorar", motivo: "privado: o robô não atende fora do grupo" };
  const codigo = codigoDeAtivacao(ev.texto);
  if (codigo) return { acao: "ativar", codigo };
  const grupo = cfg && cfg.grupoJid ? String(cfg.grupoJid) : "";
  if (!grupo) return { acao: "ignorar", motivo: "nenhum grupo ativado" };
  if (String(ev.chatJid) !== grupo) return { acao: "ignorar", motivo: "outro grupo" };
  return { acao: "atender" };
}

module.exports = { decidir, codigoDeAtivacao };
