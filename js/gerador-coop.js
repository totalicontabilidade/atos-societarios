/* ============================================================
   Atos Societários · Totali
   gerador-coop.js — ATA DE ASSEMBLEIA GERAL DE CONSTITUIÇÃO e
   ESTATUTO SOCIAL de cooperativa, no formato .docx.

   Fontes (todas na pasta modelos-jucese):
     • ATA-DA-ASSEMBLEIA-GERAL-DE-CONSTITUIÇÃO (modelo da Junta)
     • Manual de Registro de Cooperativa (DREI), Cap. II, Seção I:
       item 3 (mínimo de 20 fundadores; 7 na cooperativa de trabalho),
       item 8 (elementos obrigatórios da ata — art. 15 da Lei 5.764),
       item 9 (conteúdo obrigatório do estatuto — art. 21 da Lei 5.764),
       item 9.1 (denominação com "Cooperativa" / "Cooperativa de Trabalho"),
       item 9.7 (visto de advogado no estatuto), item 9.8 (ME/EPP só
       para cooperativa de consumo).
     • modelos-coop.js — o texto do estatuto, transcrito.

   O que este arquivo faz é MONTAR; o texto legal mora em
   modelos-coop.js. Quem chama entrega os dados do formulário e os
   ajudantes do app (qualificação, extenso, runs em negrito…), para
   que o documento saia com a mesma cara dos demais atos.
   ============================================================ */
(function () {
  "use strict";

  var ROM = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV","XXV"];
  var LET = "abcdefghijklmnopqrstuvwxyz";

  /* Preenche {{campo}} com os dados. Campo sem valor vira [CAMPO] em maiúsculas — é o que a
     validação do app procura para barrar documento com variável solta. */
  function preencher(txt, v) {
    return String(txt).replace(/\{\{(,?)([A-Za-z0-9_]+)\}\}/g, function (_, virgula, k) {
      var val = v[k];
      if (val === undefined || val === null || val === "") return virgula ? "" : "[" + k.toUpperCase() + "]";
      return virgula ? ", " + val : String(val);
    });
  }

  // um item de lista pode ser texto ou {opc,quando,txt}; devolve o texto se entra, null se não
  function itemAtivo(it, esc) {
    if (typeof it === "string") return it;
    if (it && it.opc) return (esc[it.opc] === it.quando) ? it.txt : null;
    return it && it.txt ? it.txt : null;
  }

  /* Gera os parágrafos do estatuto. h = ajudantes do app: P(children,align,spacing,keepNext),
     T(text,opts), R(texto) → runs com negrito automático, CEN/JUST, SP15/SP10_0. */
  function estatuto(modelo, dados, esc, h) {
    var out = [];
    modelo.blocos.forEach(function (b) {
      if (b.opc && esc[b.opc] !== b.quando) return;
      if (b.tit) { out.push(h.P([h.T(b.tit, { bold: true })], h.CEN, h.SP10_0, true)); out.push(h.P([h.T(b.sub, { bold: true })], h.CEN, h.SP10)); return; }
      if (b.cap) { out.push(h.P([h.T(b.cap, { bold: true })], h.CEN, h.SP10_0, true)); out.push(h.P([h.T(b.sub, { bold: true })], h.CEN, h.SP10)); return; }
      if (b.sec) { out.push(h.P([h.T(b.sec + " – " + b.sub, { bold: true })], h.CEN, h.SP10, true)); return; }
      if (!b.art) return;
      var rot = "Art. " + b.art + (/º$/.test(b.art) ? "" : ".") + " ";
      out.push(h.P([h.T(rot, { bold: true })].concat(h.R(preencher(b.txt, dados))), h.JUST, h.SP15));
      var n = 0;
      (b.inc || []).forEach(function (it) { var t = itemAtivo(it, esc); if (t === null) return; out.push(h.P(h.R(ROM[n++] + " – " + preencher(t, dados)), h.JUST, h.SP15)); });
      var a = 0;
      (b.al || []).forEach(function (it) { var t = itemAtivo(it, esc); if (t === null) return; out.push(h.P(h.R(LET[a++] + ") " + preencher(t, dados)), h.JUST, h.SP15)); });
      (b.par || []).forEach(function (it) { var t = itemAtivo(it, esc); if (t === null) return;
        var m = /^(§ \d+º|Parágrafo único\.)\s*/.exec(t);
        if (m) out.push(h.P([h.T(m[1] + " ", { bold: true })].concat(h.R(preencher(t.slice(m[0].length), dados))), h.JUST, h.SP15));
        else out.push(h.P(h.R(preencher(t, dados)), h.JUST, h.SP15)); });
    });
    return out;
  }

  /* Ata da assembleia geral de constituição — segue o modelo da Junta e o art. 15 da Lei 5.764:
     local/hora/data; qualificação de TODOS os fundadores com quotas subscritas e forma de
     integralização; mesa; aprovação do estatuto artigo por artigo; eleição e posse dos órgãos,
     com qualificação dos eleitos; declaração de desimpedimento (em maiúsculas, como no modelo);
     declaração de constituição com denominação, sede completa e objeto; fecho e assinaturas de
     todos os fundadores. */
  function ata(d, h) {
    var out = [];
    var fund = d.fundadores || [];
    var qual = function (s) { return (s.nome || "[NOME]").toUpperCase() + ", " + h.qualificacao(s).replace(/;?\s*$/, ""); };
    var quotasDe = function (s) {
      var q = Number(s.quotas) || 0, v = q * (Number(d.valorQuota) || 0);
      return "subscrevendo " + h.numBR(q) + " (" + h.extensoInt(q) + ") quotas-partes, no valor total de " + h.reais(v) + " (" + h.extensoReais(v) + "), " + (s.integr || d.integrPadrao || "integralizadas à vista, em moeda corrente do País");
    };
    out.push(h.P([h.T("ATA DA ASSEMBLEIA GERAL DE CONSTITUIÇÃO", { bold: true })], h.CEN, h.SP10_0, true));
    out.push(h.P([h.T((d.denominacao || "[DENOMINAÇÃO]").toUpperCase(), { bold: true })], h.CEN, h.SP10));
    out.push(h.P(h.R("Aos " + h.dataExtenso(d.data) + ", às " + (d.hora || "[HORA]") + " horas, em " + (d.local || d.sedeLinha || "[LOCAL]")
      + ", reuniram-se, com o propósito de constituírem uma sociedade cooperativa, nos termos da legislação vigente, as seguintes pessoas:"), h.JUST, h.SP15));
    fund.forEach(function (s, i) {
      out.push(h.P(h.R((i + 1) + ". " + qual(s) + ", " + quotasDe(s) + (i < fund.length - 1 ? ";" : ".")), h.JUST, h.SP10));
    });
    out.push(h.P(h.R("Foi aclamado para presidir os trabalhos " + h.gsex(d.presidenteMesa, "o Senhor ", "a Senhora ") + (d.presidenteMesa.nome || "[PRESIDENTE DA MESA]").toUpperCase()
      + ", que convidou " + h.gsex(d.secretarioMesa, "o Senhor ", "a Senhora ") + (d.secretarioMesa.nome || "[SECRETÁRIO DA MESA]").toUpperCase() + " para secretariar os trabalhos e lavrar a presente Ata"
      + (d.mesaOutros ? ", tendo participado ainda da mesa " + d.mesaOutros : "") + "."), h.JUST, h.SP15));
    out.push(h.P(h.R("O presidente solicitou que fosse apresentado, explicado e debatido o Projeto de Estatuto da sociedade, anteriormente elaborado, o que foi feito artigo por artigo. O Estatuto foi aprovado pelo voto dos "
      + (d.tipo === "trabalho" ? "sócios" : "associados") + " fundadores, cujos nomes estão devidamente consignados nesta Ata, e passa a fazer parte integrante dela."), h.JUST, h.SP15));
    // eleição dos órgãos
    var orgaoNome = d.orgao === "diretoria" ? "a Diretoria" : "o Conselho de Administração";
    var adm = fund.filter(function (s) { return s.cargo && !/fiscal/i.test(s.cargo); });
    var fisE = fund.filter(function (s) { return /fiscal.*efetiv/i.test(s.cargo || ""); });
    var fisS = fund.filter(function (s) { return /fiscal.*suplent/i.test(s.cargo || ""); });
    var lista = function (arr) { return arr.map(function (s) { return (s.cargo ? s.cargo + ": " : "") + qual(s); }).join("; "); };
    out.push(h.P(h.R("A seguir, o presidente determinou que se procedesse à eleição dos membros dos órgãos sociais, conforme dispõe o Estatuto recém-aprovado. Procedida à votação, foram eleitos para compor " + orgaoNome
      + ", com mandato até " + (d.mandatoAte || "[TÉRMINO DO MANDATO]") + ", os seguintes " + (d.tipo === "trabalho" ? "sócios" : "associados") + ": " + (lista(adm) || "[ELEITOS PARA A ADMINISTRAÇÃO]")
      + ". Para membros efetivos do Conselho Fiscal foram eleitos: " + (lista(fisE) || "[CONSELHEIROS FISCAIS EFETIVOS]")
      + (fisS.length ? "; e para seus suplentes: " + lista(fisS) : "") + ", devendo haver, anualmente, a renovação de dois terços dos integrantes do Conselho Fiscal."), h.JUST, h.SP15));
    out.push(h.P(h.R("Prosseguindo, todos foram empossados nos seus cargos e OS ELEITOS DECLARAM, SOB AS PENAS DA LEI, QUE NÃO ESTÃO IMPEDIDOS DE EXERCER A ADMINISTRAÇÃO E/OU A FISCALIZAÇÃO DA COOPERATIVA, POR LEI ESPECIAL OU EM VIRTUDE DE CONDENAÇÃO CRIMINAL, OU POR SE ENCONTRAREM SOB OS EFEITOS DELA, A PENA QUE VEDE, AINDA QUE TEMPORARIAMENTE, O ACESSO A CARGOS PÚBLICOS, OU POR CRIME FALIMENTAR, DE PREVARICAÇÃO, PEITA OU SUBORNO, CONCUSSÃO, PECULATO, OU CONTRA A ECONOMIA POPULAR, CONTRA O SISTEMA FINANCEIRO NACIONAL, CONTRA NORMAS DE DEFESA DA CONCORRÊNCIA, CONTRA AS RELAÇÕES DE CONSUMO, FÉ PÚBLICA OU A PROPRIEDADE, DE ACORDO COM O ART. 51 DA LEI Nº 5.764, DE 1971, E O § 1º DO ART. 1.011 DO CÓDIGO CIVIL, BEM COMO QUE NÃO SÃO PARENTES ENTRE SI ATÉ SEGUNDO GRAU, EM LINHA RETA OU COLATERAL."), h.JUST, h.SP15));
    out.push(h.P(h.R((d.orgao === "diretoria" ? "O Presidente da Diretoria" : "O Presidente do Conselho de Administração") + ", assumindo a direção dos trabalhos, declarou definitivamente constituída, desta data para o futuro, a "
      + (d.denominacao || "[DENOMINAÇÃO]").toUpperCase() + ", com sede em " + (d.sedeLinha || "[SEDE COMPLETA]") + ", que tem por objeto: " + (d.objetoResumo || d.objeto || "[OBJETO]") + "."), h.JUST, h.SP15));
    out.push(h.P(h.R("Como nada mais houvesse a ser tratado, o Senhor Presidente deu por encerrados os trabalhos e eu, que servi de Secretário, lavrei a presente Ata que, lida e achada conforme, contém as assinaturas de todos os "
      + (d.tipo === "trabalho" ? "sócios" : "associados") + " fundadores, como prova da livre vontade de cada um de organizar a Cooperativa."), h.JUST, h.SP15));
    out.push(h.P([h.T((d.cidade || "[CIDADE]") + "/" + (d.uf || "") + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
    return out;
  }

  /* Assinaturas: presidente e secretário da mesa, depois TODOS os fundadores (art. 15, VIII). */
  function assinaturas(d, h) {
    var out = [];
    var bloco = function (nome, papel) {
      out.push(h.P([h.T("_".repeat(46))], h.CEN, h.SPLINE15_0, true));
      out.push(h.P([h.T((nome || "[NOME]").toUpperCase(), { bold: true })], h.CEN, h.SP10_0, true));
      out.push(h.P([h.T(papel)], h.CEN, { after: 220, line: 240, lineRule: h.AUTO }));
    };
    bloco(d.presidenteMesa.nome, "Presidente da Assembleia");
    bloco(d.secretarioMesa.nome, "Secretário da Assembleia");
    (d.fundadores || []).forEach(function (s) { bloco(s.nome, (s.cargo ? s.cargo + " — " : "") + (d.tipo === "trabalho" ? "Sócio fundador" : "Associado fundador").replace(/o fundador$/, h.gsex(s, "o fundador", "a fundadora"))); });
    return out;
  }

  window.GeradorCoop = { estatuto: estatuto, ata: ata, assinaturas: assinaturas, preencher: preencher };
})();
