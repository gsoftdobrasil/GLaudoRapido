const sqlite3 = require("sqlite3").verbose();

function openDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function initDatabase(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS downloaded_exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido TEXT NOT NULL UNIQUE,
      url TEXT,
      file_path TEXT,
      data_exame TEXT,
      downloaded_at TEXT NOT NULL
    )`
  );

  const columns = await all(db, "PRAGMA table_info(downloaded_exams)");
  const hasDataExame = columns.some((column) => column.name === "data_exame");
  if (!hasDataExame) {
    await run(db, "ALTER TABLE downloaded_exams ADD COLUMN data_exame TEXT");
  }
}

async function getDownloadedPedidosSet(db, pedidos) {
  if (!pedidos || pedidos.length === 0) {
    return new Set();
  }
  const placeholders = pedidos.map(() => "?").join(", ");
  const rows = await all(
    db,
    `SELECT pedido FROM downloaded_exams WHERE pedido IN (${placeholders})`,
    pedidos
  );
  return new Set(rows.map((row) => row.pedido));
}

async function markPedidoDownloaded(db, { pedido, url, filePath, dataExame }) {
  if (!pedido) {
    return;
  }
  await run(
    db,
    `INSERT INTO downloaded_exams (pedido, url, file_path, data_exame, downloaded_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(pedido) DO UPDATE SET
       url = excluded.url,
       file_path = excluded.file_path,
       data_exame = excluded.data_exame,
       downloaded_at = excluded.downloaded_at`,
    [pedido, url || null, filePath || null, dataExame || null, new Date().toISOString()]
  );
}

async function updateDataExameForPedidos(db, pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    return;
  }
  const updates = pedidos.filter((pedido) => pedido.pedido && pedido.dataExame);
  for (const item of updates) {
    await run(
      db,
      "UPDATE downloaded_exams SET data_exame = ? WHERE pedido = ?",
      [item.dataExame, item.pedido]
    );
  }
}

async function getPedidosMissingDataExame(db) {
  return all(
    db,
    `SELECT pedido, file_path
     FROM downloaded_exams
     WHERE data_exame IS NULL`
  );
}

async function updateDataExameForPedido(db, pedido, dataExame) {
  if (!pedido || !dataExame) {
    return;
  }
  await run(
    db,
    "UPDATE downloaded_exams SET data_exame = ? WHERE pedido = ?",
    [dataExame, pedido]
  );
}

async function updateFilePathForPedido(db, pedido, filePath) {
  if (!pedido || !filePath) {
    return;
  }
  await run(
    db,
    "UPDATE downloaded_exams SET file_path = ? WHERE pedido = ?",
    [filePath, pedido]
  );
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  openDatabase,
  initDatabase,
  getDownloadedPedidosSet,
  markPedidoDownloaded,
  updateDataExameForPedidos,
  getPedidosMissingDataExame,
  updateDataExameForPedido,
  updateFilePathForPedido,
  closeDatabase,
};
