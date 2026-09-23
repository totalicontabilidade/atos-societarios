/* ============================================================
   Atos Societários · aviso para outro sistema
   ------------------------------------------------------------
   Quando uma solicitação é criada ou finalizada, este arquivo
   avisa um endereço configurado pelo escritório. Nada mais.

   ELE NÃO SABE O QUE EXISTE DO OUTRO LADO, e isso é de propósito:
   o Atos é vendido, e cada comprador liga a solicitação ao
   sistema que já usa. Quem traduz "solicitação criada" para o
   vocabulário do sistema de destino é o destino, não aqui. Se um
   dia este arquivo souber o que é "pendência", a integração deixa
   de servir para quem não tem aquele sistema.

   O QUE VAI NO AVISO: um JSON com o evento, o segredo combinado e
   a solicitação. As datas saem em aaaa-mm-dd — dentro do Atos a
   data é escrita como no Brasil, mas aviso entre sistemas tem de
   ser sem ambiguidade.

   POR QUE O ENVIO É "text/plain"
   Pedido de navegador com "application/json" para outro endereço
   dispara antes uma pergunta de permissão (preflight), e os
   endereços mais usados para receber isto — Apps Script, por
   exemplo — não respondem a essa pergunta. Com text/plain o
   navegador manda direto. O conteúdo continua sendo JSON, e quem
   recebe lê o corpo do mesmo jeito.

   O SEGREDO VIAJA NO CORPO, e não num cabeçalho, pelo mesmo
   motivo: cabeçalho fora do comum dispara a mesma pergunta.

   E POR QUE EXISTE UMA FILA
   Aviso que não sai numa queda de rede é solicitação que nunca
   aparece do outro lado, sem ninguém perceber. Então o que falha
   fica guardado aqui e é tentado de novo na próxima vez que o
   sistema abrir ou que outro aviso der certo.
   ============================================================ */

window.Integracao = (function () {
  "use strict";

  var CHAVE_CFG = "tinaIntegra";
  var CHAVE_FILA = "tinaIntegraFila";
  var LIMITE_DA_FILA = 50;

  function config() {
    try { return JSON.parse(localStorage.getItem(CHAVE_CFG) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function salvarConfig(c) {
    try { localStorage.setItem(CHAVE_CFG, JSON.stringify(c || {})); } catch (e) {}
  }

  function ligada() {
    var c = config();
    return !!(c.url && String(c.url).indexOf("http") === 0);
  }

  /* ---------- a fila ---------- */

  function fila() {
    try { var f = JSON.parse(localStorage.getItem(CHAVE_FILA) || "[]"); return Array.isArray(f) ? f : []; }
    catch (e) { return []; }
  }

  function gravarFila(f) {
    /* Teto: numa queda longa, guardar para sempre encheria o
       armazenamento do navegador e derrubaria o resto do sistema.
       Os mais antigos saem primeiro. */
    try { localStorage.setItem(CHAVE_FILA, JSON.stringify(f.slice(-LIMITE_DA_FILA))); } catch (e) {}
  }

  function guardarParaDepois(pacote) {
    var f = fila();
    /* Mesmo evento da mesma solicitação não entra duas vezes: o
       destino já sabe se defender de repetição, mas encher a fila
       de cópias só atrasa o que importa. */
    var igual = f.some(function (x) {
      return x.evento === pacote.evento && x.solicitacao && pacote.solicitacao &&
             x.solicitacao.id === pacote.solicitacao.id;
    });
    if (!igual) { f.push(pacote); gravarFila(f); }
  }

  function tentarFila() {
    var f = fila();
    if (!f.length || !ligada()) return Promise.resolve({ tentados: 0 });
    gravarFila([]);
    var sobraram = [];
    return f.reduce(function (antes, pacote) {
      return antes.then(function () {
        return mandar(pacote).then(function (r) {
          if (!r.ok) sobraram.push(pacote);
        });
      });
    }, Promise.resolve()).then(function () {
      if (sobraram.length) gravarFila(sobraram);
      return { tentados: f.length, sobraram: sobraram.length };
    });
  }

  /* ---------- o envio ---------- */

  function mandar(pacote) {
    var c = config();
    var corpo = JSON.stringify(Object.assign({ segredo: c.segredo || "" }, pacote));

    return fetch(c.url, {
      method: "POST",
      /* text/plain para o navegador não perguntar permissão antes
         (veja o cabeçalho deste arquivo). */
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: corpo,
    })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) {}
          /* O destino pode recusar com 200 e um "ok:false" dentro
             — é o caso do segredo errado. Isso conta como falha. */
          var deuCerto = r.ok && (!j || j.ok !== false);
          return { ok: deuCerto, resposta: j, texto: t, codigo: r.status };
        });
      })
      .catch(function (e) {
        /* Pode ser rede fora, endereço errado, ou o destino não
           deixar este site ler a resposta. Nos três casos o aviso
           talvez tenha chegado e não dá para saber: vai para a
           fila, e quem se defende de repetido é o destino. */
        return { ok: false, erro: (e && e.message) || "falha de rede" };
      });
  }

  /* ---------- tradução da solicitação ---------- */

  var TIPOS = { alt: "Alteração contratual", abe: "Abertura", bai: "Baixa",
                tra: "Transformação", out: "Outro" };
  var STATUS = { nova: "Nova", andamento: "Em andamento", cliente: "Aguardando cliente",
                 protocolada: "Protocolada", concluida: "Finalizada" };

  /* DD/MM/AAAA vira aaaa-mm-dd. Sem expressão regular: a barra
     invertida some em edição automática e o separador deixa de ser
     o que era — já aconteceu noutro sistema da casa. */
  function dataISO(v) {
    var t = String(v || "").trim();
    if (!t) return "";
    if (t.length === 10 && t.charAt(4) === "-") return t;     /* já está assim */
    var p = t.split("/");
    if (p.length !== 3) return "";
    var d = p[0], m = p[1], a = p[2];
    if (d.length !== 2 || m.length !== 2 || a.length !== 4) return "";
    return a + "-" + m + "-" + d;
  }

  function pacoteDe(reg) {
    return {
      id:          String(reg.id || ""),
      empresa:     reg.empresa || "",
      cnpj:        reg.cnpj || "",
      tipo:        reg.tipo || "",
      tipoNome:    TIPOS[reg.tipo] || "",
      prazo:       dataISO(reg.prazo),
      responsavel: reg.responsavel || "",
      contato:     reg.contato || "",
      fone:        reg.fone || "",
      status:      reg.status || "",
      statusNome:  STATUS[reg.status] || "",
      obs:         reg.obs || "",
      pendencia:   reg.pendencia || "",
      abertaPor:   reg.abertaPor || "",
    };
  }

  /* ---------- o que o sistema chama ---------- */

  function avisar(evento, reg) {
    if (!ligada()) return Promise.resolve({ ok: true, desligada: true });
    var pacote = {
      evento: evento,
      enviadoEm: new Date().toISOString(),
      solicitacao: pacoteDe(reg),
    };
    return mandar(pacote).then(function (r) {
      if (!r.ok) guardarParaDepois(pacote);
      else tentarFila();
      return r;
    });
  }

  /* Usado pelo botão "testar" das configurações: exercita o
     endereço e o segredo sem criar nada do outro lado. */
  function testar() {
    if (!ligada()) return Promise.resolve({ ok: false, erro: "falta o endereço" });
    return mandar({ evento: "teste", enviadoEm: new Date().toISOString(),
                    solicitacao: { id: "teste" } });
  }

  /* Ao abrir o sistema, o que ficou preso tenta sair. */
  if (typeof window !== "undefined") {
    window.addEventListener("load", function () {
      try { tentarFila(); } catch (e) {}
    });
  }

  return {
    config: config, salvarConfig: salvarConfig, ligada: ligada,
    avisar: avisar, testar: testar,
    fila: fila, tentarFila: tentarFila,
  };
})();
