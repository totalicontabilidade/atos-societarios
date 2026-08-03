# Atos Societários — gerador (padrão JUCESE / DREI 81)

Aplicação **100% client-side** (um único `index.html` + bibliotecas locais em `lib/`) que
monta atos societários no padrão da Junta Comercial de Sergipe: constituição e alteração de
Ltda, Empresário Individual, SLU, transformações, distrato/extinção, além de e-mail de
confirmação e um painel de casos (só metadados, guardado no próprio navegador).

Roda no navegador, sem servidor e sem login. Os documentos que você carrega para o
preenchimento rápido **são processados apenas na sua máquina** — nada é enviado para nenhum
servidor da aplicação.

## Como usar localmente

Abra o arquivo `index.html` no navegador (Chrome/Edge/Firefox). Não precisa instalar nada.

## Estrutura

| Caminho          | O que é                                                        |
|------------------|---------------------------------------------------------------|
| `index.html`     | A aplicação inteira (HTML + CSS + JS embutidos)               |
| `lib/`           | Bibliotecas vendorizadas (docx, docx-preview, jszip, pdf.js, tesseract…) |
| `assets/`        | Imagens (logo)                                                |
| `.nojekyll`      | Faz o GitHub Pages servir os arquivos como estão              |

## Hospedagem no GitHub Pages

1. Crie um repositório no GitHub e envie o conteúdo desta pasta.
2. Em **Settings → Pages**, selecione a branch (ex.: `main`) e a pasta **/(root)**.
3. O site fica disponível em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

> **Privacidade:** a aplicação não coleta nem transmite dados de clientes. Ainda assim,
> **nunca** faça commit de documentos de clientes (PDF/DOCX) — o `.gitignore` já bloqueia
> esses tipos de arquivo como trava de segurança.

## Dependências de rede (opcionais)

- **Busca de CEP** (viacep.com.br): autopreenche endereço a partir do CEP; se estiver offline,
  o app valida só o formato e segue.
- **OCR** (Tesseract): para documentos escaneados, baixa o motor de idioma sob demanda.
  Sem internet, o OCR não roda (o restante funciona normalmente).
