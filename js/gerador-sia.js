/* ============================================================
   Atos Societários · Totali
   gerador-sia.js — SOCIEDADE INDIVIDUAL DE ADVOCACIA (registro
   no Conselho Seccional da OAB, não na Junta Comercial).

   Dois atos:
     • ATO CONSTITUTIVO
     • ALTERAÇÃO DO ATO CONSTITUTIVO + CONSOLIDAÇÃO (a OAB/SE pede
       "a alteração e o contrato social consolidado").

   Fontes:
     • Lei nº 8.906/1994, arts. 15 a 17 (redação das Leis 13.247/2016
       e 14.365/2022): unipessoal admitida (art. 15), denominação com
       "Sociedade Individual de Advocacia" e vedações (art. 16),
       responsabilidade subsidiária e ilimitada (art. 17).
     • Regulamento Geral do Estatuto, arts. 37 a 43.
     • Provimento CFOAB nº 170/2016 (alterado pelo 172/2016): cláusulas
       obrigatórias (art. 2º), gestão pelo titular (art. 3º), extinção e
       averbação de impedimento (art. 4º), registro e filial (art. 6º).
     • Modelo de ato constitutivo da OAB/SE (09/2026): ordem e títulos
       das cláusulas. A redação aqui é própria; nada foi transcrito.

   Regra do escritório que vale aqui também: no consolidado, a cláusula
   alterada vai para o FUTURO e as demais ficam no PRESENTE.

   Quem chama entrega os dados e os ajudantes do app (P, T, R…), para
   o documento sair com a mesma cara dos outros atos.
   ============================================================ */
(function () {
  "use strict";

  var ORD = ["PRIMEIRA","SEGUNDA","TERCEIRA","QUARTA","QUINTA","SEXTA","SÉTIMA","OITAVA","NONA","DÉCIMA",
    "DÉCIMA PRIMEIRA","DÉCIMA SEGUNDA","DÉCIMA TERCEIRA","DÉCIMA QUARTA","DÉCIMA QUINTA"];
  var FUND = "Lei nº 8.906, de 4 de julho de 1994 (Estatuto da Advocacia e da OAB)";

  // cláusula com título (negrito, em linha própria) e corpo; parágrafos opcionais
  function clausula(h, n, titulo, corpo, paragrafos) {
    var out = [];
    out.push(h.P([h.T("CLÁUSULA " + ORD[n] + " – " + titulo, { bold: true })], h.JUST, h.SP15, true));
    out.push(h.P(h.R(corpo), h.JUST, h.SP15));
    (paragrafos || []).forEach(function (p, i, arr) {
      var rot = arr.length === 1 ? "Parágrafo único. " : "§ " + (i + 1) + "º ";
      out.push(h.P([h.T(rot, { bold: true })].concat(h.R(p)), h.JUST, h.SP15));
    });
    return out;
  }

  /* As cláusulas do ato, na ordem do modelo da OAB/SE. "muda" é o conjunto do que esta alteração
     muda (vazio na constituição); "fut" diz se a cláusula vai no futuro. */
  function clausulas(v, h, muda, consolidacao) {
    var fut = function (k) { return consolidacao && muda && muda.has(k); };
    var vb = function (k, pres, futuro) { return fut(k) ? futuro : pres; };
    var out = [], n = 0;
    var add = function (titulo, corpo, pars) { out = out.concat(clausula(h, n++, titulo, corpo, pars)); };

    add("DA DENOMINAÇÃO E DA SEDE",
      "A sociedade " + vb("nome", "adota", "adotará") + " a denominação " + v.denominacao + " e " + vb("sede", "tem", "terá")
        + " sede na " + v.sede + (v.email ? ", com endereço eletrônico " + v.email : "") + (v.fone ? " e telefone " + v.fone : "") + ".",
      ["A abertura de filial na área de outro Conselho Seccional depende do registro do ato respectivo naquele Conselho e da inscrição suplementar do titular (" + FUND.replace(/ \(.*\)$/, "") + ", art. 15, § 5º; Provimento CFOAB nº 170/2016, art. 6º, § 1º)."]);

    add("DO OBJETO",
      "A sociedade " + vb("objeto", "tem", "terá") + " por objeto exclusivo " + v.objeto
        + (v.ramo ? ", com atuação preponderante em " + v.ramo : "") + ", " + vb("objeto", "sendo-lhe vedada", "sendo-lhe vedada") + " qualquer atividade estranha à advocacia.",
      ["Os atos privativos de advogado serão praticados pelo titular ou por advogados a ele vinculados, cabendo ao titular, de forma exclusiva e intransferível, a responsabilidade técnica pelos serviços prestados (Provimento CFOAB nº 170/2016, arts. 3º e 5º)."]);

    add("DO PRAZO E DO INÍCIO DAS ATIVIDADES",
      consolidacao
        ? "A sociedade tem prazo de duração indeterminado e iniciou suas atividades " + (v.inicio ? "em " + v.inicio + ", data do registro de seu ato constitutivo" : "na data do registro de seu ato constitutivo") + " no Conselho Seccional da Ordem dos Advogados do Brasil."
        : "A sociedade terá prazo de duração indeterminado e iniciará suas atividades na data do registro deste ato no Conselho Seccional da Ordem dos Advogados do Brasil, quando adquirirá personalidade jurídica (" + FUND.replace(/ \(.*\)$/, "") + ", art. 15, § 1º).");

    add("DO CAPITAL SOCIAL",
      "O capital social " + vb("capital", "é", "será") + " de " + v.capital + " (" + v.capitalExt + "), "
        + (v.integrAte
          ? "subscrito pelo titular e a ser integralizado em moeda corrente nacional até " + v.integrAte + "."
          : vb("capital", "totalmente subscrito e integralizado", "totalmente subscrito e integralizado") + " pelo titular, em moeda corrente nacional" + (consolidacao ? "." : ", neste ato.")));

    add("DA RESPONSABILIDADE",
      "Além da sociedade, o titular responde subsidiária e ilimitadamente pelos danos causados aos clientes por ação ou omissão no exercício da advocacia, sem prejuízo da responsabilidade disciplinar em que possa incorrer (" + FUND.replace(/ \(.*\)$/, "") + ", art. 17).",
      ["Pelas demais obrigações sociais responde o patrimônio da sociedade e, subsidiariamente, o do titular, na forma do art. 1.023 do Código Civil.",
       "As procurações serão outorgadas individualmente ao titular, com a indicação da sociedade de que faz parte e do seu número de inscrição na OAB (" + FUND.replace(/ \(.*\)$/, "") + ", art. 15, § 3º)."]);

    add("DA ADMINISTRAÇÃO",
      "A sociedade é administrada pelo titular, " + h.gsex(v.titular, "a quem", "a quem") + " cabem a sua representação ativa e passiva, judicial e extrajudicial, e a responsabilidade pela gestão, podendo delegar apenas funções operacionais (Provimento CFOAB nº 170/2016, art. 3º).",
      ["É vedado o uso da denominação social em avais, fianças, endossos ou quaisquer atos estranhos ao objeto da sociedade, podendo o titular fixar retirada mensal a título de pró-labore."]);

    add("DO EXERCÍCIO SOCIAL E DOS RESULTADOS",
      "O exercício social coincide com o ano civil e se encerra em 31 de dezembro, quando será levantado o balanço; os lucros ou prejuízos apurados caberão ao titular.",
      ["A sociedade poderá levantar balanços intermediários e distribuir lucros mensalmente (Provimento CFOAB nº 170/2016, art. 2º, X)."]);

    add("DA UNIPESSOALIDADE E DO DESIMPEDIMENTO",
      "A sociedade não admitirá sócio, inclusive de serviço (Provimento CFOAB nº 170/2016, art. 2º, VIII). " + h.gsex(v.titular, "O titular declara", "A titular declara")
        + " que não integra outra sociedade de advogados, nem outra sociedade individual de advocacia, com sede ou filial na área deste Conselho Seccional (" + FUND.replace(/ \(.*\)$/, "") + ", art. 15, § 4º)"
        + (v.impedTxt
          ? ", e que se encontra " + h.gsex(v.titular, "impedido", "impedida") + " de advogar nos limites do art. 30 da mesma lei, por ser " + v.impedTxt + "."
          : ", e que não incide em nenhuma hipótese de incompatibilidade ou impedimento prevista nos arts. 27 a 30 da mesma lei."));

    add("DA DISSOLUÇÃO E DA EXTINÇÃO",
      "A sociedade será extinta pelo falecimento do titular, por sua exclusão dos quadros da Ordem dos Advogados do Brasil ou por incompatibilidade definitiva para a advocacia, procedendo-se à liquidação e à apuração de haveres em balanço especial (Provimento CFOAB nº 170/2016, art. 4º).",
      ["A incompatibilidade temporária e o impedimento do titular, inclusive a suspensão do exercício profissional, serão averbados no registro da sociedade (Provimento CFOAB nº 170/2016, art. 4º, parágrafo único).",
       "O titular poderá, a qualquer tempo, dissolver a sociedade, cabendo-lhe o patrimônio remanescente após a liquidação."]);

    add("DO FORO",
      "Fica eleito o foro da Comarca de " + v.foro + " para dirimir as questões oriundas deste ato" + (fut("foro") ? ", que passará a ser o competente" : "") + ".");

    add("DAS DISPOSIÇÕES GERAIS",
      "Os casos omissos serão regidos pela " + FUND + ", pelo seu Regulamento Geral, pelos Provimentos do Conselho Federal da OAB e, no que couber, pelo Código Civil.");
    return out;
  }

  // cláusulas da alteração propriamente dita (o que muda, com o "de → para")
  function clausulasAlteracao(v, h, muda) {
    var out = [], n = 0;
    var add = function (titulo, corpo) { out = out.concat(clausula(h, n++, titulo, corpo)); };
    if (muda.has("nome")) add("DA ALTERAÇÃO DA DENOMINAÇÃO", "A sociedade, que adotava a denominação " + (v.denominacaoAnt || "[DENOMINAÇÃO ANTERIOR]") + ", passa a adotar a denominação " + v.denominacao + ".");
    if (muda.has("sede")) add("DA ALTERAÇÃO DA SEDE", "A sede da sociedade, que estava na " + (v.sedeAnt || "[ENDEREÇO ANTERIOR]") + ", transfere-se para a " + v.sede + ".");
    if (muda.has("objeto")) add("DA ALTERAÇÃO DO OBJETO", "O objeto da sociedade passa a ser, exclusivamente, " + v.objeto + (v.ramo ? ", com atuação preponderante em " + v.ramo : "") + ".");
    if (muda.has("capital")) {
      var aumento = v.capitalAntNum > 0 && v.capitalNum > v.capitalAntNum;
      add("DA ALTERAÇÃO DO CAPITAL SOCIAL", "O capital social, que era de " + (v.capitalAnt || "[CAPITAL ANTERIOR]") + ", passa a ser de " + v.capital + " (" + v.capitalExt + ")"
        + (aumento ? ", sendo o aumento subscrito pelo titular e " + (v.integrAte ? "a integralizar em moeda corrente nacional até " + v.integrAte : "integralizado neste ato, em moeda corrente nacional") : "") + ".");
    }
    if (muda.has("foro")) add("DA ALTERAÇÃO DO FORO", "O foro eleito passa a ser o da Comarca de " + v.foro + ".");
    return out;
  }

  function assinatura(v, h) {
    return [
      h.P([h.T(v.cidadeData)], h.CEN, h.SP15),
      h.P([h.T("")], h.CEN, h.SP10),
      h.P([h.T("_".repeat(46))], h.CEN, h.SPLINE15_0, true),
      h.P([h.T(v.titularNome, { bold: true })], h.CEN, h.SP10_0, true),
      h.P([h.T(h.gsex(v.titular, "Titular", "Titular") + " – OAB/" + v.oabUF + " nº " + v.oab)], h.CEN, h.SP10)
    ];
  }

  function constitutivo(v, h) {
    var out = [];
    out.push(h.P([h.T("ATO CONSTITUTIVO DE SOCIEDADE INDIVIDUAL DE ADVOCACIA", { bold: true })], h.CEN, h.SP10_0));
    out.push(h.P([h.T(v.denominacao, { bold: true })], h.CEN, h.SP15));
    out.push(h.P(h.R(v.titularNome + ", " + v.qualificacao.replace(/;\s*$/, "") + ", constitui, com fundamento nos arts. 15 a 17 da " + FUND
      + ", nos arts. 37 a 43 do seu Regulamento Geral e no Provimento nº 170/2016 do Conselho Federal da OAB, uma sociedade individual de advocacia, que se regerá pelas cláusulas seguintes:"), h.JUST, h.SP15));
    out = out.concat(clausulas(v, h, null, false));
    out.push(h.P(h.R("E, por estar de acordo, " + h.gsex(v.titular, "o titular", "a titular") + " assina o presente ato em via única, para registro no Conselho Seccional da Ordem dos Advogados do Brasil."), h.JUST, h.SP15));
    return out.concat(assinatura(v, h));
  }

  function alteracao(v, h, muda) {
    var out = [];
    out.push(h.P([h.T((v.numAlteracao ? v.numAlteracao + "ª " : "") + "ALTERAÇÃO DO ATO CONSTITUTIVO DE SOCIEDADE INDIVIDUAL DE ADVOCACIA", { bold: true })], h.CEN, h.SP10_0));
    out.push(h.P([h.T(v.denominacaoAtual, { bold: true })], h.CEN, h.SP10_0));
    out.push(h.P([h.T("Registro na OAB/" + v.oabUF + " nº " + (v.registro || "[REGISTRO]") + (v.cnpj ? " – CNPJ nº " + v.cnpj : ""))], h.CEN, h.SP15));
    out.push(h.P(h.R(v.titularNome + ", " + v.qualificacao.replace(/;\s*$/, "") + ", " + h.gsex(v.titular, "titular", "titular") + " da sociedade individual de advocacia "
      + v.denominacaoAtual + ", com sede na " + v.sedeAtual + (v.cnpj ? ", inscrita no CNPJ sob o nº " + v.cnpj : "")
      + ", com ato constitutivo registrado no Conselho Seccional da Ordem dos Advogados do Brasil " + v.seccional + " sob o nº " + (v.registro || "[REGISTRO]")
      + (v.inicio ? ", em " + v.inicio : "") + ", resolve alterar o ato constitutivo da sociedade, com fundamento no Provimento nº 170/2016 do Conselho Federal da OAB, nos termos seguintes:"), h.JUST, h.SP15));
    out = out.concat(clausulasAlteracao(v, h, muda));
    out.push(h.P([h.T("CONSOLIDAÇÃO DO ATO CONSTITUTIVO", { bold: true })], h.CEN, h.SP15, true));
    out.push(h.P(h.R("Em razão das alterações acima, o ato constitutivo da sociedade passa a vigorar com a seguinte redação consolidada:"), h.JUST, h.SP15));
    out = out.concat(clausulas(v, h, muda, true));
    out.push(h.P(h.R("E, por estar de acordo, " + h.gsex(v.titular, "o titular", "a titular") + " assina a presente alteração, com a consolidação do ato constitutivo, em via única, para registro no Conselho Seccional da Ordem dos Advogados do Brasil."), h.JUST, h.SP15));
    return out.concat(assinatura(v, h));
  }

  window.GeradorSIA = { constitutivo: constitutivo, alteracao: alteracao, clausulas: clausulas };
})();
