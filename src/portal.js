async function login(page, { idcpf, dtnasc, senha, loginUrl }) {
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  const tabClientes = page.locator("text=Clientes").first();
  if (await tabClientes.count()) {
    await tabClientes.click();
  }

  const pickVisible = async (locator) => {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (await item.isVisible()) return item;
    }
    return null;
  };

  const textInputs = page.locator('input[type="text"]');
  const idcpfCandidates = page.locator(
    'input[id*="CPF" i], input[name*="CPF" i], input[id*="SMS" i], input[name*="SMS" i]'
  );
  const idcpfInput = (await pickVisible(idcpfCandidates)) || (await pickVisible(textInputs));
  if (idcpfInput) {
    await idcpfInput.fill(idcpf);
  }

  const dateCandidates = page.locator(
    'input[placeholder*="dd/mm/aaaa" i], input[id*="NASC" i], input[name*="NASC" i]'
  );
  const dateInput = (await pickVisible(dateCandidates)) || (await pickVisible(textInputs.nth(1)));
  if (dateInput) {
    const formatDateForInput = (value) => {
      const parts = (value || "").split("/");
      if (parts.length === 3) {
        const [dd, mm, yyyy] = parts;
        return `${yyyy}-${mm}-${dd}`;
      }
      return value;
    };
    const type = await dateInput.getAttribute("type");
    const value = type && type.toLowerCase() === "date" ? formatDateForInput(dtnasc) : dtnasc;
    await dateInput.fill(value);
  }

  const passInput = await pickVisible(page.locator('input[type="password"]'));
  if (passInput) {
    await passInput.fill(senha);
  }

  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
    .catch(() => null);

  const enviarBtn =
    (await pickVisible(page.locator('input[type="submit"]'))) ||
    (await pickVisible(page.locator('input[type="image"]'))) ||
    (await pickVisible(page.locator('input[value*="ENVIAR" i]'))) ||
    (await pickVisible(page.locator("text=ENVIAR")));
  if (enviarBtn) {
    await enviarBtn.click();
  } else {
    const form = await pickVisible(page.locator("form"));
    if (!form) {
      throw new Error("Botao ENVIAR nao encontrado");
    }
    await form.evaluate((el) => el.submit());
  }
  await navPromise;

  await waitForLogin(page);
}

async function waitForLogin(page) {
  try {
    await page.waitForURL(/buscam\.asp/i, { timeout: 15000 });
    return;
  } catch {
    // ignore
  }
  await page.waitForSelector("text=Logado:", { timeout: 15000 });
}

async function gotoResults(page, resultUrl) {
  if (!resultUrl) return;
  await page.goto(resultUrl, { waitUntil: "domcontentloaded" });
}

async function extractPedidos(page) {
  await page.waitForLoadState("domcontentloaded");

  const pedidos = await page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText || "" : "";
    const pedidosMap = new Map();

    const blockRegex =
      /Pedido:\s*([0-9-]+)[\s\S]*?(?=Pedido:\s*[0-9-]+|$)/gi;
    let match;
    while ((match = blockRegex.exec(bodyText)) !== null) {
      const pedido = match[1];
      const block = match[0];
      const entregaMatch = block.match(
        /Entrega Estimada:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4}\s*[0-9]{2}:[0-9]{2})/i
      );
      const statusMatch = block.match(/Status:\s*([^\n\r]+)/i);
      const naoDisponivel = /Laudo n[aã]o dispon[ií]vel/i.test(block);

      pedidosMap.set(pedido, {
        pedido,
        entregaEstimada: entregaMatch ? entregaMatch[1].trim() : null,
        status: statusMatch ? statusMatch[1].trim() : null,
        temLaudo: !naoDisponivel,
        laudoHref: null,
      });
    }

    const laudoLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
      const text = a.textContent || "";
      const href = a.getAttribute("href") || "";
      return (
        /Laudo\s+para\s+Impress/i.test(text) ||
        /pedidopadrao/i.test(href) ||
        /pedidopadrao/i.test(a.innerHTML || "")
      );
    });

    const findPedidoNear = (node) => {
      if (!node) return null;
      let current = node.closest("tr") || node;
      let steps = 0;
      while (current && steps < 8) {
        const text = current.innerText || "";
        const m = text.match(/Pedido:\s*([0-9-]+)/i);
        if (m) return m[1];
        const prev = current.previousElementSibling;
        if (prev) {
          current = prev;
          steps += 1;
          continue;
        }
        current = current.parentElement;
        steps += 1;
      }
      return null;
    };

    for (const link of laudoLinks) {
      let found = findPedidoNear(link);
      if (!found) {
        let container = link.closest("table") || link.closest("tr") || link.parentElement;
        let depth = 0;
        while (container && depth < 6 && !found) {
          const text = container.innerText || "";
          const m = text.match(/Pedido:\s*([0-9-]+)/i);
          if (m) {
            found = m[1];
            break;
          }
          container = container.parentElement;
          depth += 1;
        }
      }

      if (!found) continue;
      const existing = pedidosMap.get(found);
      if (existing) {
        existing.temLaudo = true;
        existing.laudoHref = link.href || null;
      } else {
        pedidosMap.set(found, {
          pedido: found,
          entregaEstimada: null,
          status: null,
          temLaudo: true,
          laudoHref: link.href || null,
        });
      }
    }

    return Array.from(pedidosMap.values());
  });

  return pedidos;
}

module.exports = {
  login,
  gotoResults,
  extractPedidos,
};
