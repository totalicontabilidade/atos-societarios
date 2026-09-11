/* ============================================================
   Atos Societários · Totali
   gerador-sa.js — atas, anexos e contrato das SOCIEDADES ANÔNIMAS.

   Três atos:
     1. Transformação de Ltda em S.A.  (modelo "02" do portal da Junta)
        alteração de transformação + ata de assembleia de constituição
        por transformação + estatuto + Anexo I (desimpedimento e posse
        dos diretores) + Anexo II (lista de subscrição de ações)
     2. Constituição de S.A. por assembleia (Lei 6.404, arts. 80 a 88;
        Manual de S.A., Cap. II, Seção I) — não há modelo no portal:
        a ata segue os elementos que o Manual e a lei exigem, e o
        estatuto e os anexos são os mesmos do item 1
     3. Transformação de S.A. em Ltda  (modelo "03" do portal)
        ata de assembleia geral extraordinária + contrato social

   Onde o modelo do portal está errado, este arquivo corrige e diz
   por quê (ver também modelos-sa.js):
     • o contrato social do modelo 03 tem o preâmbulo copiado de um
       modelo de EIRELI ("titular da empresa individual de
       responsabilidade limitada… § 3º do art. 968") — uma S.A. tem
       acionistas, não titular, e a transformação se dá pelos arts.
       220 a 222 da Lei 6.404 e 1.113 a 1.115 do Código Civil;
     • as ações são sempre NOMINATIVAS (Lei 8.021/1990; art. 20 da
       Lei 6.404).
   O texto legal do estatuto mora em modelos-sa.js; aqui só se monta.
   ============================================================ */
(function () {
  "use strict";

  function nomeUP(s) { return (s.nome || "[NOME]").toUpperCase(); }
  function qual(h, s) { return nomeUP(s) + ", " + h.qualificacao(s).replace(/;?\s*$/, ""); }
  function extInt(h, n) { return h.extensoInt(Number(n) || 0); }
  /* título de peça que começa em página nova: o app fornece h.TIT (parágrafo com quebra de página); sem ele, título comum */
  function titPagina(h, texto) { return h.TIT ? h.TIT(texto) : h.P([h.T(texto, { bold: true })], h.CEN, h.SP10, true); }

  /* tabela NOME | AÇÕES ORDINÁRIAS | VALOR | % — mesma cara da tabela de quotas dos outros atos */
  function tabelaAcoes(d, h) {
    var X = h.X, TB = X.Table, TR = X.TableRow, TC = X.TableCell, WT = X.WidthType;
    var cel = function (t, al, bold) { return new TC({ children: [h.P([h.T(t, { bold: !!bold })], al || h.LEFT, h.SP10_0)] }); };
    var linhas = [new TR({ tableHeader: true, children: [cel("Acionista", h.LEFT, true), cel("Ações ordinárias", h.CEN, true), cel("Valor (R$)", h.CEN, true), cel("Percentual", h.CEN, true)] })];
    var totA = 0, totV = 0;
    d.acionistas.forEach(function (s) {
      var a = Number(s.quotas) || 0, v = a * d.valorAcao; totA += a; totV += v;
      linhas.push(new TR({ children: [cel(s.nome || "[NOME]"), cel(h.numBR(a), h.CEN), cel(h.reais(v), h.CEN), cel(h.pct(d.capital > 0 ? v / d.capital * 100 : 0), h.CEN)] }));
    });
    linhas.push(new TR({ children: [cel("TOTAL", h.LEFT, true), cel(h.numBR(totA), h.CEN, true), cel(h.reais(totV), h.CEN, true), cel(h.pct(d.capital > 0 ? totV / d.capital * 100 : 0), h.CEN, true)] }));
    return new TB({ width: { size: 100, type: WT.PERCENTAGE }, rows: linhas });
  }

  function assinatura(out, h, nome, papel) {
    out.push(h.P([h.T("_".repeat(46))], h.CEN, h.SPLINE15_0, true));
    out.push(h.P([h.T((nome || "[NOME]").toUpperCase(), { bold: true })], h.CEN, h.SP10_0, true));
    out.push(h.P([h.T(papel)], h.CEN, { after: 220, line: 240, lineRule: h.AUTO }));
  }

  /* ---------- 1a. Alteração de transformação de Ltda em S.A. (instrumento curto) ---------- */
  function alteracaoTransfLtdaSa(d, h) {
    var out = [];
    out.push(h.P([h.T("ALTERAÇÃO DE TRANSFORMAÇÃO DE SOCIEDADE LIMITADA EM SOCIEDADE ANÔNIMA", { bold: true })], h.CEN, h.SP10_0, true));
    out.push(h.P([h.T(d.razaoAnteriorUP + " LTDA", { bold: true })], h.CEN, h.SP10_0));
    out.push(h.P([h.T("CNPJ " + (d.cnpj || "[CNPJ]") + (d.nire ? " — NIRE " + d.nire : ""))], h.CEN, h.SP10));
    d.acionistas.forEach(function (s) { out.push(h.P(h.R(qual(h, s) + ";"), h.JUST, h.SP10)); });
    var plural = d.acionistas.length > 1;
    out.push(h.P(h.R((plural ? "Únicos sócios componentes" : "Único sócio componente") + " da sociedade empresária limitada que gira sob a denominação de " + d.razaoAnteriorUP + " LTDA, com sede na " + d.sedeLinha
      + ", com contrato social arquivado na " + d.junta + (d.nire ? " sob o NIRE " + d.nire : "") + ", inscrita no CNPJ sob o nº " + (d.cnpj || "[CNPJ]") + ", " + (plural ? "resolvem" : "resolve") + ":"), h.JUST, h.SP15));
    out.push(h.P([h.T("Cláusula Primeira – ", { bold: true })].concat(h.R("Fica transformada esta Sociedade Empresária Limitada em Sociedade Anônima, sob o nome empresarial de: " + d.denominacaoUP + ", com sub-rogação de todos os direitos e obrigações pertinentes.")), h.JUST, h.SP15));
    out.push(h.P([h.T("Cláusula Segunda – ", { bold: true })].concat(h.R("O acervo desta Sociedade Empresária Limitada, no valor de " + h.reais(d.capital) + " (" + h.extensoReais(d.capital) + "), passa a constituir o capital da Sociedade Anônima mencionada na cláusula anterior.")), h.JUST, h.SP15));
    out.push(h.P(h.R("Para tanto, " + (plural ? "firmam" : "firma") + " nesta mesma data, em documento separado, a Ata da Assembleia de Constituição por Transformação e o Estatuto Social da sociedade anônima."), h.JUST, h.SP15));
    out.push(h.P([h.T(d.cidadeUF + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
    d.acionistas.forEach(function (s) { assinatura(out, h, s.nome, s.administrador ? h.gsex(s, "Sócio Administrador", "Sócia Administradora") : h.gsex(s, "Sócio", "Sócia")); });
    return out;
  }

  /* ---------- 1b. Ata de assembleia de constituição por transformação ---------- */
  function ataTransfLtdaSa(d, h) {
    var out = [];
    out.push(titPagina(h, "ATA DE ASSEMBLEIA DE CONSTITUIÇÃO POR TRANSFORMAÇÃO DE SOCIEDADE LIMITADA EM SOCIEDADE ANÔNIMA, REALIZADA EM " + h.dataExtenso(d.data).toUpperCase()));
    out.push(h.P(h.R("Aos " + h.dataExtenso(d.data) + ", às " + (d.hora || "[HORA]") + " horas, na sede da sociedade empresária limitada " + d.razaoAnteriorUP + " LTDA, estabelecida na " + d.sedeLinha
      + ", reuniram-se os únicos sócios, titulares da totalidade do capital social: " + d.acionistas.map(function (s) { return qual(h, s); }).join("; ") + "."), h.JUST, h.SP15));
    out.push(h.P(h.R("Para presidir a reunião foi " + h.gsex(d.presMesa, "eleito", "eleita") + ", por aclamação, " + h.gsex(d.presMesa, "o Sr. ", "a Sra. ") + nomeUP(d.presMesa) + ", que, aceitando a incumbência, convidou a mim, "
      + nomeUP(d.secMesa) + ", para " + h.gsex(d.presMesa, "secretariá-lo", "secretariá-la") + ", assim se constituindo a mesa e dando-se início aos trabalhos."), h.JUST, h.SP15));
    var nQ = d.numQuotas, vQ = d.valorAcao;
    out.push(h.P(h.R("A presente Assembleia tem por finalidade deliberar sobre a transformação da sociedade empresária limitada em sociedade anônima, observadas as disposições legais em vigor, transformação esta que visa à maior expansão do seu negócio e para cuja consecução deliberam que a sociedade passará a operar sob a denominação de "
      + d.denominacaoUP + ", e as atuais " + h.numBR(nQ) + " (" + extInt(h, nQ) + ") quotas, no valor unitário de " + h.reais(vQ) + " (" + h.extensoReais(vQ) + "), subscritas e integralizadas em moeda corrente do País, serão transformadas em "
      + h.numBR(nQ) + " (" + extInt(h, nQ) + ") ações ordinárias nominativas, com valor nominal de " + h.reais(vQ) + " (" + h.extensoReais(vQ) + ") cada ação, a serem emitidas aos atuais sócios, na mesma proporção das quotas por eles possuídas, a saber:"), h.JUST, h.SP15));
    out.push(tabelaAcoes(d, h));
    out.push(h.P([h.T("")], h.JUST, h.SP10_0));
    out.push(h.P(h.R("Logo em seguida, passou-se a eleger a Diretoria, de forma unânime e consensual, ficando todos os membros considerados empossados a partir da data de assinatura deste instrumento, da seguinte forma: "
      + d.diretores.map(function (s) { return nomeUP(s) + ", devidamente acima " + h.gsex(s, "qualificado", "qualificada") + ", para o cargo de " + h.gsex(s, "Diretor", "Diretora") + " sem designação específica"; }).join("; e ") + "."), h.JUST, h.SP15));
    out.push(h.P(h.R("Deliberada a transformação, " + h.gsex(d.presMesa, "o Senhor Presidente", "a Senhora Presidente") + " solicitou a mim, " + h.gsex(d.secMesa, "secretário", "secretária") + ", que procedesse à leitura do Estatuto Social, das Declarações de Desimpedimento e Termos de Posse da Diretoria (Anexo I) e da Lista de Subscrição de Ações (Anexo II), os quais, lidos e postos em discussão, foram aprovados por unanimidade, sem restrições, e passam a fazer parte integrante da presente Ata."), h.JUST, h.SP15));
    out.push(h.P([h.T("ENCERRAMENTO: ", { bold: true })].concat(h.R("Nada mais havendo a tratar, colocou-se a palavra à disposição dos presentes e, como ninguém manifestou interesse em fazer uso dela, suspenderam-se os trabalhos pelo tempo necessário à lavratura da presente Ata, a qual, depois de lida e achada conforme, foi assinada pelos sócios e pelos membros da Diretoria eleitos.")), h.JUST, h.SP15));
    out.push(h.P([h.T(d.cidadeUF + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
    assinatura(out, h, d.presMesa.nome, "Presidente da Mesa");
    assinatura(out, h, d.secMesa.nome, h.gsex(d.secMesa, "Secretário da Mesa", "Secretária da Mesa"));
    d.acionistas.forEach(function (s) { assinatura(out, h, s.nome, (s.administrador ? h.gsex(s, "Diretor", "Diretora") + " e " : "") + h.gsex(s, "Acionista", "Acionista")); });
    return out;
  }

  /* ---------- 2. Ata da assembleia geral de constituição (Lei 6.404, arts. 80 a 88) ---------- */
  function ataConstituicaoSa(d, h) {
    var out = [];
    var entrada = d.capital * d.entradaPct;
    out.push(h.P([h.T("ATA DA ASSEMBLEIA GERAL DE CONSTITUIÇÃO DA " + d.denominacaoUP, { bold: true })], h.CEN, h.SP10, true));
    out.push(h.P(h.R("Aos " + h.dataExtenso(d.data) + ", às " + (d.hora || "[HORA]") + " horas, em " + (d.local || d.sedeLinha) + ", reuniram-se os subscritores da totalidade do capital social da companhia em organização "
      + d.denominacaoUP + ": " + d.acionistas.map(function (s) { return qual(h, s); }).join("; ") + " — dispensada a convocação prévia, na forma do § 4º do art. 124 da Lei nº 6.404, de 15 de dezembro de 1976, por estarem presentes os subscritores de todo o capital."), h.JUST, h.SP15));
    out.push(h.P(h.R("Para presidir a Assembleia foi " + h.gsex(d.presMesa, "eleito", "eleita") + ", por aclamação, " + h.gsex(d.presMesa, "o Sr. ", "a Sra. ") + nomeUP(d.presMesa) + ", que convidou a mim, " + nomeUP(d.secMesa)
      + ", para " + h.gsex(d.presMesa, "secretariá-lo", "secretariá-la") + ", assim se constituindo a mesa."), h.JUST, h.SP15));
    var nPess = d.acionistas.length, nPessExt = extInt(h, nPess).replace(/\bum\b/g, "uma").replace(/\bdois\b/g, "duas").replace(/entos\b/g, "entas");   // "pessoas" pede o feminino
    out.push(h.P(h.R("Instalada a Assembleia, " + h.gsex(d.presMesa, "o Presidente", "a Presidente") + " verificou o preenchimento dos requisitos preliminares do art. 80 da Lei nº 6.404, de 1976: a subscrição, por " + h.numBR(nPess) + " (" + nPessExt + ") pessoas, de todo o capital social, de "
      + h.reais(d.capital) + " (" + h.extensoReais(d.capital) + "), dividido em " + h.numBR(d.numQuotas) + " (" + extInt(h, d.numQuotas) + ") ações ordinárias nominativas, com valor nominal de " + h.reais(d.valorAcao) + " (" + h.extensoReais(d.valorAcao) + ") cada uma, conforme a lista de subscrição (Anexo II); e a realização, como entrada, de "
      + h.pct(d.entradaPct * 100) + " do preço de emissão das ações subscritas em dinheiro, no montante de " + h.reais(entrada) + " (" + h.extensoReais(entrada) + "), depositado " + (d.banco ? "no " + d.banco : "no Banco do Brasil S.A.") + ", em nome da companhia em organização, tendo sido lido o respectivo recibo de depósito, que instrui a presente ata (§ 1º do art. 87)."), h.JUST, h.SP15));
    out.push(h.P(h.R("Em seguida, foi lido, discutido e aprovado por unanimidade o projeto de Estatuto Social, que passa a fazer parte integrante desta ata, e os subscritores manifestaram, sem oposição, a vontade de constituir a companhia."), h.JUST, h.SP15));
    // ordem do § 2º do art. 87: verificadas as formalidades e sem oposição, declara-se constituída a companhia e SÓ ENTÃO se elegem os administradores
    out.push(h.P(h.R("Cumpridas as formalidades legais e não havendo oposição de subscritores, " + h.gsex(d.presMesa, "o Presidente", "a Presidente") + " declarou constituída a companhia " + d.denominacaoUP + ", com sede na " + d.sedeLinha + ", que tem por objeto: " + (d.objeto || "[OBJETO]") + " (§ 2º do art. 87 da Lei nº 6.404, de 1976)."), h.JUST, h.SP15));
    out.push(h.P(h.R("Passou-se, a seguir, à eleição da Diretoria, ficando " + h.gsex(d.diretores[0] || {}, "eleito", "eleita") + (d.diretores.length > 1 ? "s" : "") + ", por unanimidade, com mandato de " + h.numBR(d.mandato) + " (" + extInt(h, d.mandato) + ") anos: "
      + d.diretores.map(function (s) { return nomeUP(s) + ", devidamente acima " + h.gsex(s, "qualificado", "qualificada") + ", para o cargo de " + h.gsex(s, "Diretor", "Diretora") + " sem designação específica"; }).join("; e ")
      + ". Os eleitos tomam posse mediante termo lavrado em separado, com a declaração de desimpedimento exigida pelo § 1º do art. 147 da Lei nº 6.404, de 1976 (Anexo I). O Conselho Fiscal não foi instalado."), h.JUST, h.SP15));
    out.push(h.P([h.T("ENCERRAMENTO: ", { bold: true })].concat(h.R("Nada mais havendo a tratar, foram suspensos os trabalhos pelo tempo necessário à lavratura desta ata, que, lida e achada conforme, foi aprovada e assinada por todos os subscritores, " + h.gsex(d.presMesa, "pelo Presidente", "pela Presidente") + " e " + h.gsex(d.secMesa, "pelo Secretário", "pela Secretária") + " da mesa.")), h.JUST, h.SP15));
    out.push(h.P([h.T(d.cidadeUF + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
    assinatura(out, h, d.presMesa.nome, "Presidente da Mesa");
    assinatura(out, h, d.secMesa.nome, h.gsex(d.secMesa, "Secretário da Mesa", "Secretária da Mesa"));
    d.acionistas.forEach(function (s) { assinatura(out, h, s.nome, h.gsex(s, "Subscritor", "Subscritora") + (s.administrador ? " e " + h.gsex(s, "Diretor eleito", "Diretora eleita") : "")); });
    return out;
  }

  /* ---------- Anexo I: declaração de desimpedimento e termo de posse (um por diretor) ---------- */
  function anexoI(d, h, origem) {
    var out = [];
    var titulo = origem === "transformacao"
      ? "ANEXO I DA ATA DE ASSEMBLEIA DE CONSTITUIÇÃO POR TRANSFORMAÇÃO DE SOCIEDADE EMPRESÁRIA LIMITADA EM SOCIEDADE ANÔNIMA, DA " + d.razaoAnteriorUP + " LTDA, REALIZADA EM " + h.dataExtenso(d.data).toUpperCase()
      : "ANEXO I DA ATA DA ASSEMBLEIA GERAL DE CONSTITUIÇÃO DA " + d.denominacaoUP + ", REALIZADA EM " + h.dataExtenso(d.data).toUpperCase();
    out.push(titPagina(h, titulo));
    out.push(h.P([h.T(d.denominacaoUP + (d.cnpj ? " — CNPJ " + d.cnpj : ""), { bold: true })], h.CEN, h.SP10));
    out.push(h.P([h.T("Declaração de Desimpedimento e Termo de Posse da Diretoria eleita", { bold: true })], h.CEN, h.SP15));
    d.diretores.forEach(function (s) {
      var Dir = h.gsex(s, "O Diretor", "A Diretora"), dir = h.gsex(s, "Diretor", "Diretora");
      out.push(h.P(h.R("Em Assembleia " + (origem === "transformacao" ? "de Constituição por Transformação" : "Geral de Constituição") + " da " + d.denominacaoUP + ", realizada em " + h.dataExtenso(d.data) + ", às " + (d.hora || "[HORA]")
        + " horas, na sede da sociedade, localizada na " + d.sedeLinha + ", tomou posse " + h.gsex(s, "o senhor ", "a senhora ") + qual(h, s) + ", para o cargo de " + dir + "."), h.JUST, h.SP15));
      out.push(h.P(h.R("O prazo do mandato será de " + h.numBR(d.mandato) + " (" + extInt(h, d.mandato) + ") anos, iniciando-se em " + h.dataExtenso(d.data) + " e encerrando-se em " + h.dataExtenso(d.fimMandato) + ", permanecendo no cargo até a posse de " + h.gsex(s, "seu substituto", "sua substituta") + "."), h.JUST, h.SP15));
      out.push(h.P(h.R(Dir + " é " + h.gsex(s, "investido", "investida") + " em seu cargo a partir da assinatura do presente termo."), h.JUST, h.SP15));
      out.push(h.P(h.R(Dir + " " + h.gsex(s, "eleito", "eleita") + " declara, para os fins do § 2º do art. 149 da Lei nº 6.404, de 1976, que o endereço acima indicado é o domicílio onde receberá citações e intimações em processos administrativos e judiciais relativos aos atos de sua gestão."), h.JUST, h.SP15));
      out.push(h.P(h.R(Dir + " " + h.gsex(s, "eleito", "eleita") + " declara, sob as penas da lei, que não está " + h.gsex(s, "impedido", "impedida") + " por lei especial, nem " + h.gsex(s, "condenado", "condenada")
        + " a pena que vede, ainda que temporariamente, o acesso a cargos públicos; nem por crime falimentar, de prevaricação, peita ou suborno, concussão, peculato; nem contra a economia popular, contra o sistema financeiro nacional, contra as normas de defesa da concorrência, contra as relações de consumo, a fé pública ou a propriedade (§ 1º do art. 147 da Lei nº 6.404, de 1976)."), h.JUST, h.SP15));
      out.push(h.P(h.R("Por ser fiel expressão da verdade, firma o presente."), h.JUST, h.SP15));
      out.push(h.P([h.T(d.cidadeUF + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
      assinatura(out, h, s.nome, dir);
    });
    return out;
  }

  /* ---------- Anexo II: lista de subscrição de ações (art. 85 da Lei 6.404) ---------- */
  function anexoII(d, h, origem) {
    var out = [];
    var titulo = origem === "transformacao"
      ? "ANEXO II DA ATA DE ASSEMBLEIA DE CONSTITUIÇÃO POR TRANSFORMAÇÃO DE SOCIEDADE EMPRESÁRIA LIMITADA EM SOCIEDADE ANÔNIMA, DA " + d.razaoAnteriorUP + " LTDA, REALIZADA EM " + h.dataExtenso(d.data).toUpperCase()
      : "ANEXO II DA ATA DA ASSEMBLEIA GERAL DE CONSTITUIÇÃO DA " + d.denominacaoUP + ", REALIZADA EM " + h.dataExtenso(d.data).toUpperCase();
    out.push(titPagina(h, titulo));
    out.push(h.P([h.T(d.denominacaoUP + (d.cnpj ? " — CNPJ " + d.cnpj : ""), { bold: true })], h.CEN, h.SP10));
    out.push(h.P([h.T("LISTA DE SUBSCRIÇÃO DE AÇÕES", { bold: true })], h.CEN, h.SP15));
    d.acionistas.forEach(function (s, i) {
      var a = Number(s.quotas) || 0, v = a * d.valorAcao, e = v * d.entradaPct;
      out.push(h.P(h.R(qual(h, s) + ", subscrevendo o total de " + h.numBR(a) + " (" + extInt(h, a) + ") ações ordinárias nominativas, com valor nominal de " + h.reais(d.valorAcao) + " (" + h.extensoReais(d.valorAcao) + ") cada ação, no valor total de "
        + h.reais(v) + " (" + h.extensoReais(v) + ")" + (origem === "transformacao" ? ", integralizadas com o acervo da sociedade transformada" : ", com entrada de " + h.reais(e) + " (" + h.extensoReais(e) + ") em dinheiro") + (i < d.acionistas.length - 1 ? ";" : ".")), h.JUST, h.SP15));
    });
    out.push(h.P([h.T(d.cidadeUF + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
    d.acionistas.forEach(function (s) { assinatura(out, h, s.nome, h.gsex(s, "Subscritor", "Subscritora")); });
    if (origem !== "transformacao") {   // art. 95, II: a relação de subscritores vai autenticada pelo presidente da assembleia
      out.push(h.P(h.R("Relação de subscritores autenticada " + h.gsex(d.presMesa, "pelo Presidente", "pela Presidente") + " da Assembleia Geral de Constituição, nos termos do inciso II do art. 95 da Lei nº 6.404, de 1976."), h.JUST, h.SP15));
      assinatura(out, h, d.presMesa.nome, "Presidente da Assembleia");
    }
    return out;
  }

  /* ---------- 3a. Ata de AGE — transformação de S.A. em Ltda (modelo 03) ---------- */
  function ataTransfSaLtda(d, h) {
    var out = [];
    var plural = d.acionistas.length > 1;
    out.push(h.P([h.T("TRANSFORMAÇÃO DE SOCIEDADE ANÔNIMA EM SOCIEDADE EMPRESÁRIA LIMITADA", { bold: true })], h.CEN, h.SP10_0, true));
    out.push(h.P([h.T("ATA DA ASSEMBLEIA GERAL EXTRAORDINÁRIA", { bold: true })], h.CEN, h.SP10_0, true));
    out.push(h.P([h.T(d.razaoAnteriorUP + " S/A — CNPJ nº " + (d.cnpj || "[CNPJ]") + (d.nire ? " — NIRE " + d.nire : ""), { bold: true })], h.CEN, h.SP10));
    var item = function (n, tit, txt) { out.push(h.P([h.T(n + ". " + tit + ": ", { bold: true })].concat(h.R(txt)), h.JUST, h.SP15)); };
    item("1", "Data, hora e local", "Em " + h.dataExtenso(d.data) + ", às " + (d.hora || "[HORA]") + " horas, na sede da sociedade " + d.razaoAnteriorUP + " S/A, situada na " + d.sedeAnteriorLinha + ".");
    item("2", "Presença", (plural ? "Dos acionistas: " : "Do acionista: ") + d.acionistas.map(function (s) { return qual(h, s); }).join("; ") + ", representando a totalidade do capital social, conforme assinaturas apostas no Livro de Presença de Acionistas, dispensada a convocação prévia, nos termos do § 4º do art. 124 da Lei nº 6.404, de 1976.");
    item("3", "Mesa", "Presidente: " + nomeUP(d.presMesa) + ". " + h.gsex(d.secMesa, "Secretário", "Secretária") + ": " + nomeUP(d.secMesa) + ".");
    item("4", "Ordem do dia", "a) transformação da sociedade anônima de capital fechado em sociedade limitada, sob a denominação de “" + d.denominacaoUP + " LTDA”; b) conversão da totalidade das ações da sociedade em quotas sociais; c) aprovação do contrato social da sociedade; d) autorização para o sócio administrador praticar os atos necessários à formalização das deliberações tomadas.");
    item("5", "Deliberações", "Instalada a Assembleia e feita a leitura da ordem do dia, o Presidente da mesa iniciou as deliberações, como segue: a) aprovada por unanimidade a transformação da sociedade anônima de capital fechado em sociedade limitada, sob a denominação de “"
      + d.denominacaoUP + " LTDA”, nos termos dos arts. 220 a 222 da Lei nº 6.404, de 1976, e dos arts. 1.113 a 1.115 do Código Civil, independentemente de dissolução e liquidação, respondendo a sociedade transformada, para todos os fins e efeitos de direito, por todo o ativo e o passivo da sociedade anônima, que passa a ser regida pelo Código Civil e demais dispositivos aplicáveis; b) aprovada por unanimidade a conversão das "
      + h.numBR(d.numQuotas) + " (" + extInt(h, d.numQuotas) + ") ações nominativas representativas da totalidade do capital social, de " + h.reais(d.capital) + " (" + h.extensoReais(d.capital) + "), em " + h.numBR(d.numQuotas) + " (" + extInt(h, d.numQuotas) + ") quotas sociais, no valor nominal de "
      + h.reais(d.valorAcao) + " (" + h.extensoReais(d.valorAcao) + ") cada uma, atribuídas aos sócios na mesma proporção das ações que possuíam; c) aprovado por unanimidade o Contrato Social da sociedade, que faz parte integrante desta ata; d) aprovada por unanimidade a autorização para o sócio administrador praticar os atos necessários à formalização das deliberações tomadas.");
    item("6", "Encerramento", "Nada mais havendo a tratar, foi a presente ata lavrada em forma de sumário e, depois de lida, aprovada e assinada " + (plural ? "pelos acionistas presentes" : "pelo único acionista") + ", " + h.gsex(d.presMesa, "pelo Presidente", "pela Presidente") + " e " + h.gsex(d.secMesa, "pelo Secretário", "pela Secretária") + " da mesa.");
    out.push(h.P([h.T(d.cidadeUF + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
    assinatura(out, h, d.presMesa.nome, "Presidente da Mesa");
    assinatura(out, h, d.secMesa.nome, h.gsex(d.secMesa, "Secretário da Mesa", "Secretária da Mesa"));
    d.acionistas.forEach(function (s) { assinatura(out, h, s.nome, "Acionista"); });
    return out;
  }

  /* ---------- 3b. Contrato social por transformação de S.A. (modelo 03, preâmbulo corrigido) ---------- */
  function contratoTransfSaLtda(d, h) {
    var out = [];
    var plural = d.acionistas.length > 1;
    var adm = d.acionistas.filter(function (s) { return s.administrador; });
    var nomesAdm = adm.map(nomeUP).join(adm.length > 2 ? ", " : " e ");
    out.push(titPagina(h, "CONTRATO SOCIAL DE CONSTITUIÇÃO DE SOCIEDADE LIMITADA POR TRANSFORMAÇÃO DE SOCIEDADE ANÔNIMA"));
    out.push(h.P([h.T(d.denominacaoUP + " LTDA", { bold: true })], h.CEN, h.SP10));
    d.acionistas.forEach(function (s) { out.push(h.P(h.R(qual(h, s) + ";"), h.JUST, h.SP10)); });
    out.push(h.P(h.R((plural ? "únicos acionistas" : "único acionista") + " da sociedade anônima de capital fechado " + d.razaoAnteriorUP + " S/A, com sede na " + d.sedeAnteriorLinha + ", inscrita no CNPJ sob o nº " + (d.cnpj || "[CNPJ]") + (d.nire ? " e NIRE " + d.nire : "")
      + ", com estatuto social arquivado na " + d.junta + ", " + (plural ? "resolvem" : "resolve") + ", nos termos dos arts. 220 a 222 da Lei nº 6.404, de 1976, e dos arts. 1.113 a 1.115 do Código Civil, transformar a sociedade anônima em SOCIEDADE EMPRESÁRIA LIMITADA, que se regerá pelas cláusulas seguintes:"), h.JUST, h.SP15));
    var n = 0; var cl = function (txt) { out.push(h.P([h.T("Cláusula " + (++n) + "ª – ", { bold: true })].concat(h.R(txt)), h.JUST, h.SP15)); };
    cl("A sociedade girará sob o nome empresarial " + d.denominacaoUP + " LTDA e terá sede e domicílio na " + d.sedeLinha + ".");
    cl("O capital social será de " + h.reais(d.capital) + " (" + h.extensoReais(d.capital) + "), dividido em " + h.numBR(d.numQuotas) + " (" + extInt(h, d.numQuotas) + ") quotas de valor nominal " + h.reais(d.valorAcao) + " (" + h.extensoReais(d.valorAcao) + ") cada uma, totalmente integralizadas, resultantes da conversão das ações da sociedade transformada, distribuídas entre os sócios da seguinte forma:");
    out.push(tabelaAcoesComoQuotas(d, h));
    out.push(h.P([h.T("")], h.JUST, h.SP10_0));
    cl("O objeto social é o exercício das seguintes atividades econômicas: " + (d.objeto || "[OBJETO]") + ".");
    cl("A sociedade iniciou suas atividades em " + (d.dataInicioOrig || "[DATA DA CONSTITUIÇÃO DA S.A.]") + ", data da constituição da sociedade transformada, e seu prazo de duração é indeterminado.");
    cl("As quotas são indivisíveis e não poderão ser cedidas ou transferidas a terceiros sem o consentimento " + (plural ? "dos demais sócios, aos quais" : "do outro sócio, a quem") + " fica assegurado, em igualdade de condições e preço, direito de preferência para a sua aquisição se postas à venda, formalizando-se, se realizada a cessão delas, a alteração contratual pertinente.");
    cl("A responsabilidade de cada sócio é restrita ao valor de suas quotas, mas todos respondem solidariamente pela integralização do capital social, nos termos do art. 1.052 do Código Civil.");
    cl("A administração da sociedade será exercida " + (adm.length > 1 ? "pelos sócios " : h.gsex(adm[0] || {}, "pelo sócio ", "pela sócia ")) + (nomesAdm || "[ADMINISTRADOR]") + ", com os poderes e atribuições de " + (adm.length > 1 ? "administradores" : h.gsex(adm[0] || {}, "administrador", "administradora"))
      + ", autorizado o uso do nome empresarial, vedado, no entanto, em atividades estranhas ao interesse social ou assumir obrigações seja em favor de qualquer dos quotistas ou de terceiros, bem como onerar ou alienar bens imóveis da sociedade, sem autorização d" + (plural ? "os demais sócios" : "o outro sócio") + ".");
    cl("Ao término de cada exercício social, em 31 de dezembro, " + (adm.length > 1 ? "os administradores prestarão" : "o administrador prestará") + " contas justificadas de sua administração, procedendo à elaboração do inventário, do balanço patrimonial e do balanço de resultado econômico, cabendo aos sócios, na proporção de suas quotas, os lucros ou perdas apurados.");
    cl("Nos quatro meses seguintes ao término do exercício social, os sócios deliberarão sobre as contas e designarão administrador(es), quando for o caso.");
    cl("A sociedade poderá, a qualquer tempo, abrir ou fechar filial ou outra dependência, mediante alteração contratual assinada por todos os sócios.");
    cl("Os sócios poderão, de comum acordo, fixar uma retirada mensal, a título de “pro labore”, em favor do(s) sócio(s) administrador(es), observadas as disposições regulamentares pertinentes.");
    cl("Em caso de falecimento ou interdição de qualquer sócio, a sociedade continuará suas atividades com os herdeiros, sucessores e o incapaz. Não sendo possível ou inexistindo interesse destes ou dos sócios remanescentes, o valor de seus haveres será apurado e liquidado com base na situação patrimonial da sociedade, à data da resolução, verificada em balanço especialmente levantado.");
    cl((adm.length > 1 ? "Os administradores declaram" : h.gsex(adm[0] || {}, "O administrador declara", "A administradora declara")) + ", sob as penas da lei, que não " + (adm.length > 1 ? "estão impedidos" : h.gsex(adm[0] || {}, "está impedido", "está impedida"))
      + " de exercer a administração da sociedade, por lei especial, ou em virtude de condenação criminal, ou por se encontrar sob os efeitos dela, a pena que vede, ainda que temporariamente, o acesso a cargos públicos; ou por crime falimentar, de prevaricação, peita ou suborno, concussão, peculato, ou contra a economia popular, contra o sistema financeiro nacional, contra normas de defesa da concorrência, contra as relações de consumo, fé pública, ou a propriedade.");
    cl((plural ? "Os sócios declaram" : "O sócio declara") + (d.enquadramento === "DEMAIS" ? " que a sociedade não se enquadra como Microempresa (ME) nem como Empresa de Pequeno Porte (EPP), nos termos da Lei Complementar nº 123, de 14 de dezembro de 2006."
      : " que a sociedade se enquadra como " + d.enquadramentoNome + ", nos termos da Lei Complementar nº 123, de 14 de dezembro de 2006, e que não se enquadra em qualquer das hipóteses de exclusão relacionadas no § 4º do art. 3º da mencionada lei."));
    cl("Fica eleito o foro de " + (d.foro || d.cidade) + "/" + d.uf + " para o exercício e o cumprimento dos direitos e obrigações resultantes deste contrato, renunciando a qualquer outro, por mais privilegiado que seja.");
    out.push(h.P(h.R("E, por " + (plural ? "estarem assim justos e contratados, assinam" : "estar assim justo e contratado, assina") + " o presente instrumento particular em via única."), h.JUST, h.SP15));
    out.push(h.P([h.T(d.cidadeUF + ", " + h.dataExtenso(d.data))], h.CEN, h.SP15));
    d.acionistas.forEach(function (s) { assinatura(out, h, s.nome, s.administrador ? h.gsex(s, "Sócio/Administrador", "Sócia/Administradora") : h.gsex(s, "Sócio", "Sócia")); });
    return out;
  }
  function tabelaAcoesComoQuotas(d, h) {
    var X = h.X, TB = X.Table, TR = X.TableRow, TC = X.TableCell, WT = X.WidthType;
    var cel = function (t, al, bold) { return new TC({ children: [h.P([h.T(t, { bold: !!bold })], al || h.LEFT, h.SP10_0)] }); };
    var linhas = [new TR({ tableHeader: true, children: [cel("Sócio", h.LEFT, true), cel("Quotas", h.CEN, true), cel("Valor (R$)", h.CEN, true), cel("Percentual", h.CEN, true)] })];
    var totA = 0, totV = 0;
    d.acionistas.forEach(function (s) { var a = Number(s.quotas) || 0, v = a * d.valorAcao; totA += a; totV += v;
      linhas.push(new TR({ children: [cel(s.nome || "[NOME]"), cel(h.numBR(a), h.CEN), cel(h.reais(v), h.CEN), cel(h.pct(d.capital > 0 ? v / d.capital * 100 : 0), h.CEN)] })); });
    linhas.push(new TR({ children: [cel("TOTAL", h.LEFT, true), cel(h.numBR(totA), h.CEN, true), cel(h.reais(totV), h.CEN, true), cel(h.pct(d.capital > 0 ? totV / d.capital * 100 : 0), h.CEN, true)] }));
    return new TB({ width: { size: 100, type: WT.PERCENTAGE }, rows: linhas });
  }

  window.GeradorSA = { alteracaoTransfLtdaSa: alteracaoTransfLtdaSa, ataTransfLtdaSa: ataTransfLtdaSa, ataConstituicaoSa: ataConstituicaoSa, anexoI: anexoI, anexoII: anexoII, ataTransfSaLtda: ataTransfSaLtda, contratoTransfSaLtda: contratoTransfSaLtda };
})();
