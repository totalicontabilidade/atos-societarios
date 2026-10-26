/* Roda a bateria (testes.html?auto=1) num Chrome sem tela, no GitHub, a cada envio.
   Sem login: a nuvem fica de fora, como na porta "testes" daqui (ver testes.html).
   Sai com erro se houver qualquer falha — e o GitHub marca o envio com ✗. */
import puppeteer from "puppeteer-core";
import { appendFileSync } from "node:fs";

const URL = process.env.URL_TESTES || "http://localhost:8080/testes.html?auto=1";
const navegador = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  // a bateria leva uns 4 minutos e trava a página em trechos (OCR, PDF): o padrão de 3 min derrubava a conexão
  protocolTimeout: 30 * 60 * 1000,
});
const pagina = await navegador.newPage();
pagina.on("dialog", (d) => d.accept());   // a bateria já aceita sozinha; isto é só garantia
pagina.on("pageerror", (e) => console.log("erro na página:", e.message));
await pagina.goto(URL, { waitUntil: "load" });
// pergunta a cada 5 s se acabou; uma pergunta que demora (página ocupada) só adia a próxima
let r = null;
const limite = Date.now() + 25 * 60 * 1000;
while (!r && Date.now() < limite) {
  await new Promise((ok) => setTimeout(ok, 5000));
  try { r = await pagina.evaluate(() => window.__resultado || null); } catch (e) { console.log("aguardando…", e.message.slice(0, 80)); }
}
if (!r) { console.log("A bateria não terminou em 25 minutos."); await navegador.close(); process.exit(1); }
await navegador.close();

const linha = `${r.total} verificações em ${r.segundos}s — ${r.falhas ? r.falhas + " falha(s)" : "tudo certo"}`;
console.log(linha);
r.falharam.forEach((f) => console.log("✗ " + f));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Bateria de testes\n\n${linha}\n\n` + r.falharam.map((f) => `- ✗ ${f}`).join("\n") + "\n");
}
process.exit(r.falhas ? 1 : 0);
