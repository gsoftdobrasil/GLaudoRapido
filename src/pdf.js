const fs = require("fs/promises");
const path = require("path");

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForPdfUrl(page, timeoutMs = 30000) {
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
    return { status: "ja_existe", url: null };
  }

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let laudoPage;
    let popupPage;
    try {
      laudoPage = await context.newPage();
      await laudoPage.goto(laudoHref, { waitUntil: "domcontentloaded", timeout: 20000 });

      const popupPromise = laudoPage
        .waitForEvent("popup", { timeout: 10000 })
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
        return { status: "erro", url: null, error: error.message || String(error) };
      }
    }
  }

  return { status: "erro", url: null };
}

module.exports = {
  downloadPdfForPedido,
};
