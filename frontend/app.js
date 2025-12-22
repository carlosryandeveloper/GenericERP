const byId = (id) => document.getElementById(id);

const FALLBACK_LOCAL = "http://localhost:8000";
const LS_API_BASE = "genericerp.apiBase";

const ROUTES = {
  config: { title: "Configuração", desc: "Defina a API Base e valide a conexão." },
  products: { title: "Produtos", desc: "Crie produtos e consulte listas em tabela." },
  movements: { title: "Movimentações", desc: "Lance IN/OUT/ADJUST e veja validações." },
  balance: { title: "Saldo", desc: "Saldo por produto (ID, Produto, Unidade, Saldo)." },
  statement: { title: "Extrato", desc: "Extrato do produto com saldo acumulado." },
};

function guessApiBase() {
  const raw = window.location.origin;
  if (raw.includes(".app.github.dev")) return raw.replace(/-\d+\./, "-8000.");
  return FALLBACK_LOCAL;
}

function normalizeBase(url) {
  let u = (url || "").trim();
  if (!u) return "";

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

function setOut(elId, value, kind = "ok") {
  const el = byId(elId);
  if (!el) return;

  el.classList.remove("empty", "ok", "err", "hidden");

  if (value === null || value === undefined || value === "") {
    el.textContent = "";
    el.classList.add("empty");
    return;
  }

  el.textContent = String(value);
  el.classList.add(kind === "err" ? "err" : "ok");
}

function setNotice(elId, value, kind = "ok", autoHideMs = 3200) {
  const el = byId(elId);
  if (!el) return;

  el.classList.add("notice");
  setOut(elId, value, kind);

  if (autoHideMs && autoHideMs > 0) {
    const prev = el.dataset.hideTimer ? Number(el.dataset.hideTimer) : null;
    if (prev) clearTimeout(prev);

    const t = setTimeout(() => {
      el.classList.add("hidden");
    }, autoHideMs);

    el.dataset.hideTimer = String(t);
  }
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

const fmtDateTime = (iso) => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" })
      .format(new Date(iso));
  } catch {
    return String(iso);
  }
};

/* =========================================================
   Mensagens amigáveis (erro/sucesso)
   ========================================================= */

function isNetworkError(e) {
  const msg = String(e?.message || "");
  return msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("abort");
}

function pickDetail(obj) {
  if (!obj || typeof obj !== "object") return "";
  return (
    obj.detail ||
    obj.Detail ||
    obj.detalhe ||
    obj.Detalhe ||
    obj.message ||
    obj.mensagem ||
    ""
  );
}

function humanizeCreateProductError(e) {
  if (isNetworkError(e)) {
    return "❌ Não consegui falar com a API.\nVerifique a API Base e se o backend está rodando (porta 8000).";
  }

  const status = e?.status;
  const detail = pickDetail(e?.data) || String(e?.message || "");
  const d = String(detail).toLowerCase();

  if (status === 409) return "❌ SKU já existe.\nUse um SKU diferente (ele precisa ser único).";

  if (d.includes("sku is required") || (d.includes("sku") && d.includes("required"))) {
    return "❌ SKU é obrigatório.\nPreencha o campo SKU (ex.: CANETA_AZUL).";
  }
  if (d.includes("invalid sku format") || (d.includes("sku") && d.includes("format"))) {
    return "❌ SKU inválido.\nUse 2 a 32 caracteres, sem espaços, e somente A-Z, 0-9, . _ -";
  }
  if (d.includes("name is required") || (d.includes("name") && d.includes("required"))) {
    return "❌ Nome é obrigatório.\nPreencha o nome do produto.";
  }
  if (d.includes("unit is required") || (d.includes("unit") && d.includes("required"))) {
    return "❌ Unidade é obrigatória.\nPreencha a unidade (ex.: UN, KG, LT).";
  }

  return `❌ Não foi possível criar o produto.\nMotivo: ${detail || "erro desconhecido"}`;
}

function successCreateProductMsg(p) {
  const id = p?.id ?? "?";
  const sku = p?.sku ?? "-";
  const name = p?.name ?? p?.nome ?? "-";
  const unit = p?.unit ?? p?.unidade ?? "-";

  return (
    "✅ Produto criado com sucesso!\n" +
    `• ID: ${id}\n` +
    `• SKU: ${sku}\n` +
    `• Produto: ${name}\n` +
    `• Unidade: ${unit}`
  );
}

/* =========================================================
   Tabelas
   ========================================================= */

function renderTable({ mountEl, columns, rows, emptyText = "Sem dados.", filterKeys = [], countLabel = "registro" }) {
  if (!mountEl) return;

  let state = { q: "", sortKey: null, sortDir: "asc" };

  const wrap = document.createElement("div");

  const label = rows.length === 1 ? countLabel : (countLabel + "s");

  const toolbar = document.createElement("div");
  toolbar.className = "table-toolbar";
  toolbar.innerHTML = `
    <input type="text" placeholder="Pesquisar..." />
    <div class="muted"><span class="mono">${rows.length}</span> ${label}</div>
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
    setOut("cfgOut", "✅ API OK.\n" + JSON.stringify(data, null, 2), "ok");
    setApiPill("ok", `API: OK (${apiBase()})`);
  } catch (e) {
    setOut("cfgOut", `❌ Erro ao chamar /health.\n${e.message}`, "err");
    setApiPill("err", `API: erro (${apiBase() || "sem base"})`);
  }
}

async function onRoutes() {
  setOut("cfgOut", "Carregando rotas...", "ok");
  try {
    const data = await fetchJson("/debug/routes");
    setOut("cfgOut", "✅ Rotas carregadas.\n" + JSON.stringify(data, null, 2), "ok");
  } catch (e) {
    setOut("cfgOut", `❌ Erro ao buscar rotas.\n${e.message}`, "err");
  }
}

async function onCreateProduct() {
  const sku = (byId("pSku")?.value || "").trim();
  const name = (byId("pName")?.value || "").trim();
  const unit = (byId("pUnit")?.value || "").trim();

  if (!sku || !name || !unit) {
    setOut(
      "productOut",
      "❌ Preencha SKU, Nome e Unidade.\nDica: o texto cinza é só exemplo (placeholder), não é valor preenchido.",
      "err"
    );
    return;
  }

  setOut("productOut", "Criando produto...", "ok");

  try {
    const payload = { sku, name, unit };
    const data = await fetchJson("/products", { method: "POST", body: JSON.stringify(payload) });

    setOut("productOut", successCreateProductMsg(data), "ok");
    setNotice("productsMinMsg", "✅ Produto criado. Atualizando listas…", "ok", 1600);

    byId("pSku").value = "";
    byId("pName").value = "";
    byId("pUnit").value = "";
    byId("pSku")?.focus();

    onProductsMin().catch(() => {});
    onProductsTable().catch(() => {});
    onBalance().catch(() => {});
  } catch (e) {
    setOut("productOut", humanizeCreateProductError(e), "err");
  }
}

/* Lista rápida com SKU (usa /products, pois /products/min não traz sku) */
async function onProductsMin() {
  const mount = byId("productsMinTable");
  setNotice("productsMinMsg", "Carregando lista…", "ok", 1200);
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/products");

    renderTable({
      mountEl: mount,
      rows,
      countLabel: "produto",
      columns: [
        { key: "id", title: "ID", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "sku", title: "SKU", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "name", title: "Produto" },
        { key: "unit", title: "Unidade", render: (v) => `<span class="kbd">${v ?? ""}</span>` },
      ],
      filterKeys: ["id", "sku", "name", "unit"],
      emptyText: "Nenhum produto ainda.",
    });

    setNotice("productsMinMsg", "✅ Lista carregada.", "ok", 2200);
  } catch (e) {
    setNotice("productsMinMsg", `❌ Erro ao carregar lista.\n${e.message}`, "err", 4000);
    if (mount) mount.innerHTML = "";
  }
}

async function onProductsTable() {
  const mount = byId("productsTable");
  setNotice("productsTableMsg", "Carregando produtos…", "ok", 1200);
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/products");

    renderTable({
      mountEl: mount,
      rows,
      countLabel: "produto",
      columns: [
        { key: "id", title: "ID", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "sku", title: "SKU", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "name", title: "Produto" },
        { key: "unit", title: "Unidade", render: (v) => `<span class="kbd">${v ?? ""}</span>` },
        { key: "created_at", title: "Criado em", render: (v) => `<span class="mono">${fmtDateTime(v)}</span>` },
      ],
      filterKeys: ["id", "sku", "name", "unit", "created_at"],
      emptyText: "Nenhum produto ainda.",
    });

    setNotice("productsTableMsg", "✅ Tabela carregada.", "ok", 2200);
  } catch (e) {
    setNotice("productsTableMsg", `❌ Erro ao carregar tabela.\n${e.message}`, "err", 4000);
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

    if (!Number.isFinite(product_id) || product_id <= 0) throw new Error("ID do produto inválido");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantidade inválida");

    const payload = { product_id, type, quantity };
    if (note) payload.note = note;

    const data = await fetchJson("/stock/movements", { method: "POST", body: JSON.stringify(payload) });
    setOut("movementOut", "✅ Movimentação registrada.\n" + JSON.stringify(data, null, 2), "ok");

    onBalance().catch(() => {});
  } catch (e) {
    setOut("movementOut", `❌ Erro na movimentação.\n${e.message}`, "err");
  }
}

async function onBalance() {
  const mount = byId("balanceTable");
  setNotice("balanceMsg", "Carregando saldo…", "ok", 1200);
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/stock/balance");

    renderTable({
      mountEl: mount,
      rows,
      countLabel: "produto",
      columns: [
        { key: "product_id", title: "ID", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
        { key: "name", title: "Produto" },
        { key: "unit", title: "Unidade", render: (v) => `<span class="kbd">${v ?? ""}</span>` },
        { key: "balance", title: "Saldo", className: "num", render: (v) => `<span class="mono">${v ?? ""}</span>` },
      ],
      filterKeys: ["product_id", "name", "unit", "balance"],
      emptyText: "Sem saldo para exibir.",
    });

    setNotice("balanceMsg", "✅ Saldo carregado.", "ok", 2200);
  } catch (e) {
    setNotice("balanceMsg", `❌ Erro ao carregar saldo.\n${e.message}`, "err", 4000);
    if (mount) mount.innerHTML = "";
  }
}

async function onStatement() {
  setOut("statementOut", "Carregando extrato...", "ok");
  try {
    const product_id = parseInt(byId("sProductId").value, 10);
    if (!Number.isFinite(product_id) || product_id <= 0) throw new Error("ID do produto inválido");

    const from = (byId("sFrom").value || "").trim();
    const to = (byId("sTo").value || "").trim();

    const params = new URLSearchParams({ product_id: String(product_id) });
    if (from) params.set("from_date", from);
    if (to) params.set("to_date", to);

    const data = await fetchJson("/stock/statement?" + params.toString());
    setOut("statementOut", "✅ Extrato carregado.\n" + JSON.stringify(data, null, 2), "ok");
  } catch (e) {
    setOut("statementOut", `❌ Erro ao carregar extrato.\n${e.message}`, "err");
  }
}

/* =========================================================
   Boot
   ========================================================= */

function wire() {
  byId("btnSaveApi")?.addEventListener("click", () => {
    saveApiBase(byId("apiBase").value);
    setOut("cfgOut", `✅ Configurado.\nAPI Base: ${apiBase()}`, "ok");
  });

  byId("btnResetApi")?.addEventListener("click", () => {
    saveApiBase(guessApiBase());
    setOut("cfgOut", `✅ Resetado.\nAPI Base: ${apiBase()}`, "ok");
  });

  byId("btnHealth")?.addEventListener("click", onHealth);
  byId("btnRoutes")?.addEventListener("click", onRoutes);

  byId("btnCreateProduct")?.addEventListener("click", onCreateProduct);
  byId("btnLoadProductsMin")?.addEventListener("click", onProductsMin);
  byId("btnLoadProductsTable")?.addEventListener("click", onProductsTable);

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
