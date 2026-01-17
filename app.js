const path = require("path");
const dotenv = require("dotenv");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { chromium } = require("playwright");

const { login, gotoResults, extractPedidos } = require("./src/portal");
const { downloadPdfForPedido } = require("./src/pdf");
const { savePedidos, appendDownloadLog, ensureDownloadsDir } = require("./src/store");

dotenv.config();

const argv = yargs(hideBin(process.argv))
  .option("once", { type: "boolean", default: false })
  .option("watch", { type: "number", default: 0 })
  .option("headful", { type: "boolean", default: false })
  .option("force", { type: "boolean", default: false })
  .option("pedidos", { type: "string", default: "" })
  .parseSync();

const LOGIN_URL = process.env.LOGIN_URL;
const RESULT_URL = process.env.RESULT_URL;
const PORTAL_IDCPF = process.env.PORTAL_IDCPF;
const PORTAL_DTNASC = process.env.PORTAL_DTNASC;
const PORTAL_SENHA = process.env.PORTAL_SENHA;

const baseDownloadsDir = path.join(__dirname, "downloads");
const pedidosPath = path.join(__dirname, "pedidos.json");
const downloadsLogPath = path.join(__dirname, "downloads_log.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateFolder(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

function validateEnv() {
  const missing = [];
  if (!PORTAL_IDCPF) missing.push("PORTAL_IDCPF");
  if (!PORTAL_DTNASC) missing.push("PORTAL_DTNASC");
  if (!PORTAL_SENHA) missing.push("PORTAL_SENHA");
  if (!LOGIN_URL) missing.push("LOGIN_URL");
  if (missing.length) {
    throw new Error(`Variaveis obrigatorias ausentes: ${missing.join(", ")}`);
  }
}

async function runOnce() {
  validateEnv();
  const datedDownloadsDir = path.join(baseDownloadsDir, formatDateFolder());
  await ensureDownloadsDir(datedDownloadsDir);

  const browser = await chromium.launch({ headless: !argv.headful });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, {
      idcpf: PORTAL_IDCPF,
      dtnasc: PORTAL_DTNASC,
      senha: PORTAL_SENHA,
      loginUrl: LOGIN_URL,
    });

    if (RESULT_URL) {
      await gotoResults(page, RESULT_URL);
    }

    const pedidos = await extractPedidos(page);
    await savePedidos(pedidos, pedidosPath);

    const pedidosFiltro = argv.pedidos
      ? argv.pedidos
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const pedidosParaBaixar =
      pedidosFiltro.length > 0
        ? pedidos.filter((pedido) => pedidosFiltro.includes(pedido.pedido))
        : pedidos;

    for (const pedido of pedidosParaBaixar) {
      if (!pedido.temLaudo || !pedido.laudoHref) {
        continue;
      }

      const result = await downloadPdfForPedido(context, pedido.pedido, pedido.laudoHref, {
        downloadsDir: datedDownloadsDir,
        force: argv.force,
      });

      await appendDownloadLog(
        {
          timestamp: new Date().toISOString(),
          pedido: pedido.pedido,
          url: result.url || null,
          status: result.status,
        },
        downloadsLogPath
      );
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const runOnceOnly = argv.once || argv.watch <= 0;
  if (runOnceOnly) {
    await runOnce();
    return;
  }

  while (true) {
    try {
      await runOnce();
    } catch (error) {
      console.error("Falha na execucao:", error.message || error);
    }
    await sleep(argv.watch * 1000);
  }
}

main().catch((error) => {
  console.error("Erro fatal:", error.message || error);
  process.exitCode = 1;
});
