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
});
const pagina = await navegador.newPage();
pagina.on("dialog", (d) => d.accept());   // a bateria já aceita sozinha; isto é só garantia
pagina.on("pageerror", (e) => console.log("erro na página:", e.message));
await pagina.goto(URL, { waitUntil: "load" });
await pagina.waitForFunction(() => window.__resultado, { timeout: 20 * 60 * 1000, polling: 2000 });
const r = await pagina.evaluate(() => window.__resultado);
await navegador.close();

const linha = `${r.total} verificações em ${r.segundos}s — ${r.falhas ? r.falhas + " falha(s)" : "tudo certo"}`;
console.log(linha);
r.falharam.forEach((f) => console.log("✗ " + f));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Bateria de testes\n\n${linha}\n\n` + r.falharam.map((f) => `- ✗ ${f}`).join("\n") + "\n");
}
process.exit(r.falhas ? 1 : 0);
