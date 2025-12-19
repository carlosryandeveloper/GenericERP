nano frontend/app.js

const byId = (id) => document.getElementById(id);

const FALLBACK_LOCAL = "http://localhost:8000";
const LS_API_BASE = "genericerp.apiBase";

const ROUTES = {
  config: { title: "Configuração", desc: "Defina a API Base e valide a conexão." },
  products: { title: "Produtos", desc: "Crie produtos e consulte lista rápida." },
  movements: { title: "Movimentações", desc: "Lance IN/OUT/ADJUST e veja validações." },
  balance: { title: "Saldo", desc: "Saldo por produto (id, nome, unidade, saldo)." },
  statement: { title: "Extrato", desc: "Extrato do produto com saldo acumulado." },
};

function guessApiBase() {
  // Ex.: https://<nome>-5173.app.github.dev -> https://<nome>-8000.app.github.dev
  const raw = window.location.origin;
  if (raw.includes(".app.github.dev")) {
    return raw.replace(/-\d+\./, "-8000.");
  }
  return FALLBACK_LOCAL;
}

function normalizeBase(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

function setApiPill(kind, text) {
  const pill = byId("apiPill");
  const t = byId("apiPillText");
  pill.classList.remove("ok", "err");
  if (kind === "ok") pill.classList.add("ok");
  if (kind === "err") pill.classList.add("err");
  t.textContent = text;
}

function pretty(v) {
  try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
  catch { return String(v); }
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

function apiBase() {
  return normalizeBase(byId("apiBase")?.value || "");
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
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = { raw: text }; }

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

function routeNameFromHash() {
  const h = (window.location.hash || "").trim();
  // #/products
  const m = h.match(/^#\/([a-z-]+)/i);
  const name = m ? m[1] : "config";
  return ROUTES[name] ? name : "config";
}

function showPage(name) {
  // pages
  document.querySelectorAll(".page").forEach((p) => {
    p.style.display = (p.dataset.page === name) ? "block" : "none";
  });

  // nav active
  document.querySelectorAll(".navLink").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
  });

  // top title/desc
  byId("pageTitle").textContent = ROUTES[name].title;
  byId("pageDesc").textContent = ROUTES[name].desc;
}

function saveApiBase(value) {
  const v = normalizeBase(value);
  localStorage.setItem(LS_API_BASE, v);
  byId("apiBase").value = v;
}

function loadApiBase() {
  const stored = localStorage.getItem(LS_API_BASE);
  const v = normalizeBase(stored || "") || guessApiBase();
  byId("apiBase").value = v;
}

// --------------------
// Handlers
// --------------------
async function onHealth() {
  setOut("cfgOut", "Chamando /health ...", "ok");
  try {
    const data = await fetchJson("/health");
    setOut("cfgOut", data, "ok");
    setApiPill("ok", `API: OK (${apiBase()})`);
  } catch (e) {
    setOut("cfgOut", { error: e.message, data: e.data }, "err");
    setApiPill("err", `API: erro (${apiBase() || "sem base"})`);
  }
}

async function onRoutes() {
  setOut("cfgOut", "Chamando /debug/routes ...", "ok");
  try {
    const data = await fetchJson("/debug/routes");
    setOut("cfgOut", data, "ok");
  } catch (e) {
    setOut("cfgOut", { error: e.message, data: e.data }, "err");
  }
}

async function onCreateProduct() {
  setOut("productOut", "Criando produto...", "ok");
  try {
    const payload = {
      sku: byId("pSku").value,
      name: byId("pName").value,
      unit: byId("pUnit").value,
    };
    const data = await fetchJson("/products", { method: "POST", body: JSON.stringify(payload) });
    setOut("productOut", data, "ok");
  } catch (e) {
    setOut("productOut", { error: e.message, data: e.data }, "err");
  }
}

async function onProductsMin() {
  setOut("productsMinOut", "Carregando /products/min...", "ok");
  try {
    const data = await fetchJson("/products/min");
    setOut("productsMinOut", data, "ok");
  } catch (e) {
    setOut("productsMinOut", { error: e.message, data: e.data }, "err");
  }
}

async function onCreateMovement() {
  setOut("movementOut", "Lançando movimentação...", "ok");
  try {
    const product_id = parseInt(byId("mProductId").value, 10);
    const type = byId("mType").value;
    const quantity = parseNumber(byId("mQty").value);
    const note = (byId("mNote").value || "").trim();

    if (!Number.isFinite(product_id) || product_id <= 0) throw new Error("product_id inválido");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity inválida");

    const payload = { product_id, type, quantity };
    if (note) payload.note = note;

    const data = await fetchJson("/stock/movements", { method: "POST", body: JSON.stringify(payload) });
    setOut("movementOut", data, "ok");
  } catch (e) {
    setOut("movementOut", { error: e.message, data: e.data }, "err");
  }
}

async function onBalance() {
  setOut("balanceOut", "Carregando /stock/balance...", "ok");
  try {
    const data = await fetchJson("/stock/balance");
    setOut("balanceOut", data, "ok");
  } catch (e) {
    setOut("balanceOut", { error: e.message, data: e.data }, "err");
  }
}

async function onStatement() {
  setOut("statementOut", "Carregando /stock/statement...", "ok");
  try {
    const product_id = parseInt(byId("sProductId").value, 10);
    if (!Number.isFinite(product_id) || product_id <= 0) throw new Error("product_id inválido");

    const from = (byId("sFrom").value || "").trim();
    const to = (byId("sTo").value || "").trim();

    const params = new URLSearchParams({ product_id: String(product_id) });
    if (from) params.set("from_date", from);
    if (to) params.set("to_date", to);

    const data = await fetchJson("/stock/statement?" + params.toString());
    setOut("statementOut", data, "ok");
  } catch (e) {
    setOut("statementOut", { error: e.message, data: e.data }, "err");
  }
}

// --------------------
// Boot
// --------------------
function wire() {
  // config save/reset
  byId("btnSaveApi").addEventListener("click", () => {
    saveApiBase(byId("apiBase").value);
    setOut("cfgOut", { ok: true, apiBase: apiBase() }, "ok");
  });
  byId("btnResetApi").addEventListener("click", () => {
    saveApiBase(guessApiBase());
    setOut("cfgOut", { ok: true, apiBase: apiBase() }, "ok");
  });

  // top buttons
  byId("btnHealth").addEventListener("click", onHealth);
  byId("btnRoutes").addEventListener("click", onRoutes);

  // pages
  byId("btnCreateProduct").addEventListener("click", onCreateProduct);
  byId("btnLoadProductsMin").addEventListener("click", onProductsMin);
  byId("btnCreateMovement").addEventListener("click", onCreateMovement);
  byId("btnLoadBalance").addEventListener("click", onBalance);
  byId("btnLoadStatement").addEventListener("click", onStatement);

  // route init
  const applyRoute = () => showPage(routeNameFromHash());
  window.addEventListener("hashchange", applyRoute);
  applyRoute();
}

document.addEventListener("DOMContentLoaded", () => {
  loadApiBase();
  setApiPill("warn", "API: não testada");
  wire();

  // default route
  if (!window.location.hash) window.location.hash = "#/config";
});
