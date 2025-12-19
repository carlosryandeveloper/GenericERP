const byId = (id) => document.getElementById(id);

const FALLBACK_LOCAL = "http://localhost:8000";

function guessApiBase() {
  // Ex.: https://<nome>-5173.app.github.dev  -> backend: https://<nome>-8000.app.github.dev
  const raw = window.location.origin;
  if (raw.includes(".app.github.dev")) {
    return window.location.origin.replace(/-\d+\./, "-8000.");
  }
  return FALLBACK_LOCAL;
}

function normalizeBase(url) {
  let u = (url || "").trim();
  if (!u) return "";
  // se usuário colar sem protocolo
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  // remove barra final
  u = u.replace(/\/+$/, "");
  return u;
}

function pretty(v) {
  try {
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function setOut(elId, value, kind = "ok") {
  const el = byId(elId);
  el.classList.remove("empty", "ok", "err");
  if (value === null || value === undefined || value === "") {
    el.textContent = "Sem dados.";
    el.classList.add("empty");
    return;
  }
  el.textContent = pretty(value);
  el.classList.add(kind === "err" ? "err" : "ok");
}

function setApiPill(kind, text) {
  const pill = byId("apiPill");
  const t = byId("apiPillText");
  pill.classList.remove("ok", "err");
  if (kind === "ok") pill.classList.add("ok");
  if (kind === "err") pill.classList.add("err");
  t.textContent = text;
}

function apiBase() {
  return normalizeBase(byId("apiBase").value);
}

async function fetchJson(path, opts = {}) {
  const base = apiBase();
  if (!base) throw new Error("API Base vazia");

  const url = base + path;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = data?.detail ? `${res.status} ${data.detail}` : `${res.status} ${res.statusText}`;
      const e = new Error(msg);
      e.status = res.status;
      e.data = data;
      throw e;
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function parseNumber(v) {
  const n = Number(String(v || "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function parseDateOrNull(v) {
  const s = (v || "").trim();
  if (!s) return null;
  // sem validação pesada; backend valida coerência
  return s;
}

// init
byId("apiBase").value = guessApiBase();
setApiPill("warn", "API: não testada");

// actions
byId("btnHealth").addEventListener("click", async () => {
  setOut("cfgOut", "Chamando /health ...", "ok");
  try {
    const data = await fetchJson("/health");
    setOut("cfgOut", data, "ok");
    setApiPill("ok", `API: OK (${apiBase()})`);
  } catch (e) {
    setOut("cfgOut", { error: String(e.message || e) }, "err");
    setApiPill("err", `API: erro (${apiBase() || "sem base"})`);
  }
});

byId("btnRoutes").addEventListener("click", async () => {
  setOut("cfgOut", "Chamando /debug/routes ...", "ok");
  try {
    const data = await fetchJson("/debug/routes");
    setOut("cfgOut", data, "ok");
  } catch (e) {
    setOut("cfgOut", { error: String(e.message || e), data: e.data }, "err");
  }
});

byId("btnCreateProduct").addEventListener("click", async () => {
  const sku = byId("pSku").value;
  const name = byId("pName").value;
  const unit = byId("pUnit").value;

  setOut("productOut", "Criando produto...", "ok");
  try {
    const data = await fetchJson("/products", {
      method: "POST",
      body: JSON.stringify({ sku, name, unit }),
    });
    setOut("productOut", data, "ok");
  } catch (e) {
    setOut("productOut", { error: String(e.message || e), data: e.data }, "err");
  }
});

byId("btnCreateMovement").addEventListener("click", async () => {
  const product_id = parseInt(byId("mProductId").value, 10);
  const type = byId("mType").value;
  const quantity = parseNumber(byId("mQty").value);
  const note = byId("mNote").value;

  setOut("movementOut", "Lançando movimentação...", "ok");
  try {
    if (!Number.isFinite(product_id) || product_id <= 0) throw new Error("product_id inválido");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity inválida");

    const payload = { product_id, type, quantity };
    if (note && note.trim()) payload.note = note.trim();

    const data = await fetchJson("/stock/movements", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setOut("movementOut", data, "ok");
  } catch (e) {
    setOut("movementOut", { error: String(e.message || e), data: e.data }, "err");
  }
});

byId("btnLoadBalance").addEventListener("click", async () => {
  setOut("balanceOut", "Carregando saldo...", "ok");
  try {
    const data = await fetchJson("/stock/balance");
    setOut("balanceOut", data, "ok");
  } catch (e) {
    setOut("balanceOut", { error: String(e.message || e), data: e.data }, "err");
  }
});

byId("btnLoadStatement").addEventListener("click", async () => {
  const product_id = parseInt(byId("sProductId").value, 10);
  const from = parseDateOrNull(byId("sFrom").value);
  const to = parseDateOrNull(byId("sTo").value);

  setOut("statementOut", "Carregando extrato...", "ok");
  try {
    if (!Number.isFinite(product_id) || product_id <= 0) throw new Error("product_id inválido");

    const params = new URLSearchParams({ product_id: String(product_id) });
    if (from) params.set("from_date", from);
    if (to) params.set("to_date", to);

    const data = await fetchJson("/stock/statement?" + params.toString());
    setOut("statementOut", data, "ok");
  } catch (e) {
    setOut("statementOut", { error: String(e.message || e), data: e.data }, "err");
  }
});
