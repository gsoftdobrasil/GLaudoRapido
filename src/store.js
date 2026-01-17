const fs = require("fs/promises");

async function ensureDownloadsDir(downloadsDir) {
  await fs.mkdir(downloadsDir, { recursive: true });
}

async function savePedidos(pedidos, filepath) {
  const payload = JSON.stringify(pedidos, null, 2);
  await fs.writeFile(filepath, payload, "utf8");
}

async function appendDownloadLog(entry, filepath) {
  let list = [];
  try {
    const existing = await fs.readFile(filepath, "utf8");
    const parsed = JSON.parse(existing);
    if (Array.isArray(parsed)) {
      list = parsed;
    }
  } catch {
    // ignore
  }
  list.push(entry);
  await fs.writeFile(filepath, JSON.stringify(list, null, 2), "utf8");
}

module.exports = {
  ensureDownloadsDir,
  savePedidos,
  appendDownloadLog,
};
