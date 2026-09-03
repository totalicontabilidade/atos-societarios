/* ============================================================
   Atos Societários · Totali
   nuvem.js — login da equipe e gravação no Firestore

   REGRA DE OURO DESTE ARQUIVO: o app tem de continuar
   funcionando inteiro sem internet e sem login. A nuvem é
   acréscimo, nunca dependência. Por isso:
     • o navegador continua sendo a fonte do trabalho em
       andamento (localStorage), como sempre foi;
     • a nuvem guarda o registro compartilhado — o que permite
       abrir de outro computador e não perder ao limpar o
       navegador;
     • se a nuvem estiver fora, o app avisa baixinho e segue.

   Nada aqui lança erro para cima: quem chama recebe {ok:false}
   e decide. Uma falha de rede não pode travar a geração de um
   documento.
   ============================================================ */
(function () {
  "use strict";

  var app = null, db = null, auth = null, pronto = false, motivo = "";
  var _usuario = null, _daEquipe = false, _ouvintes = [];

  function cfgValida() {
    var c = window.ATOS_FIREBASE || {};
    return !!(c.apiKey && c.projectId && c.appId);
  }

  function avisar() {
    var est = estado();
    _ouvintes.forEach(function (fn) { try { fn(est); } catch (e) {} });
  }

  function estado() {
    return {
      configurado: cfgValida(),
      pronto: pronto,
      motivo: motivo,
      logado: !!_usuario,
      daEquipe: _daEquipe,
      email: _usuario ? _usuario.email : "",
      uid: _usuario ? _usuario.uid : "",
      online: (typeof navigator !== "undefined") ? navigator.onLine !== false : true
    };
  }

  function iniciar() {
    if (pronto || !cfgValida()) { if (!cfgValida()) motivo = "sem configuração"; return; }
    if (!window.firebase || !firebase.initializeApp) { motivo = "bibliotecas não carregaram"; return; }
    try {
      app = firebase.initializeApp(window.ATOS_FIREBASE);
      db = firebase.firestore();
      auth = firebase.auth();
      /* Cache local do Firestore: além de deixar rápido, é o que faz a leitura
         continuar respondendo sem internet. A gravação feita offline fica na fila
         e sobe sozinha quando a conexão volta. */
      try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
      auth.onAuthStateChanged(function (u) {
        _usuario = u || null; _daEquipe = false;
        if (!u) { avisar(); return; }
        /* source:"server" de propósito: com o cache ligado, um get() comum pode
           devolver um estado ANTIGO da equipe — inclusive dizer que alguém ainda
           está ativo depois de removido. Permissão se confere no servidor. */
        db.collection("equipe").doc(u.uid).get({ source: "server" })
          .then(function (d) { _daEquipe = !!(d.exists && d.data() && d.data().ativo === true); avisar(); })
          .catch(function () { _daEquipe = false; avisar(); });
      });
      pronto = true; motivo = "";
    } catch (e) { motivo = (e && e.message) || "falha ao iniciar"; }
    avisar();
  }

  function entrar(email, senha) {
    if (!pronto) return Promise.resolve({ ok: false, msg: motivo || "nuvem não configurada" });
    return auth.signInWithEmailAndPassword(String(email || "").trim(), String(senha || ""))
      .then(function () { return { ok: true }; })
      .catch(function (e) {
        var c = (e && e.code) || "";
        var m = /wrong-password|user-not-found|invalid-credential/.test(c) ? "e-mail ou senha incorretos"
              : /too-many-requests/.test(c) ? "muitas tentativas — aguarde alguns minutos"
              : /network/.test(c) ? "sem conexão"
              : (e && e.message) || "não foi possível entrar";
        return { ok: false, msg: m };
      });
  }

  function sair() { return pronto ? auth.signOut().catch(function () {}) : Promise.resolve(); }

  function podeGravar() { return pronto && _usuario && _daEquipe; }

  function carimbo(extra) {
    var o = extra || {};
    o.autorUid = _usuario ? _usuario.uid : "";
    o.autorEmail = _usuario ? _usuario.email : "";
    o.atualizadoEm = firebase.firestore.FieldValue.serverTimestamp();
    return o;
  }

  /* ---- Coleções ---- */

  function salvar(colecao, id, dados) {
    if (!podeGravar()) return Promise.resolve({ ok: false, msg: "não conectado" });
    var ref = id ? db.collection(colecao).doc(String(id)) : db.collection(colecao).doc();
    var novo = carimbo(JSON.parse(JSON.stringify(dados || {})));
    if (!id) novo.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
    return ref.set(novo, { merge: true })
      .then(function () { return { ok: true, id: ref.id }; })
      .catch(function (e) { return { ok: false, msg: (e && e.message) || "falha ao gravar" }; });
  }

  function listar(colecao, opc) {
    if (!podeGravar()) return Promise.resolve({ ok: false, msg: "não conectado", itens: [] });
    var q = db.collection(colecao);
    var o = opc || {};
    if (o.ordem) q = q.orderBy(o.ordem, o.desc ? "desc" : "asc");
    if (o.limite) q = q.limit(o.limite);
    return q.get()
      .then(function (s) {
        var itens = []; s.forEach(function (d) { var x = d.data() || {}; x.id = d.id; itens.push(x); });
        return { ok: true, itens: itens };
      })
      .catch(function (e) { return { ok: false, msg: (e && e.message) || "falha ao ler", itens: [] }; });
  }

  function excluir(colecao, id) {
    if (!podeGravar()) return Promise.resolve({ ok: false, msg: "não conectado" });
    return db.collection(colecao).doc(String(id)).delete()
      .then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, msg: (e && e.message) || "falha ao excluir" }; });
  }

  /* Trilha de auditoria: registra QUE algo aconteceu, sem dado pessoal.
     Nunca leva nome de sócio, CPF nem endereço — só o identificador do ato. */
  function trilha(acao, refId, detalhe) {
    if (!podeGravar()) return Promise.resolve({ ok: false });
    return db.collection("auditoria").add(carimbo({
      acao: String(acao || "").slice(0, 40),
      ref: String(refId || "").slice(0, 60),
      detalhe: String(detalhe || "").slice(0, 200),
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    })).then(function () { return { ok: true }; }).catch(function () { return { ok: false }; });
  }

  window.Nuvem = {
    iniciar: iniciar,
    estado: estado,
    aoMudar: function (fn) { if (typeof fn === "function") { _ouvintes.push(fn); try { fn(estado()); } catch (e) {} } },
    entrar: entrar,
    sair: sair,
    podeGravar: podeGravar,
    salvar: salvar,
    listar: listar,
    excluir: excluir,
    trilha: trilha
  };
})();
