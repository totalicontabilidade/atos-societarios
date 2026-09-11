/* ============================================================
   Atos Societários · Totali
   modelos-sa.js — ESTATUTO SOCIAL de sociedade anônima (capital
   fechado), a partir do modelo "Transformação de LTDA em S.A."
   publicado no portal da JUCESE, conferido contra a Lei nº
   6.404/1976 e o Manual de Registro de Sociedade Anônima (DREI),
   Cap. II, Seção I, item 15 (conteúdo obrigatório do estatuto).

   ATENÇÃO — ONDE ESTE ARQUIVO SE AFASTA DO MODELO, E POR QUÊ.
   O modelo do portal é um exemplo genérico, de outro estado, e traz
   três coisas que a Junta devolveria ou que a lei não permite:
     1. "ações ordinárias, AO PORTADOR" (art. 6º do modelo). Ações ao
        portador estão extintas desde a Lei nº 8.021/1990; a Lei
        6.404 (art. 20) só admite ações NOMINATIVAS, e o Manual (item
        15, VI) exige que o estatuto diga "forma nominativa". Aqui:
        nominativas.
     2. Exigência de DEPÓSITO DAS AÇÕES para participar da assembleia
        (arts. 17 e 18 do modelo). Era prática do tempo das ações ao
        portador; com ações nominativas a titularidade se prova pelo
        livro de registro, e condicionar a presença a um depósito
        esbarra no direito essencial de participar (art. 109 c/c art.
        126 da Lei 6.404). Retirados; a numeração segue sem eles.
     3. "Junta Comercial do Estado do Paraná" e "31 de dezembro de
        2023" (art. 24 do modelo): viraram campos.
   Todo o resto é o texto do modelo. Mudar redação: aqui, com o
   modelo e a lei ao lado.

   Estrutura igual à de modelos-coop.js: {cap,sub} / {art,txt,par,al}
   com {{campo}} e escolhas "opc". O mesmo renderizador serve.
   ============================================================ */
(function () {
  "use strict";

  var ESTATUTO = [
    { cap: "CAPÍTULO I", sub: "Da Denominação, Sede, Objeto e Duração" },
    { art: "1º", txt: "Sob a denominação de {{denominacao}}, fica constituída uma sociedade anônima, que se regerá por este Estatuto e, nos casos omissos, pelas disposições legais que lhe forem aplicáveis." },
    { art: "2º", txt: "A sociedade terá sua sede, domicílio e foro na cidade de {{cidade}}, Estado de {{estado}}, com endereço na {{sede}}, podendo, entretanto, abrir filiais, agências, depósitos e escritórios em qualquer parte do território nacional ou no exterior, onde for de seu interesse, a juízo exclusivo da Diretoria." },
    { art: "3º", txt: "Constitui objeto da sociedade: {{objeto}}." },
    { art: "4º", txt: "A duração da sociedade será por tempo indeterminado, cabendo à Assembleia Geral alterar sua constituição, modificar sua finalidade ou promover sua dissolução legal." },
    { art: "5º", txt: "A sociedade poderá participar de outras sociedades, comerciais ou industriais." },
    { cap: "CAPÍTULO II", sub: "Do Capital e das Ações" },
    /* {{subscricao}} = "totalmente subscrito e integralizado" (transformação, ou constituição com 100% de entrada) ou só
       "totalmente subscrito" (constituição com entrada parcial — aí entra o § 5º: art. 80, II, e art. 106). */
    { art: "6º", txt: "O capital social é de {{capital}} ({{capitalExt}}), {{subscricao}}, dividido em {{nAcoes}} ({{nAcoesExt}}) ações ordinárias, nominativas, com valor nominal de {{valorAcao}} ({{valorAcaoExt}}) cada uma.",
      par: ["§ 1º O capital social poderá ser aumentado sempre que a Assembleia Geral o julgue conveniente, e da seguinte forma: a) pela emissão de novas ações, subscritas mediante pagamento; b) pelo aumento do valor nominal das ações existentes, resultante quer da incorporação de bens, quer da aplicação de reservas, quer ainda de quaisquer outros meios, a juízo da Assembleia Geral.",
            "§ 2º Na hipótese de aumento de capital, os acionistas terão o prazo de 30 (trinta) dias, a contar da data da assembleia que deliberou o aumento, para o exercício de seu direito de preferência para subscrição de ações.",
            "§ 3º Na hipótese de desistência expressa desse direito, ou após a decorrência do prazo previsto no § 2º, a preferência para subscrição das ações correspondentes será transferida aos demais acionistas, observada a proporcionalidade do capital subscrito.",
            "§ 4º As ações, ou eventualmente suas cautelas representativas, serão assinadas por dois Diretores.",
            { opc: "integralizacao", quando: "parcial", txt: "§ 5º Do preço de emissão das ações subscritas, {{entradaPct}} foram realizados em dinheiro no ato da subscrição, na forma do inciso II do art. 80 da Lei nº 6.404, de 1976; o restante será integralizado em moeda corrente do País pelos subscritores, nas condições constantes da lista de subscrição ou, se omissa, mediante chamada da Diretoria, na forma do art. 106 da mesma lei." }] },
    { art: "7º", txt: "Cada ação dará direito a um voto nas deliberações sociais." },
    { art: "8º", txt: "As ações serão indivisíveis perante a sociedade, que não lhes reconhecerá mais que um proprietário para cada unidade." },
    { cap: "CAPÍTULO III", sub: "Da Administração da Sociedade" },
    { art: "9º", txt: "A sociedade será administrada por uma Diretoria composta de {{nDiretores}} ({{nDiretoresExt}}) membros, acionistas ou não, residentes no País, designados Diretores.",
      par: ["§ 1º Os Diretores serão eleitos por maioria de votos em Assembleia Geral, com mandato de {{mandato}} ({{mandatoExt}}) anos, podendo ser reeleitos.",
            "§ 2º Considerar-se-á vago o cargo de Diretor que não tome posse dentro de 30 (trinta) dias a contar da data da publicação da ata da Assembleia Geral que o elegeu.",
            "§ 3º No caso de vaga ou impedimento definitivo do cargo de qualquer dos Diretores, a sua substituição se fará por nova eleição da Assembleia Geral que, para isso, será convocada.",
            "§ 4º O Diretor substituto que for eleito completará o mandato do Diretor substituído."] },
    { art: "10", txt: "Os Diretores, individualmente ou em conjunto, poderão praticar todos e quaisquer atos, por mais importantes que sejam, ainda que envolvam responsabilidade direta ou indireta da sociedade, representando-a sempre, em juízo ou fora dele, com a máxima autonomia e independência.",
      par: ["§ 1º Para alienar, onerar ou gravar bens imóveis, necessário se torna o consentimento expresso dos acionistas, outorgado em assembleia especificamente convocada para esse fim.",
            "§ 2º Cada Diretor fica investido dos poderes necessários à prática dos atos e operações relativos aos fins da sociedade, podendo representá-la em juízo ou fora dele.",
            "§ 3º A Diretoria poderá, a qualquer tempo, nomear um ou mais procuradores para fins específicos."] },
    { art: "11", txt: "A Diretoria proporá às Assembleias Gerais a forma de distribuição dos dividendos e lucros da sociedade.",
      par: ["Parágrafo único. A Diretoria reunir-se-á sempre que convocada por qualquer dos Diretores, e suas resoluções constarão do Livro de Atas das Reuniões da Diretoria."] },
    { art: "12", txt: "A Diretoria fica dispensada de caução no exercício de suas funções.",
      par: ["§ 1º O mandato dos Diretores vigorará da data em que eleitos e empossados até a data da assembleia que eleger seus sucessores, permanecendo em seus cargos até que estes sejam eleitos e empossados.",
            "§ 2º Os Diretores serão investidos mediante termo de posse lavrado no Livro de Atas das Reuniões da Diretoria.",
            "§ 3º Quando se vagar mais de um cargo da Diretoria, deverá ser convocada uma Assembleia Geral Extraordinária para eleição dos novos titulares até o término do mandato em curso.",
            "§ 4º O quorum mínimo para deliberações da Diretoria é de 2 (dois) Diretores.",
            "§ 5º Ao Diretor que estiver impedido, ocasionalmente, de comparecer às reuniões da Diretoria, será dado prévio conhecimento do assunto a ser debatido, sendo facultado o voto por escrito, que será transcrito na ata."] },
    { art: "13", txt: "Os Diretores perceberão honorários de conformidade com as normas fixadas na legislação vigente e nos limites fixados pela Assembleia Geral." },
    { cap: "CAPÍTULO IV", sub: "Do Conselho Fiscal" },
    { art: "14", txt: "A sociedade não tem Conselho Fiscal em funcionamento permanente; quando instalado pela Assembleia Geral, na forma da lei, será composto de 3 (três) a 5 (cinco) membros efetivos e suplentes em igual número, com as funções e atribuições previstas na lei, eleitos pela Assembleia Geral, que fixará seus honorários." },
    { art: "15", txt: "O Conselho Fiscal, quando instalado, terá as atribuições e poderes que a lei lhe confere." },
    { cap: "CAPÍTULO V", sub: "Da Assembleia Geral" },
    { art: "16", txt: "Nos quatro primeiros meses após o término do exercício social, reunir-se-á a Assembleia Geral Ordinária; as extraordinárias realizar-se-ão nas épocas e datas julgadas convenientes aos interesses da sociedade e sempre que convocadas na forma da lei.",
      par: ["Parágrafo único. As Assembleias Gerais, ordinárias ou extraordinárias, serão presididas por qualquer dos acionistas presentes, escolhido por aclamação."] },
    { art: "17", txt: "Ressalvadas as exceções previstas em lei, a Assembleia Geral instalar-se-á, em primeira convocação, com a presença de acionistas que representem, no mínimo, 1/4 (um quarto) do capital social com direito a voto; em segunda convocação, instalar-se-á com qualquer número.",
      par: ["Parágrafo único. A Assembleia Geral, após instalada, elegerá o secretário que, juntamente com o presidente aclamado, formará a mesa; a seguir, iniciar-se-ão os trabalhos, respeitada a ordem do dia."] },
    { cap: "CAPÍTULO VI", sub: "Dos Fundos Sociais e dos Dividendos" },
    { art: "18", txt: "O exercício social coincidirá com o ano civil, terminando a 31 (trinta e um) de dezembro de cada ano, quando serão levantados o balanço geral e o inventário, com observância das prescrições legais.",
      par: ["§ 1º A sociedade poderá levantar balanços semestrais ou em qualquer outra época do ano, e a Diretoria poderá, em qualquer tempo, sugerir a antecipação, pela forma que julgar conveniente, da distribuição de dividendos intermediários, em função dos balanços levantados, subordinando-se essa medida à aprovação posterior da Assembleia Geral.",
            "§ 2º Dividendos intermediários deverão sempre ser creditados e considerados como antecipação de dividendos obrigatórios.",
            "§ 3º Os balanços poderão ser certificados por peritos ou sociedade revisora de reconhecida idoneidade, podendo a revisão ter caráter permanente e ficando a Diretoria autorizada a instituí-la e mantê-la."] },
    { art: "19", txt: "Os lucros líquidos apurados, após as amortizações e depreciações usuais permitidas em lei, terão a seguinte aplicação:",
      al: ["5% (cinco por cento) para constituição do fundo de reserva legal, destinado a assegurar a integridade do capital social, até o limite de 20% (vinte por cento) do mesmo, quando deixará de ser obrigatório;",
           "o restante será distribuído como dividendo aos acionistas; todavia, a Assembleia Geral poderá destinar parte desse restante a outras reservas, gratificações, aquisições de móveis, imóveis, ou qualquer outra finalidade julgada de interesse para a sociedade, observado o dividendo obrigatório previsto em lei."] },
    { art: "20", txt: "Os dividendos poderão ser distribuídos, a critério da Diretoria, em duas prestações, dentro, porém, do exercício em que for aprovado o balanço geral pela Assembleia Geral." },
    { art: "21", txt: "Os dividendos não reclamados não vencerão juros e, no prazo de 3 (três) anos, contado da data em que tenham sido postos à disposição do acionista, prescreverão em benefício da sociedade." },
    { cap: "CAPÍTULO VII", sub: "Das Disposições Gerais e Transitórias" },
    { opc: "origem", quando: "transformacao", art: "22", txt: "O primeiro exercício social começará na data do arquivamento deste Estatuto na {{junta}}, retroagindo à data de constituição da sociedade que ora se transforma em sociedade anônima, continuando sua escrituração nos mesmos livros e abrangendo o primeiro exercício as operações realizadas até 31 (trinta e um) de dezembro de {{anoExercicio}}." },
    { opc: "origem", quando: "constituicao", art: "22", txt: "O primeiro exercício social começará na data do arquivamento deste Estatuto na {{junta}} e terminará em 31 (trinta e um) de dezembro de {{anoExercicio}}." },
    { art: "23", txt: "Quaisquer despesas com viagens de negócios ou estudos, realizadas pelos Diretores, quer pelo território nacional, quer pelo exterior, serão debitadas em conta especial, tornando-se de responsabilidade da sociedade." },
    { art: "24", txt: "A sociedade entrará em liquidação nos casos previstos em lei, competindo à Assembleia Geral eleger o liquidante e o Conselho Fiscal que deverá funcionar no período da liquidação, e determinar sua remuneração." },
    { art: "25", txt: "Os casos omissos serão regulados pela Lei nº 6.404, de 15 de dezembro de 1976, e legislação posterior." }
  ];

  /* Onde a lei manda e o modelo cala, para a validação e para quem for revisar:
       • art. 80 da Lei 6.404: subscrição por pelo menos 2 pessoas; entrada de 10%, no mínimo, do
         preço de emissão das ações subscritas em dinheiro; depósito no Banco do Brasil ou outro
         estabelecimento autorizado (art. 80, III);
       • art. 143: Diretoria com 2 ou mais membros, mandato de até 3 anos;
       • art. 161: Conselho Fiscal de 3 a 5 membros e suplentes em igual número;
       • art. 289: publicações; art. 294: companhia fechada com menos de 20 acionistas e patrimônio
         líquido inferior ao limite legal pode dispensar publicações, se o estatuto assim dispuser. */
  window.MODELOS_SA = {
    estatuto: { titulo: "ESTATUTO SOCIAL", blocos: ESTATUTO },
    lei: "Lei nº 6.404, de 15 de dezembro de 1976",
    minAcionistas: 2, minDiretores: 2, maxMandato: 3, entradaMinima: 0.10
  };
})();
