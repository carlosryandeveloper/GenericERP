const byId = (id) => document.getElementById(id);

const FALLBACK_LOCAL = "http://localhost:8000";
const LS_API_BASE = "genericerp.apiBase";

const ROUTES = {
  config: { title: "Configuração", desc: "Defina a API Base e valide a conexão." },
  products: { title: "Produtos", desc: "Crie produtos e consulte listas em tabela." },
  movements: { title: "Movimentações", desc: "Lance IN/OUT/ADJUST e veja validações." },
  balance: { title: "Saldo", desc: "Saldo por produto (id, nome, unidade, saldo)." },
  statement: { title: "Extrato", desc: "Extrato do produto com saldo acumulado." },
};

function guessApiBase() {
  // Ex.: https://<nome>-5173.app.github.dev -> https://<nome>-8000.app.github.dev
  const raw = window.location.origin;
  if (raw.includes(".app.github.dev")) return raw.replace(/-\d+\./, "-8000.");
  return FALLBACK_LOCAL;
}

function normalizeBase(url) {
  let u = (url || "").trim();
  if (!u) return "";

  // se usuário digitar "localhost:8000" sem protocolo, não inventa https
  if (!/^https?:\/\//i.test(u)) {
    const lower = u.toLowerCase();
    const isLocal = lower.startsWith("localhost") || lower.startsWith("127.0.0.1");
    u = (isLocal ? "http://" : "https://") + u;
  }

  return u.replace(/\/+$/, "");
}

function apiBase() {
  return normalizeBase(byId("apiBase")?.value || "");
}

function setApiPill(kind, text) {
  const pill = byId("apiPill");
  const t = byId("apiPillText");
  if (!pill || !t) return;

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
  if (!el) return;

  el.classList.remove("empty", "ok", "err");
  if (value === null || value === undefined || value === "") {
    el.textContent = "Sem dados.";
    el.classList.add("empty");
    return;
  }
  el.textContent = pretty(value);
  el.classList.add(kind === "err" ? "err" : "ok");
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

/* =========================================================
   TABELAS
   ========================================================= */

const fmtDateTime = (iso) => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" })
      .format(new Date(iso));
  } catch {
    return String(iso);
  }
};

function renderTable({ mountEl, columns, rows, emptyText = "Sem dados.", filterKeys = [] }) {
  if (!mountEl) return;

  let state = { q: "", sortKey: null, sortDir: "asc" };

  const wrap = document.createElement("div");

  const toolbar = document.createElement("div");
  toolbar.className = "table-toolbar";
  toolbar.innerHTML = `
    <input type="text" placeholder="Filtrar..." />
    <div class="muted"><span class="mono">${rows.length}</span> registro(s)</div>
  `;

  const input = toolbar.querySelector("input");
  input.addEventListener("input", () => {
    state.q = input.value.trim().toLowerCase();
    paint();
  });

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";

  const table = document.createElement("table");
  table.className = "erp-table";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");

  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.title;
    th.title = "Clique para ordenar";
    th.addEventListener("click", () => {
      if (state.sortKey === c.key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = c.key;
        state.sortDir = "asc";
      }
      paint();
    });
    trh.appendChild(th);
  });

  thead.appendChild(trh);

  const tbody = document.createElement("tbody");

  table.appendChild(thead);
  table.appendChild(tbody);
  tableWrap.appendChild(table);

  wrap.appendChild(toolbar);
  wrap.appendChild(tableWrap);

  mountEl.innerHTML = "";
  mountEl.appendChild(wrap);

  function applyFilter(list) {
    if (!state.q) return list;
    return list.filter((r) => {
      const keys = filterKeys.length ? filterKeys : Object.keys(r || {});
      const hay = keys.map((k) => String(r?.[k] ?? "").toLowerCase()).join(" ");
      return hay.includes(state.q);
    });
  }

  function applySort(list) {
    if (!state.sortKey) return list;
    const dir = state.sortDir === "asc" ? 1 : -1;
    const key = state.sortKey;

    return [...list].sort((a, b) => {
      const va = a?.[key];
      const vb = b?.[key];
      const na = Number(va);
      const nb = Number(vb);

      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR") * dir;
    });
  }

  function paint() {
    const filtered = applyFilter(rows);
    const finalRows = applySort(filtered);

    tbody.innerHTML = "";

    if (!finalRows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length;
      td.className = "muted";
      td.style.padding = "14px";
      td.textContent = emptyText;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    finalRows.forEach((r) => {
      const tr = document.createElement("tr");
      columns.forEach((c) => {
        const td = document.createElement("td");
        const raw = r?.[c.key];

        if (c.className) td.className = c.className;

        if (c.render) td.innerHTML = c.render(raw, r) ?? "";
        else td.textContent = raw == null ? "" : String(raw);

        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  paint();
}

/* =========================================================
   Rotas / UI
   ========================================================= */

function routeNameFromHash() {
  const h = (window.location.hash || "").trim();
  const m = h.match(/^#\/([a-z-]+)/i);
  const name = m ? m[1] : "config";
  return ROUTES[name] ? name : "config";
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => {
    p.style.display = (p.dataset.page === name) ? "block" : "none";
  });

  document.querySelectorAll(".navLink").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
  });

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

/* =========================================================
   Handlers
   ========================================================= */

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

/* ✅ Lista rápida em TABELA */
async function onProductsMin() {
  const mount = byId("productsMinTable");
  setOut("productsMinMsg", "Carregando /products/min (tabela)...", "ok");
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/products/min");

    renderTable({
      mountEl: mount,
      rows,
      columns: [
        { key: "id", title: "ID", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "name", title: "Nome" },
        { key: "unit", title: "Unidade", render: (v) => `<span class="kbd">${v ?? ""}</span>` },
      ],
      filterKeys: ["id", "name", "unit"],
      emptyText: "Nenhum produto ainda.",
    });

    setOut("productsMinMsg", `Tabela carregada (${rows.length} registro(s)).`, "ok");
  } catch (e) {
    setOut("productsMinMsg", { error: e.message, data: e.data }, "err");
    if (mount) mount.innerHTML = "";
  }
}

/* ✅ Tabela completa de produtos */
async function onProductsTable() {
  const mount = byId("productsTable");
  setOut("productsTableMsg", "Carregando /products (tabela completa)...", "ok");
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/products");

    renderTable({
      mountEl: mount,
      rows,
      columns: [
        { key: "id", title: "ID", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "sku", title: "SKU", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "name", title: "Nome" },
        { key: "unit", title: "Unidade", render: (v) => `<span class="kbd">${v ?? ""}</span>` },
        { key: "created_at", title: "Criado em", render: (v) => `<span class="mono">${fmtDateTime(v)}</span>` },
      ],
      filterKeys: ["id", "sku", "name", "unit", "created_at"],
      emptyText: "Nenhum produto ainda.",
    });

    setOut("productsTableMsg", "Tabela completa carregada.", "ok");
  } catch (e) {
    setOut("productsTableMsg", { error: e.message, data: e.data }, "err");
    if (mount) mount.innerHTML = "";
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

/* ✅ Saldo em TABELA */
async function onBalance() {
  const mount = byId("balanceTable");
  setOut("balanceMsg", "Carregando /stock/balance (tabela)...", "ok");
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/stock/balance");

    renderTable({
      mountEl: mount,
      rows,
      columns: [
        { key: "product_id", title: "ID", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "name", title: "Produto" },
        { key: "unit", title: "Unidade", render: (v) => `<span class="kbd">${v ?? ""}</span>` },
        { key: "balance", title: "Saldo", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
      ],
      filterKeys: ["product_id", "name", "unit", "balance"],
      emptyText: "Sem saldo para exibir.",
    });

    setOut("balanceMsg", `Tabela carregada (${rows.length} registro(s)).`, "ok");
  } catch (e) {
    setOut("balanceMsg", { error: e.message, data: e.data }, "err");
    if (mount) mount.innerHTML = "";
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

/* =========================================================
   Boot
   ========================================================= */

function wire() {
  byId("btnSaveApi")?.addEventListener("click", () => {
    saveApiBase(byId("apiBase").value);
    setOut("cfgOut", { ok: true, apiBase: apiBase() }, "ok");
  });

  byId("btnResetApi")?.addEventListener("click", () => {
    saveApiBase(guessApiBase());
    setOut("cfgOut", { ok: true, apiBase: apiBase() }, "ok");
  });

  byId("btnHealth")?.addEventListener("click", onHealth);
  byId("btnRoutes")?.addEventListener("click", onRoutes);

  byId("btnCreateProduct")?.addEventListener("click", onCreateProduct);
  byId("btnLoadProductsMin")?.addEventListener("click", onProductsMin);

  const btnTbl = byId("btnLoadProductsTable");
  if (btnTbl) btnTbl.addEventListener("click", onProductsTable);

  byId("btnCreateMovement")?.addEventListener("click", onCreateMovement);
  byId("btnLoadBalance")?.addEventListener("click", onBalance);
  byId("btnLoadStatement")?.addEventListener("click", onStatement);

  const applyRoute = () => showPage(routeNameFromHash());
  window.addEventListener("hashchange", applyRoute);
  applyRoute();
}

document.addEventListener("DOMContentLoaded", () => {
  loadApiBase();
  setApiPill("warn", "API: não testada");
  wire();

  if (!window.location.hash) window.location.hash = "#/config";
});
