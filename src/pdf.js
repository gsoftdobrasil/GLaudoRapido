const fs = require("fs/promises");
const path = require("path");
const pdfParse = require("pdf-parse");

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForPdfUrl(page, timeoutMs = 15000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    const url = page.url();
    if (/\.PDF$/i.test(url)) {
      return url;
    }
    try {
      await page.waitForURL(/\.PDF$/i, { timeout: 3000 });
      return page.url();
    } catch {
      // keep polling
    }
  }
  return null;
}

async function downloadPdfForPedido(context, pedido, laudoHref, { downloadsDir, force }) {
  if (!laudoHref) {
    return { status: "sem_link", url: null };
  }

  const filePath = path.join(downloadsDir, `${pedido}.pdf`);
  if (!force && (await fileExists(filePath))) {
    return { status: "ja_existe", url: null, filePath };
  }

  const maxRetries = 1;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let laudoPage;
    let popupPage;
    try {
      laudoPage = await context.newPage();
      await laudoPage.goto(laudoHref, { waitUntil: "domcontentloaded", timeout: 10000 });

      const popupPromise = laudoPage
        .waitForEvent("popup", { timeout: 5000 })
        .catch(() => null);

      const link = laudoPage.getByRole("link", {
        name: /Clique aqui para imprimir o laudo/i,
      });
      await link.click();

      popupPage = await popupPromise;
      const pdfUrl =
        (popupPage ? await waitForPdfUrl(popupPage) : null) ||
        (await waitForPdfUrl(laudoPage));

      if (!pdfUrl) {
        throw new Error("PDF nao foi encontrado");
      }

      const response = await context.request.get(pdfUrl);
      if (!response.ok()) {
        throw new Error(`Falha no download do PDF: ${response.status()}`);
      }

      const buffer = await response.body();
      await fs.writeFile(filePath, buffer);

      await laudoPage.close().catch(() => {});
      if (popupPage) {
        await popupPage.close().catch(() => {});
      }

      return { status: "baixado", url: pdfUrl, filePath };
    } catch (error) {
      if (laudoPage) {
        await laudoPage.close().catch(() => {});
      }
      if (popupPage) {
        await popupPage.close().catch(() => {});
      }
      if (attempt >= maxRetries) {
        return {
          status: "erro",
          url: null,
          error: error.message || String(error),
          attempts: attempt + 1,
        };
      }
    }
  }

  return { status: "erro", url: null };
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function findDateNearPedido(text, pedido) {
  if (!text || !pedido) return null;
  const normalized = normalizeText(text);
  const idx = normalized.indexOf(pedido);
  if (idx === -1) return null;
  const windowStart = Math.max(0, idx - 120);
  const windowEnd = Math.min(normalized.length, idx + 200);
  const windowText = normalized.slice(windowStart, windowEnd);
  const dateMatch = windowText.match(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/);
  return dateMatch ? dateMatch[1] : null;
}

function findDateByLabel(text) {
  if (!text) return null;
  const normalized = normalizeText(text);
  const labelMatch = normalized.match(
    /Data\s+do\s+Exame[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
  );
  if (labelMatch) return labelMatch[1];
  const fallbackMatch = normalized.match(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/);
  return fallbackMatch ? fallbackMatch[1] : null;
}

async function extractDataExameFromPdf(filePath, pedido) {
  if (!filePath) return null;
  try {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    const text = data && data.text ? data.text : "";
    return findDateNearPedido(text, pedido) || findDateByLabel(text);
  } catch {
    return null;
  }
}

module.exports = {
  downloadPdfForPedido,
  extractDataExameFromPdf,
};
