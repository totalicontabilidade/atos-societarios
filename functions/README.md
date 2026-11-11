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
| `functions/index.js` | webhook (token, de-duplicação, mídia → Storage, resposta pela Evolution), `vincular`, gravação da solicitação, aviso ao Hub, faxina diária |
| `functions/dialogo.js` | catálogo de fluxos (abrir, alterar, fechar, transformar, advocacia, outro), validações, resumo, correção, comandos (*voltar*, *resumo*, *menu*, *equipe*, *cancelar*) |
| `functions/portaria.js` | decide antes de gravar: só o grupo ativado é atendido; privado e outros grupos são descartados |
| `functions/parser.js` | tradução do evento da Evolution (copiado do TotaliFinance, adaptado ao privado) |
| `functions/painel.js` | rota `/painel` da aba Configurações › WhatsApp: estado e QR, só para administrador logado |
| `functions/evolution.js` | `sendText`, `getBase64FromMediaMessage`, `fetchInstances` |
| `functions/test/` | `node --test` — o diálogo conversado de ponta a ponta, sem rede |
| VPS `~/atos-whatsapp/` | `docker-compose.yml` (Evolution + Postgres próprios) e `.env` (segredos) |
| App, etapa 1 | **Gerar código para o grupo** (`vincular`) e, para administrador, **código de ativação** do grupo (`#ativar-atos`) em `codigos_vinculo/{código}` (10 min) |

## Como funciona (v1.73: só no grupo do robô)

O número conectado à instância `atos` é o **WhatsApp do escritório**. Chegam ao webhook as mensagens
de todos os clientes, e a `portaria.js` descarta tudo o que não é do grupo do robô **antes de gravar
qualquer coisa** e sem responder nada. A função `responder` tem uma segunda trava: não manda mensagem
para fora do grupo ativado, mesmo que outra parte do código erre.

- **Privado:** sempre ignorado. Cliente que escreve no privado do escritório não recebe nada do robô.
- **Outros grupos:** ignorados. A única coisa examinada neles é o código de ativação.
- **Ativar o grupo:** um **administrador** gera, na etapa 1 de qualquer processo, o código de ativação
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
- **Arquivos:** só foto, PDF e Word. Vídeo, áudio e outros formatos são recusados com aviso, antes de
  baixar; acima de 25 MB também. Arquivo pedido numa pergunta de documento entra com o rótulo dela
  (ex.: "Documentos pessoais de Ana Lima — cnh.jpg"). Arquivo que chega **fora da hora** faz o robô
  perguntar **que documento é** (RG/CNH, CPF, comprovante de residência, endereço da empresa, IPTU,
  contrato, CCMEI, OAB, outro, ou "mandei por engano", que apaga o arquivo). Depois do pedido
  enviado, o arquivo classificado é **juntado à solicitação** já criada, com aviso a quem cadastra.
- **Apagar anexo:** tirar um anexo do WhatsApp da solicitação apaga o arquivo do Storage (a regra
  deixa a equipe apagar em `whatsapp/`, nunca gravar).
- Um pedido novo no mesmo grupo, depois de um enviado, começa limpo: não herda empresa nem processo.
- Figurinhas e reações são ignoradas.

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
