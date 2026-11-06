# Robô do WhatsApp dos Atos Societários

Recebe pedidos de abertura e alteração de empresa pelo WhatsApp, pergunta o que falta num
**diálogo guiado sem IA** (perguntas numeradas, validação de CPF/CNPJ/CEP/data por código) e
grava a solicitação no Atos, com os documentos em anexo. Custo zero dentro das cotas gratuitas.

```
WhatsApp ──► Evolution API v2.3.7 (VPS Magalu, container atos_whatsapp, instância "atos")
                 │ webhook HTTPS + token
                 ▼
         Cloud Function whatsappWebhook (southamerica-east1, Blaze/cota gratuita)
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
| `functions/parser.js` | tradução do evento da Evolution (copiado do TotaliFinance, adaptado ao privado) |
| `functions/evolution.js` | `sendText`, `getBase64FromMediaMessage`, `fetchInstances` |
| `functions/test/` | `node --test` — o diálogo conversado de ponta a ponta, sem rede |
| VPS `~/atos-whatsapp/` | `docker-compose.yml` (Evolution + Postgres próprios) e `.env` (segredos) |
| App, etapa 1 | botão **Gerar código de vínculo**: grava `codigos_vinculo/{código}` (10 min) |

## Como o cliente entra

- **Privado:** qualquer pessoa que mandar mensagem ao número do robô recebe o aviso de LGPD e o
  menu. No fim, nasce uma solicitação `nova` com `abertaPor: "whatsapp"`.
- **Processo já aberto:** na etapa 1 do Atos, gere o código e mande ao cliente a mensagem
  `vincular 123456`. O robô liga a conversa (privado ou grupo) àquela solicitação e completa os
  dados nela, marcando `respostaNova` e `pendencia` para o comercial ver.
- **Grupo:** só é atendido depois do `vincular` (como no Finance). Mensagens de grupo não ligado
  são ignoradas e nada é guardado.
- **Equipe humana:** `0` ou *equipe* em qualquer momento marca a pendência na solicitação.
- Áudio não é lido (o robô pede por escrito). Figurinhas são ignoradas.

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

## Dados e LGPD

- A Evolution **não guarda mensagens** (`DATABASE_SAVE_DATA_NEW_MESSAGE=false`); só a sessão.
- `whatsapp_eventos` (de-duplicação) é apagado após 30 dias; códigos vencidos após 1 dia (faxina 03:20).
- Conversa, respostas e anexos ficam no Firestore e no Storage do projeto `atos-societarios`.
- Nenhum dado de cliente vai para modelo de linguagem de terceiros.

## Erros conhecidos e o que fazer

| Sintoma | Causa provável | Ação |
|---|---|---|
| Função responde 401 | token do webhook diferente do secret | `firebase functions:secrets:set WHATSAPP_WEBHOOK_TOKEN` e `webhook/set` de novo |
| Robô não responde, logs "sem resposta da Evolution" | DNS/Traefik do `atos-wa` ou instância desconectada | `docker logs atos_whatsapp`; conferir certificado; reconectar pelo QR |
| Tela diz "publique as regras do Firestore" ao gerar código | regras antigas | `firebase deploy --only firestore:rules` |
| Anexo não aparece | Storage rules sem `whatsapp/` ou arquivo > 25 MB | ver `storage.rules`; pedir arquivo menor |
