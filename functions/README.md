# Robô do WhatsApp dos Atos Societários

Atende, só no grupo do robô (WhatsApp do escritório), pedidos de abertura e alteração de empresa, pergunta o que falta num
**diálogo guiado sem IA** (perguntas numeradas, validação de CPF/CNPJ/CEP/data por código) e
grava a solicitação no Atos, com os documentos em anexo. Custo zero dentro das cotas gratuitas.

```
WhatsApp do escritório ──► Evolution API v2.3.7 (VPS Magalu, container atos_whatsapp, instância "atos")
                 │ webhook HTTPS + token
                 ▼
         Cloud Function whatsappWebhook (southamerica-east1, Node 22, https://whatsappwebhook-dvjo4cygzq-rj.a.run.app)
                 │ dialogo.js (estado em Firestore: conversas/{chat})
                 ├─► Firestore: solicitacoes (origem "whatsapp"), vinculos, whatsapp_eventos
                 ├─► Storage: whatsapp/{chat}/{arquivo}  (CPF, RG, contratos: ficam no Brasil)
                 └─► Hub (Apps Script), com o endereço e o segredo de solicitacoes/__integracao
```

## Peças

| Onde | O quê |
|---|---|
| `functions/index.js` | webhook (token, de-duplicação, mídia → Storage, resposta pela Evolution), `vincular`, gravação da solicitação, aviso ao Hub, relógio de cada minuto (envio por falta de resposta) e faxina diária |
| `functions/dialogo.js` | catálogo de fluxos (abrir, alterar, fechar, transformar, advocacia, outro), validações, resumo, correção, comandos (*voltar*, *resumo*, *menu*, *cancelar*) |
| `functions/portaria.js` | decide antes de gravar: só o grupo ativado é atendido; privado e outros grupos são descartados |
| `functions/parser.js` | tradução do evento da Evolution (copiado do TotaliFinance, adaptado ao privado) |
| `functions/painel.js` | rota `/painel` da aba Configurações › WhatsApp: estado e QR, só para administrador logado |
| `functions/evolution.js` | `sendText`, `getBase64FromMediaMessage` (com a mensagem **inteira**: a instância não guarda mensagens, e só com a chave a Evolution responde *Message not found*), `fetchInstances` |
| `functions/test/` | `node --test` — o diálogo conversado de ponta a ponta, sem rede |
| VPS `~/atos-whatsapp/` | `docker-compose.yml` (Evolution + Postgres próprios) e `.env` (segredos) |
| App | etapa 1: **Gerar código para o grupo** (`vincular`); Configurações › WhatsApp (administrador): QR code e **código de ativação** do grupo (`#ativar-atos`), em `codigos_vinculo/{código}` (10 min) |

## Como funciona (v1.73: só no grupo do robô)

O número conectado à instância `atos` é o **WhatsApp do escritório**. Chegam ao webhook as mensagens
de todos os clientes, e a `portaria.js` descarta tudo o que não é do grupo do robô **antes de gravar
qualquer coisa** e sem responder nada. A função `responder` tem uma segunda trava: não manda mensagem
para fora do grupo ativado, mesmo que outra parte do código erre.

- **Privado:** sempre ignorado. Cliente que escreve no privado do escritório não recebe nada do robô.
- **Outros grupos:** ignorados. A única coisa examinada neles é o código de ativação.
- **Ativar o grupo:** um **administrador** gera, em Configurações › WhatsApp, o código de ativação
  (10 minutos, uso único) e manda `#ativar-atos 123456` dentro do grupo escolhido. A função confere
  que quem gerou é administrador ativo e grava o grupo em `solicitacoes/__whatsapp`
  (`grupoJid`, `grupoNome`). Código inválido, vencido ou de não administrador não recebe resposta.
  Ativar outro grupo troca o grupo: o anterior deixa de ser atendido.
- **No grupo do robô:** qualquer participante conversa com o diálogo guiado. A conversa do grupo é
  uma só: duas pessoas respondendo ao mesmo tempo se misturam. No fim, nasce uma solicitação `nova`
  (`abertaPor: "whatsapp"`) e o Hub recebe o aviso.
- **Processo já aberto:** na etapa 1, "Gerar código para o grupo" e mandar `vincular 123456` no grupo
  do robô. As respostas completam aquela solicitação.
- **Mensagens do próprio número** (do celular do escritório ou do robô) são ignoradas: quem conversa
  no grupo precisa usar outro número.
- **Quem conversa é a equipe** (comercial e legalização), não o cliente (v1.75). Cada pedido começa pela
  **documentação** (em alteração, fechamento e transformação, logo depois do CNPJ). Os dados que já estão nos
  documentos (nascimento, endereço residencial) não são perguntados. No fim, nome e telefone do cliente
  (opcionais) e quem fez o pedido (nome no WhatsApp) vão para a solicitação.
- **Arquivos:** só foto, PDF e Word. Vídeo e outros formatos são recusados com aviso, antes de
  baixar; acima de 25 MB também. Para baixar, a função manda à Evolution a **mensagem inteira** do
  webhook (a instância não guarda mensagens; só com a chave a Evolution responde *Message not found*). O robô entende o que é cada arquivo pela **legenda** (ex.: *RG do João*),
  pelo **nome do arquivo** (ex.: `contrato_social.pdf`) ou por uma **mensagem escrita** na documentação:
  escrita depois de arquivos sem legenda, vale para eles; escrita antes, vale para os próximos. O que
  não der para saber, ele pergunta no fim da documentação (lista de 11 tipos, inclusive "mandei por
  engano", que apaga o arquivo). Arquivo fora da documentação com legenda clara é guardado direto;
  sem legenda, o robô pergunta. Depois do pedido enviado, é **juntado à solicitação** já criada.
- **Fotos em lote:** a conversa é lida e gravada numa transação do Firestore, para que várias fotos
  chegando ao mesmo tempo não se apaguem umas às outras.
- **Mensagens mandadas juntas** (um PDF e duas mensagens, um lote de fotos) passam por uma fila por
  conversa (`conversas_fila/{chat}`): cada uma é tratada na ordem em que foi mandada no WhatsApp (o PDF
  demora mais para baixar e não é ultrapassado pelo texto), e quem termina por último manda **uma
  resposta só**, com os avisos de todas e a pergunta que vale no fim (`dialogo.receber` devolve
  `avisos` e `pergunta`; `dialogo.mensagemAtual` diz a pergunta de agora). Uma mensagem travada sai
  da fila em 90 s.
- **Texto livre:** sem pedido escolhido, uma frase como *alteração do nome da empresa* já abre o
  pedido certo (estatuto, ata e eleição vão para *Outro assunto*); frase que não responde à pergunta
  (sem número numa pergunta de CNPJ, data etc., ou sem tipo de documento na documentação) vira
  **anotação**, que aparece no resumo e vai na observação da solicitação.
- **Enviar com o que tem:** o comando *enviar* (também *pode enviar*, *enviar assim*) manda o pedido
  na hora, em qualquer pergunta, com o resumo na mesma mensagem; o que ficou sem resposta vai listado na
  solicitação ("ver nos documentos"). A dica aparece nas perguntas quando já há algo para mandar. As
  perguntas do fim são **uma só** (contato, telefone, prazo e observação numa mensagem: telefone e data
  são tirados do texto). "Consta no documento" numa pergunta de CNPJ/número vira anotação e segue. Na
  alteração, o que muda dito na mensagem (*altere a denominação social*) não é perguntado. Arquivo
  mandado antes de escolher o pedido já entra na documentação dele.
- **Aviso ao Hub:** todo pedido criado pelo robô vira pendência no Hub, no **mesmo formato** do
  `js/integracao.js` do app (`{ evento, segredo, solicitacao: {...} }`; teste em `test/hub.test.js`). A
  resposta do recebedor é lida (ele responde 200 até quando recusa); o resultado fica em
  `solicitacoes/{id}.hubAviso`, e o que não entrou é reenviado a cada pedido novo e na faxina diária
  (até 10 tentativas).
- **Áudio** (até 2 minutos): é baixado, transcrito pelo **Whisper** da própria VPS (container
  `atos_transcricao`, imagem `onerahmet/openai-whisper-asr-webservice:v1.10.0`, modelo *small* em CPU,
  limitado a 1,5 CPU e 2 GB) e segue como texto. O robô mostra *🎤 Entendi: …* antes. O áudio não é
  gravado em lugar nenhum (nem Storage, nem VPS). A rota é `https://atos-wa…/transcrever/asr`, com
  senha (usuário `atos` + a API key da Evolution); sem senha, 401. Número ditado pode perder dígitos:
  a validação de CPF/CNPJ recusa e o robô pede de novo.
- **Cancelar / recomeçar** um pedido não enviado apaga do Storage os arquivos dele.
- **Apagar anexo:** tirar um anexo do WhatsApp da solicitação apaga o arquivo do Storage (a regra
  deixa a equipe apagar em `whatsapp/`, nunca gravar).
- Um pedido novo no mesmo grupo, depois de um enviado, começa limpo: não herda empresa nem processo.
- Figurinhas e reações são ignoradas.
- **Sem atendimento humano pelo robô:** o grupo é interno (comercial e legalização), não tem cliente. Não existe o comando *equipe* nem a opção *0* (tirados na v1.75).
- **Comentário** (18/11/2026): *comentário: o cliente tem pressa* (ou *comentário* sozinho e o texto na
  mensagem seguinte) entra na **conversa da solicitação no Atos** (campo `respostas`, o mesmo das respostas
  do comercial, marcado como novo) e vira **comentário na pendência do Hub** (evento
  `solicitacao.comentario` do `receber.gs`, com o nome de quem escreveu). Não muda as respostas do pedido.
  Sem pedido enviado ainda, fica guardado na conversa e vai junto no envio. O que o Hub não recebeu fica em
  `comentarios_hub/{id}` e é reenviado no próximo pedido e na faxina (até 10 vezes; recebedor antigo responde
  `ignorado`, e isso conta como não entregue). Legenda de arquivo nunca é comentário.
- **Mensagem encaminhada** (18/11/2026): texto encaminhado (em geral do cliente; `contextInfo.isForwarded`,
  que na Evolution 2.3.7 vem no nível de `data`) não responde pergunta: vira comentário marcado
  "↪️ Mensagem encaminhada", com o nome de quem encaminhou. Com o pedido já enviado, frase solta (3+ palavras)
  também vira comentário nele.
- **Recuperar mensagens:** o robô não guarda o texto das mensagens, mas o log da Evolution guarda o que
  chega (`docker logs --since … atos_whatsapp` na Magalu, com `pushName`, `conversation`, `isForwarded`,
  `messageTimestamp`). Foi assim que as mensagens perdidas em 18/11/2026 voltaram para as solicitações.
- **Pausa** (18/11/2026): *pausar* cala o robô para a equipe conversar no grupo; *ativar* volta na hora.
  Cada mensagem durante a pausa estica mais 5 minutos; depois de 5 minutos sem mensagem, a primeira que
  chegar já é atendida (com o aviso "a pausa acabou"). Não há relógio: a pausa vencida só é notada na
  mensagem seguinte. Na pausa nada é baixado, transcrito, gravado nem respondido (arquivo mandado nela
  precisa ser mandado de novo). A marca fica em `conversas/{chat}.pausaAte` (milissegundos). Mensagem do
  próprio número do escritório não estica a pausa (o robô ignora essas mensagens).
- **Quem fez o pedido** (18/11/2026): é quem começou a conversa do pedido, não quem mandou a última
  mensagem; os outros que participaram vão como "(com …)". A **descrição** escrita pela equipe (anotações,
  "Descreva o pedido") abre a observação e o texto do pedido, com 📝. Texto escrito enquanto o robô pergunta
  o tipo de um arquivo não é mais descartado: vira anotação, ou escolhe o pedido se descrever um.

- **Pedido novo depois de um enviado** (23/11/2026): o Raoni mandou 5 fotos, 4 mensagens encaminhadas do
  cliente e "Constituição", e o robô, ainda preso ao pedido enviado em 18/11 (baixa de uma filial), pôs as
  mensagens como comentário *nele* e respondeu "este pedido já foi enviado". Regras dele, do mesmo dia
  (`dialogo.js`, seção "pedido novo"). É **pedido novo**:
  - **tudo o que chega depois de um pedido enviado** (*enviar*, confirmação ou envio sozinho): texto,
    arquivo, mensagem encaminhada. Não abrem: *comentário …*, comandos, número solto e cortesia
    (*obrigado*, *ok*, 👍, que o robô ignora). O *enviar* manda arquivo sem tipo como "Não identificado" e não
    pergunta mais nada, justamente para o que vier depois ser do pedido novo;
  - **o que chega depois de 20 minutos sem mensagem**, com um pedido em andamento: o de antes vai do jeito
    que estava (`criarAnterior`, gravado pelo `efetuar`) e a mensagem já entra no novo. Comandos (*enviar*…)
    continuam sendo do pedido em andamento;
  - **o nome de outro ato no meio de um pedido** (texto de até 5 palavras que *começa* com constituição,
    abertura, alteração, baixa, distrato, transformação, advocacia…): sem nada solto antes, troca direto (o
    de antes vai como está); com arquivos, anotações ou encaminhadas depois da última resposta (`ultimas`,
    as 12 últimas mensagens e o que cada uma virou), o robô **pergunta a partir de qual mensagem** é o pedido
    novo (lista numerada + "só a partir desta" + "não é pedido novo"). O mesmo ato do pedido em andamento
    sempre pergunta. Pedido escolhido sem nada respondido só troca o tipo.
  **Comentário** (*comentário: …*, ou *comentário* e depois o texto ou o **arquivo**): com mais de um pedido
  possível — o em andamento e os enviados por esta conversa nos últimos 3 dias (`pedidosRecentes`, até 5,
  gravados pelo `lembrarPedido`) — o robô **pergunta para qual vai**. Resposta que não é número: vai para a
  1ª opção (o em andamento) e a mensagem segue normal. Comentário para outro pedido sai em `comentarEm`;
  arquivo, em `anexarOutros`. Arquivo sem tipo que sobrou do pedido enviado vai para ele como "Não
  identificado". O número do anterior fica em `solicAnterior`.
- **Recado: pedido que não é ato** (23/11/2026). Caso de 18/11: o Raoni mandou a foto de um ponto e um áudio
  pedindo para ver na prefeitura se dava para abrir CNPJ ali; virou comentário do pedido da ITN. Decisão
  dele: **o Atos é só para atos** — recado vira **só uma pendência própria no Hub**, e no Atos não fica nada
  (nem solicitação, nem lista, nem o arquivo, que é apagado do Storage). Entra por *recado: …* (ou *recado*
  e depois o texto, o áudio ou o arquivo), pela opção 7 do menu, ou quando, sem pedido escolhido, a frase
  fala de consulta, prefeitura, viabilidade, alvará, certidão, licença… (`pareceRecado`): aí o robô pergunta
  *1 — recado · 2 — ato*. Sem resposta (ou no envio sozinho), fica como recado. Sem pedido escolhido, o
  recado leva o que estava solto (arquivos, anotações, encaminhadas); com pedido em andamento, não mexe nele.
  A pendência (`hubDoRecado`) usa o mesmo evento `solicitacao.criada`, com id `R…` e título
  "📌 Recado do grupo (não é ato) — de Fulano"; os arquivos aparecem listados ("no grupo do WhatsApp").
  Quem resolve é o Hub (riscar a pendência). Se o Hub não receber, o robô avisa para mandar de novo: não há
  fila de recados, para nada ficar guardado no Atos.
- **Envio sozinho por falta de resposta** (23/11/2026): pedido em andamento, com arquivo, sem mensagem há
  **10 minutos**: o robô avisa no grupo que envia em 1 minuto; sem mensagem nova nesse minuto, envia do jeito
  que está (como o *enviar*), com os arquivos sem tipo como "Não identificado", e diz no grupo. Mensagem
  depois do aviso recomeça a contagem. Pausa, cancelamento por confirmar e pedido sem arquivo não disparam.
  Sem pedido escolhido, o tipo sai das anotações e encaminhadas, ou vira *Outro assunto*. Pergunta do robô
  sem resposta vale a opção mais provável: o comentário vai para o pedido em andamento; "a partir de qual
  mensagem" envia o de antes e deixa o novo aberto (só "é o mesmo ato" conta como não novo). Quem conta o tempo
  é o agendamento `faxinaWhatsapp`, que agora bate **a cada minuto** (a faxina em si continua às 03:20):
  um agendamento só, porque o Cloud Scheduler dá 3 de graça por conta de cobrança. Lê só a conversa do grupo
  do robô (2 leituras por minuto). Marcas: `autoAvisoEm`, `autoEnviadoEm`. As mensagens encaminhadas também
  entram na observação da solicitação, e "Nome da empresa: X" escrito ou encaminhado vira o nome do cartão.

## Operação

```bash
# testes do diálogo
cd functions && npm test

# segredos (uma vez; os valores estão em %USERPROFILE%\.atos-whatsapp\segredos.env na máquina do Raoni)
firebase functions:secrets:set WHATSAPP_API_KEY --data-file caminho/da/chave.txt
firebase functions:secrets:set WHATSAPP_WEBHOOK_TOKEN --data-file caminho/do/token.txt

# publicar: regras PRIMEIRO, depois a função (campo novo gravado pela tela exige regra antes do JS)
firebase deploy --only firestore:rules,storage
firebase deploy --only functions

# logs
firebase functions:log --only whatsappWebhook
```

Na VPS (`ssh totali`, pelo PowerShell do Windows):

```bash
cd ~/atos-whatsapp && docker compose ps
docker logs --tail 50 atos_whatsapp
# QR code para conectar o chip (a resposta traz "base64" com a imagem):
docker exec atos_whatsapp sh -c 'curl -s -H "apikey: $AUTHENTICATION_API_KEY" http://localhost:8080/instance/connect/atos'
# webhook da instância (depois do deploy; TOKEN = WHATSAPP_WEBHOOK_TOKEN):
docker exec atos_whatsapp sh -c 'curl -s -X POST -H "apikey: $AUTHENTICATION_API_KEY" -H "content-type: application/json" \
  http://localhost:8080/webhook/set/atos -d "{\"webhook\":{\"enabled\":true,\"url\":\"https://southamerica-east1-atos-societarios.cloudfunctions.net/whatsappWebhook\",\"byEvents\":false,\"base64\":false,\"headers\":{\"authorization\":\"Bearer TOKEN\"},\"events\":[\"MESSAGES_UPSERT\",\"CONNECTION_UPDATE\"]}}"'
```

Endereço público da Evolution: `https://atos-wa.totalicontabilidade.com.br` (registro A no Cloudflare →
201.54.20.97, proxied; certificado pelo Traefik/Let's Encrypt). A Cloud Function só precisa dele
para **responder** e **baixar mídia**; o webhook é a Evolution chamando a função.

## Acesso público do webhook (organização com domínio restrito)

A organização Google da Totali tem a política **Compartilhamento restrito de domínio**
(`iam.allowedPolicyMemberDomains`): só contas do Workspace podem receber papéis. Por isso o deploy
não consegue dar o papel de invocador a `allUsers`, e a Evolution (que não tem conta Google) leva 403.

Solução que não mexe na política da organização: no Cloud Run, só no serviço `whatsappwebhook`,
**desligar a verificação de IAM do invocador** (Cloud Run → whatsappwebhook → Segurança →
"Permitir acesso público"). A proteção continua sendo o token do webhook. Se um dia o serviço for
recriado do zero (excluir e publicar de novo), repita esse passo.

Teste rápido: sem o cabeçalho `authorization` a função tem de responder **401 da própria função**
(JSON `{"ok":false,"erro":"token do webhook inválido"}`), não 403 do Google.

## Contas de serviço desta organização

- **Build:** a conta de computação padrão (`127923457771-compute@…`) tem só o papel
  *Conta de serviço do Cloud Build* (concedido em 10/11/2026); a organização não dá papéis
  automáticos a ela.
- **Execução:** as funções rodam como `firebase-adminsdk-fbsvc@atos-societarios.iam.gserviceaccount.com`
  (`serviceAccount` em `setGlobalOptions`), que já tem Firestore (Admin SDK) e Storage. O deploy dá a
  ela acesso aos dois segredos.
- **Runtime:** Node.js 22 (o 20 foi desativado em 30/10/2026).

## Conectar o WhatsApp do escritório e escolher o grupo (dentro do Atos)

**☰ › Configurações › WhatsApp** (a aba só aparece para administrador):
- **Mostrar QR code:** a tela pede o QR à função (rota `/painel`, com o token do login do Atos); a
  função confere em `/equipe` que é administrador ativo e só ela usa a chave da Evolution. O QR se
  renova a cada 25 s e a tela confere a conexão a cada 5 s, por até 5 minutos.
- **Gerar código de ativação:** `#ativar-atos CÓDIGO`, para mandar no grupo escolhido de um celular
  pessoal (o robô ignora o que sai do número do escritório).

A rota `/painel` responde CORS só para o site publicado e para as portas locais 9120/9121. O script
`%USERPROFILE%\.atos-whatsapp\conectar-whatsapp-atos.ps1` continua funcionando como reserva.

## Dados e LGPD

- A Evolution **não guarda mensagens** (`DATABASE_SAVE_DATA_NEW_MESSAGE=false`); só a sessão.
- De mensagens de fora do grupo do robô nada é gravado. `whatsapp_eventos` (de-duplicação, só do grupo) é apagado após 30 dias; códigos vencidos após 1 dia (faxina 03:20).
- Conversa, respostas e anexos ficam no Firestore e no Storage do projeto `atos-societarios`.
- Nenhum dado de cliente vai para modelo de linguagem de terceiros.

## Erros conhecidos e o que fazer

| Sintoma | Causa provável | Ação |
|---|---|---|
| Função responde 401 | token do webhook diferente do secret | `firebase functions:secrets:set WHATSAPP_WEBHOOK_TOKEN` e `webhook/set` de novo |
| Robô não responde, logs "sem resposta da Evolution" | DNS/Traefik do `atos-wa` ou instância desconectada | `docker logs atos_whatsapp`; conferir certificado; reconectar pelo QR |
| Tela diz "publique as regras do Firestore" ao gerar código | regras antigas | `firebase deploy --only firestore:rules` |
| Anexo não aparece | Storage rules sem `whatsapp/` ou arquivo > 25 MB | ver `storage.rules`; pedir arquivo menor |
