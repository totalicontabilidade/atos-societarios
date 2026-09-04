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
  var _usuario = null, _daEquipe = false, _admin = false, _offline = false, _ouvintes = [];

  /* Permissão confirmada no servidor fica guardada por alguns dias, e SÓ serve quando não há
     rede. Com rede, a permissão é sempre reconferida no servidor — senão bastaria ficar offline
     para manter acesso depois de ser removido da equipe. */
  var DIAS_OFFLINE = 7;
  function guardarAcesso(uid) { try { localStorage.setItem("tinaAcesso", JSON.stringify({ uid: uid, em: Date.now() })); } catch (e) {} }
  function limparAcesso() { try { localStorage.removeItem("tinaAcesso"); } catch (e) {} }
  function acessoValido(uid) {
    try {
      var a = JSON.parse(localStorage.getItem("tinaAcesso") || "null");
      return !!(a && a.uid === uid && (Date.now() - a.em) < DIAS_OFFLINE * 86400000);
    } catch (e) { return false; }
  }

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
      admin: _admin,
      modoOffline: _offline,
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
        _usuario = u || null; _daEquipe = false; _admin = false;
        if (!u) { avisar(); return; }
        /* source:"server" de propósito: com o cache ligado, um get() comum pode
           devolver um estado ANTIGO da equipe — inclusive dizer que alguém ainda
           está ativo depois de removido. Permissão se confere no servidor. */
        db.collection("equipe").doc(u.uid).get({ source: "server" })
          .then(function (d) {
            var x = d.exists ? (d.data() || {}) : {};
            _daEquipe = x.ativo === true;
            _admin = _daEquipe && x.admin === true;
            _offline = false;
            if (_daEquipe) guardarAcesso(u.uid); else limparAcesso();
            avisar();
          })
          /* Sem rede a checagem no servidor falha — e o app é offline-first: quem já entrou
             precisa continuar trabalhando no cliente, no cartório, sem sinal. Vale então a
             permissão confirmada há pouco, por tempo limitado. Administrar equipe, não: isso
             exige servidor, e fica bloqueado no modo offline. */
          .catch(function () {
            if (acessoValido(u.uid)) { _daEquipe = true; _admin = false; _offline = true; }
            else { _daEquipe = false; _admin = false; _offline = false; }
            avisar();
          });
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

  function sair() { limparAcesso(); return pronto ? auth.signOut().catch(function () {}) : Promise.resolve(); }

  // devolve BOOLEANO de verdade: sem o !! isto entregava null quando ninguém estava logado,
  // e quem chama compara com false
  function podeGravar() { return !!(pronto && _usuario && _daEquipe); }

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

  /* ---- Equipe (só administrador) ----
     Criar a conta de login exige um app SECUNDÁRIO do Firebase: com o app principal,
     createUser trocaria a sessão para a pessoa recém-criada e derrubaria o administrador
     no meio do cadastro. O secundário nasce, cria a conta, faz signOut e é destruído. */
  function eqListar() { return listar("equipe", {}); }

  function eqCadastrar(nome, email, senha, admin) {
    if (!(pronto && _admin)) return Promise.resolve({ ok: false, msg: "só administrador" });
    email = String(email || "").trim(); senha = String(senha || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.resolve({ ok: false, msg: "e-mail inválido" });
    if (senha.length < 8) return Promise.resolve({ ok: false, msg: "a senha inicial precisa de ao menos 8 caracteres" });
    var sec = null;
    try { sec = firebase.initializeApp(window.ATOS_FIREBASE, "cadastro-" + Date.now()); }
    catch (e) { return Promise.resolve({ ok: false, msg: "não foi possível iniciar o cadastro" }); }
    return sec.auth().createUserWithEmailAndPassword(email, senha)
      .then(function (cred) {
        var uid = cred.user.uid;
        return sec.auth().signOut().catch(function () {}).then(function () {
          return db.collection("equipe").doc(uid).set({
            nome: String(nome || "").trim() || email,
            email: email, ativo: true, admin: admin === true,
            criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            criadoPor: _usuario ? _usuario.uid : ""
          });
        }).then(function () { return { ok: true, uid: uid }; });
      })
      .catch(function (e) {
        var c = (e && e.code) || "";
        return { ok: false, msg: /email-already-in-use/.test(c) ? "já existe conta com este e-mail"
          : /weak-password/.test(c) ? "senha fraca demais"
          : /operation-not-allowed/.test(c) ? "ative E-mail/senha no Firebase"
          : (e && e.message) || "falha ao cadastrar" };
      })
      .finally(function () { try { sec.delete(); } catch (e) {} });
  }

  function eqAtualizar(uid, campos) {
    if (!(pronto && _admin)) return Promise.resolve({ ok: false, msg: "só administrador" });
    // trava contra auto-rebaixamento: quem está logado não mexe no próprio registro
    if (uid === (_usuario && _usuario.uid)) return Promise.resolve({ ok: false, msg: "peça a outro administrador para alterar o seu próprio acesso" });
    return db.collection("equipe").doc(uid).update(campos || {})
      .then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, msg: (e && e.message) || "falha ao atualizar" }; });
  }

  /* Fica ouvindo a coleção e avisa quando aparece documento NOVO criado por outra pessoa.
     É o que permite a notificação de solicitação nova sem servidor nenhum. A primeira
     resposta é ignorada de propósito: ela traz tudo o que já existe, e virariam avisos falsos. */
  function ouvirNovos(colecao, aoChegar) {
    if (!(pronto && _usuario)) return function () {};
    var primeira = true;
    try {
      return db.collection(colecao).onSnapshot(function (snap) {
        if (primeira) { primeira = false; return; }
        snap.docChanges().forEach(function (c) {
          if (c.type !== "added") return;
          var x = c.doc.data() || {}; x.id = c.doc.id;
          if (x.autorUid && x.autorUid === _usuario.uid) return;   // não avisa do próprio lançamento
          try { aoChegar(x); } catch (e) {}
        });
      }, function () {});
    } catch (e) { return function () {}; }
  }

  window.Nuvem = {
    iniciar: iniciar,
    ouvirNovos: ouvirNovos,
    eqListar: eqListar, eqCadastrar: eqCadastrar, eqAtualizar: eqAtualizar,
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
