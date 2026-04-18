const path = require("path");
const fs = require("fs/promises");
const dotenv = require("dotenv");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { chromium } = require("playwright");

const { login, gotoResults, extractPedidos } = require("./src/portal");
const { downloadPdfForPedido, extractDataExameFromPdf } = require("./src/pdf");
const { savePedidos, appendDownloadLog, ensureDownloadsDir } = require("./src/store");
const {
  openDatabase,
  initDatabase,
  getDownloadedPedidosSet,
  markPedidoDownloaded,
  updateDataExameForPedidos,
  getPedidosMissingDataExame,
  updateDataExameForPedido,
  updateFilePathForPedido,
  closeDatabase,
} = require("./src/db");

dotenv.config();

const argv = yargs(hideBin(process.argv))
  .option("once", { type: "boolean", default: false })
  .option("watch", { type: "number", default: 0 })
  .option("headful", { type: "boolean", default: false })
  .option("force", { type: "boolean", default: false })
  .option("pedidos", { type: "string", default: "" })
  .option("backfill-data-exame", { type: "boolean", default: false })
  .strict()
  .fail((msg, err, yargsInstance) => {
    if (err) throw err;
    console.error(msg);
    console.error("\nUso:");
    console.error(yargsInstance.help());
    process.exit(1);
  })
  .parseSync();

const LOGIN_URL = process.env.LOGIN_URL;
const RESULT_URL = process.env.RESULT_URL;
const PORTAL_IDCPF = process.env.PORTAL_IDCPF;
const PORTAL_DTNASC = process.env.PORTAL_DTNASC;
const PORTAL_SENHA = process.env.PORTAL_SENHA;

const baseDownloadsDir = path.join(__dirname, "downloads");
const pedidosPath = path.join(__dirname, "pedidos.json");
const downloadsLogPath = path.join(__dirname, "downloads_log.json");
const downloadsDbPath = path.join(__dirname, "downloads.sqlite");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateFolder(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

function logStep(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function buildDownloadsIndex(downloadsDir) {
  const map = new Map();
  const pending = [downloadsDir];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        map.set(entry.name.toLowerCase(), fullPath);
      }
    }
  }
  return map;
}

async function backfillDataExameFromPdfs(db) {
  const missing = await getPedidosMissingDataExame(db);
  if (!missing.length) {
    console.log("Nenhum registro sem data_exame encontrado.");
    return;
  }

  const downloadsIndex = await buildDownloadsIndex(baseDownloadsDir);
  let updated = 0;
  for (const item of missing) {
    const filename = `${item.pedido}.pdf`.toLowerCase();
    const filePath = item.file_path || downloadsIndex.get(filename);
    if (!filePath) {
      continue;
    }
    if (!item.file_path) {
      await updateFilePathForPedido(db, item.pedido, filePath);
    }
    const dataExame = await extractDataExameFromPdf(filePath, item.pedido);
    if (dataExame) {
      await updateDataExameForPedido(db, item.pedido, dataExame);
      updated += 1;
    }
  }

  console.log(`data_exame preenchida para ${updated} pedido(s).`);
}

async function runBackfillOnly() {
  const db = await openDatabase(downloadsDbPath);
  await initDatabase(db);
  try {
    await backfillDataExameFromPdfs(db);
  } finally {
    await closeDatabase(db).catch(() => {});
  }
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

  const db = await openDatabase(downloadsDbPath);
  await initDatabase(db);

  logStep("Iniciando navegador e preparando sessao.");
  const browser = await chromium.launch({ headless: !argv.headful });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    logStep("Realizando login no portal.");
    await login(page, {
      idcpf: PORTAL_IDCPF,
      dtnasc: PORTAL_DTNASC,
      senha: PORTAL_SENHA,
      loginUrl: LOGIN_URL,
    });

    if (RESULT_URL) {
      logStep("Abrindo tela de resultados.");
      await gotoResults(page, RESULT_URL);
    }

    const pedidos = await extractPedidos(page);
    logStep(`Pedidos encontrados: ${pedidos.length}.`);
    await savePedidos(pedidos, pedidosPath);
    await updateDataExameForPedidos(db, pedidos);

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
    logStep(`Pedidos apos filtro: ${pedidosParaBaixar.length}.`);

    const pedidosElegiveis = argv.force
      ? pedidosParaBaixar
      : pedidosParaBaixar.filter(
          (pedido) => pedido.temLaudo && pedido.laudoHref
        );
    const downloadedSet = argv.force
      ? new Set()
      : await getDownloadedPedidosSet(
          db,
          pedidosElegiveis.map((pedido) => pedido.pedido)
        );
    logStep(
      `Pedidos elegiveis: ${pedidosElegiveis.length}. Ja baixados: ${downloadedSet.size}.`
    );

    for (const pedido of pedidosParaBaixar) {
      if (!pedido.temLaudo || !pedido.laudoHref) {
        continue;
      }
      if (!argv.force && downloadedSet.has(pedido.pedido)) {
        continue;
      }

      logStep(`Baixando pedido ${pedido.pedido}.`);
      const result = await downloadPdfForPedido(context, pedido.pedido, pedido.laudoHref, {
        downloadsDir: datedDownloadsDir,
        force: argv.force,
      });
      logStep(
        `Resultado ${pedido.pedido}: ${result.status}${
          result.error ? ` (${result.error})` : ""
        }${result.attempts ? ` [tentativas: ${result.attempts}]` : ""}.`
      );

      if (result.status === "baixado" || result.status === "ja_existe") {
        await markPedidoDownloaded(db, {
          pedido: pedido.pedido,
          url: result.url || null,
          filePath: result.filePath || null,
          dataExame: pedido.dataExame || null,
        });
        if (!pedido.dataExame && result.filePath) {
          const dataExameFromPdf = await extractDataExameFromPdf(
            result.filePath,
            pedido.pedido
          );
          if (dataExameFromPdf) {
            await updateDataExameForPedido(db, pedido.pedido, dataExameFromPdf);
          }
        }
      }

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
    await closeDatabase(db).catch(() => {});
  }
}

async function main() {
  if (argv.backfillDataExame) {
    await runBackfillOnly();
    return;
  }
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
