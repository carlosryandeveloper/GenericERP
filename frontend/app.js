const byId = (id) => document.getElementById(id);

const FALLBACK_LOCAL = "http://localhost:8000";
const LS_API_BASE = "genericerp.apiBase";
const LS_TOKEN = "genericerp.token";

const ROUTES = {
  login:      { title: "Login", desc: "Entre com seu e-mail e senha." },
  register:   { title: "Criar conta", desc: "Cadastro com validação de e-mail." },
  forgot:     { title: "Esqueci minha senha", desc: "Envio de código de 6 dígitos por e-mail." },
  reset:      { title: "Redefinir senha", desc: "Informe e-mail, código e a nova senha." },

  products:   { title: "Produtos", desc: "Cadastros e listagens. Agora com preço e categoria." },
  categories: { title: "Categorias", desc: "Desconto automático por categoria (editável no orçamento)." },
  quotes:     { title: "Orçamentos", desc: "Documento com itens, descontos e totais." },

  movements:  { title: "Movimentações", desc: "IN/OUT/ADJUST." },
  balance:    { title: "Saldo", desc: "Saldo por produto." },
  statement:  { title: "Extrato", desc: "Histórico com saldo acumulado." },

  logout:     { title: "Sair", desc: "Encerrar sessão." },
};

let currentQuoteId = null;
let productsCache = [];
let categoriesCache = [];

function guessApiBase() {
  const raw = window.location.origin;
  if (raw.includes(".app.github.dev")) return raw.replace(/-\d+\./, "-8000.");
  return FALLBACK_LOCAL;
}

function normalizeBase(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

function apiBase() {
  const stored = normalizeBase(localStorage.getItem(LS_API_BASE) || "");
  return stored || guessApiBase();
}

function getToken() {
  return localStorage.getItem(LS_TOKEN) || "";
}

function setToken(t) {
  if (!t) localStorage.removeItem(LS_TOKEN);
  else localStorage.setItem(LS_TOKEN, t);
}

function showNotice(elId, kind, msg) {
  const el = byId(elId);
  if (!el) return;
  el.classList.remove("hidden", "ok", "err");
  el.classList.add(kind === "err" ? "err" : "ok");
  el.textContent = msg;
}

function hideNotice(elId) {
  const el = byId(elId);
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
  el.classList.remove("ok", "err");
}

async function fetchJson(path, opts = {}) {
  const base = apiBase();
  const url = base + path;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const token = getToken();
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["Authorization"] = "Bearer " + token;

    const res = await fetch(url, { ...opts, signal: controller.signal, headers });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.detail ? `${res.status} ${data.detail}` : `${res.status} ${res.statusText}`;
      const e = new Error(msg);
      e.status = res.status;
      e.data = data;

      if (res.status === 401) setToken("");

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

/* =======================
   TABELA
   ======================= */
function renderTable({ mountEl, columns, rows, emptyText = "Sem dados.", filterKeys = [], onRowClick = null }) {
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
      if (state.sortKey === c.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = c.key; state.sortDir = "asc"; }
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
      if (onRowClick) {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => onRowClick(r));
      }
      columns.forEach((c) => {
        const td = document.createElement("td");
        const raw = r?.[c.key];
        if (c.className) td.className = c.className;
        td.textContent = raw == null ? "" : String(raw);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  paint();
}

/* =======================
   ROUTING
   ======================= */
function routeNameFromHash() {
  const h = (window.location.hash || "").trim();
  const m = h.match(/^#\/([a-z-]+)/i);
  const name = m ? m[1] : "login";
  return ROUTES[name] ? name : "login";
}

function isAuthRoute(name) {
  return ["login","register","forgot","reset"].includes(name);
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => {
    p.style.display = (p.dataset.page === name) ? "block" : "none";
  });

  document.querySelectorAll(".navLink").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
  });

  const meta = ROUTES[name];
  byId("pageTitle").textContent = meta.title;
  byId("pageDesc").textContent = meta.desc;

  document.body.classList.toggle("auth-mode", isAuthRoute(name));

  if (name === "logout") {
    setToken("");
    window.location.hash = "#/login";
    return;
  }
}

/* =======================
   AUTH
   ======================= */
async function onLogin() {
  hideNotice("loginNotice");
  try {
    const payload = {
      email: (byId("loginEmail").value || "").trim(),
      password: (byId("loginPass").value || "").trim(),
    };
    const data = await fetchJson("/auth/login", { method: "POST", body: JSON.stringify(payload) });
    setToken(data.access_token || "");
    showNotice("loginNotice", "ok", "Login realizado. Indo para Produtos...");
    window.location.hash = "#/products";
  } catch (e) {
    showNotice("loginNotice", "err", e.message);
  }
}

async function onRegister() {
  hideNotice("regNotice");
  try {
    const payload = {
      email: (byId("regEmail").value || "").trim(),
      password: (byId("regPass").value || "").trim(),
    };
    const data = await fetchJson("/auth/register", { method: "POST", body: JSON.stringify(payload) });
    showNotice("regNotice", "ok", data?.message || "Conta criada.");
    // volta pro login
    setTimeout(() => (window.location.hash = "#/login"), 700);
  } catch (e) {
    showNotice("regNotice", "err", e.message);
    // dica direta:
    if ((e.message || "").includes("já cadastrado")) {
      // encaminha pro forgot
      setTimeout(() => (window.location.hash = "#/forgot"), 900);
    }
  }
}

async function onSendCode() {
  hideNotice("fpNotice");
  try {
    const payload = { email: (byId("fpEmail").value || "").trim() };
    const data = await fetchJson("/auth/forgot-password", { method: "POST", body: JSON.stringify(payload) });
    showNotice("fpNotice", "ok", data?.message || "Se existir, enviaremos o código.");
    window.location.hash = "#/reset";
    byId("rpEmail").value = payload.email;
  } catch (e) {
    showNotice("fpNotice", "err", e.message);
  }
}

async function onResetPassword() {
  hideNotice("rpNotice");
  try {
    const payload = {
      email: (byId("rpEmail").value || "").trim(),
      code: (byId("rpCode").value || "").trim(),
      new_password: (byId("rpPass").value || "").trim(),
    };
    const data = await fetchJson("/auth/reset-password", { method: "POST", body: JSON.stringify(payload) });
    showNotice("rpNotice", "ok", data?.message || "Senha atualizada.");
    setTimeout(() => (window.location.hash = "#/login"), 800);
  } catch (e) {
    showNotice("rpNotice", "err", e.message);
  }
}

/* =======================
   DATA LOADERS
   ======================= */
async function loadCategories() {
  categoriesCache = await fetchJson("/categories");
  const sel = byId("pCategory");
  if (sel) {
    sel.innerHTML = "";
    categoriesCache.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} ${c.auto_discount_enabled ? `(${c.default_discount_percent}%)` : ""}`;
      sel.appendChild(opt);
    });
  }

  const mount = byId("catTable");
  if (mount) {
    renderTable({
      mountEl: mount,
      rows: categoriesCache.map((c) => ({
        id: c.id,
        name: c.name,
        auto: c.auto_discount_enabled ? "Sim" : "Não",
        disc: c.default_discount_percent,
      })),
      columns: [
        { key: "id", title: "ID", className: "num" },
        { key: "name", title: "Categoria" },
        { key: "auto", title: "Auto?" },
        { key: "disc", title: "% padrão", className: "num" },
      ],
      filterKeys: ["id","name","auto","disc"],
      emptyText: "Nenhuma categoria ainda.",
    });
  }
}

async function loadProductsMin() {
  productsCache = await fetchJson("/products/min");
  const sel = byId("qiProduct");
  if (sel) {
    sel.innerHTML = "";
    productsCache.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.sku} • ${p.name} (${p.unit}) • ${p.category_name}`;
      sel.appendChild(opt);
    });
  }
}

async function loadProductsTable() {
  const mount = byId("prodTable");
  const rows = await fetchJson("/products/min");
  renderTable({
    mountEl: mount,
    rows: rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      price: p.price,
      category: p.category_name,
      auto_disc: p.auto_discount_enabled ? `${p.default_discount_percent}%` : "—",
    })),
    columns: [
      { key: "id", title: "ID", className: "num" },
      { key: "sku", title: "SKU" },
      { key: "name", title: "Nome" },
      { key: "unit", title: "Unidade" },
      { key: "price", title: "Preço", className: "num" },
      { key: "category", title: "Categoria" },
      { key: "auto_disc", title: "Desc. padrão" },
    ],
    filterKeys: ["id","sku","name","unit","price","category","auto_disc"],
    emptyText: "Nenhum produto ainda.",
  });
}

/* =======================
   CATEGORIES
   ======================= */
async function onCreateCategory() {
  hideNotice("catNotice");
  try {
    const payload = {
      name: (byId("cName").value || "").trim(),
      auto_discount_enabled: byId("cAuto").value === "true",
      default_discount_percent: parseNumber(byId("cDisc").value || "0") || 0,
    };
    await fetchJson("/categories", { method: "POST", body: JSON.stringify(payload) });
    showNotice("catNotice", "ok", "Categoria criada.");
    await loadCategories();
  } catch (e) {
    showNotice("catNotice", "err", e.message);
  }
}

/* =======================
   PRODUCTS
   ======================= */
async function onCreateProduct() {
  hideNotice("prodNotice");
  try {
    const payload = {
      sku: (byId("pSku").value || "").trim(),
      name: (byId("pName").value || "").trim(),
      unit: byId("pUnit").value,
      price: parseNumber(byId("pPrice").value),
      category_id: parseInt(byId("pCategory").value, 10),
      pack_factor: parseNumber(byId("pPack").value || "1") || 1,
    };

    if (!Number.isFinite(payload.price)) throw new Error("Preço inválido.");

    await fetchJson("/products", { method: "POST", body: JSON.stringify(payload) });
    showNotice("prodNotice", "ok", "Produto criado.");
    await loadProductsMin();
    await loadProductsTable();
  } catch (e) {
    showNotice("prodNotice", "err", e.message);
  }
}

/* =======================
   QUOTES
   ======================= */
function syncAutoFillFromProduct() {
  const sel = byId("qiProduct");
  if (!sel) return;
  const pid = parseInt(sel.value, 10);
  const p = productsCache.find((x) => x.id === pid);
  if (!p) return;

  // preço default do produto
  if (!byId("qiPrice").value) byId("qiPrice").value = String(p.price ?? "");

  // desconto default da categoria (se auto)
  const d = p.auto_discount_enabled ? (p.default_discount_percent ?? 0) : 0;
  if (!byId("qiDisc").value) byId("qiDisc").value = String(d);
}

async function onCreateQuote() {
  hideNotice("quoteNotice");
  try {
    const payload = {
      customer_name: (byId("qCustomer").value || "").trim(),
      customer_email: (byId("qEmail").value || "").trim() || null,
      valid_days: parseInt(byId("qValid").value || "7", 10),
      notes: (byId("qNotes").value || "").trim() || null,
    };
    const q = await fetchJson("/quotes", { method: "POST", body: JSON.stringify(payload) });

    currentQuoteId = q.id;
    byId("currentQuote").textContent = String(currentQuoteId);
    byId("qStatus").value = q.status || "DRAFT";
    showNotice("quoteNotice", "ok", `Orçamento #${q.id} criado (DRAFT).`);

    await loadQuotes();
    await loadQuoteDetails();
  } catch (e) {
    showNotice("quoteNotice", "err", e.message);
  }
}

async function loadQuotes() {
  const rows = await fetchJson("/quotes");
  const mount = byId("quotesTable");
  renderTable({
    mountEl: mount,
    rows: rows.map((q) => ({
      id: q.id,
      cliente: q.customer_name,
      status: q.status,
      total: (q.total_net ?? 0).toFixed ? q.total_net.toFixed(2) : q.total_net,
      emissao: q.issued_at,
      validade: q.valid_until,
    })),
    columns: [
      { key: "id", title: "ID", className: "num" },
      { key: "cliente", title: "Cliente" },
      { key: "status", title: "Status" },
      { key: "total", title: "Total", className: "num" },
      { key: "emissao", title: "Emissão" },
      { key: "validade", title: "Validade" },
    ],
    filterKeys: ["id","cliente","status","total","emissao","validade"],
    emptyText: "Nenhum orçamento ainda.",
    onRowClick: (r) => {
      currentQuoteId = parseInt(r.id, 10);
      byId("currentQuote").textContent = String(currentQuoteId);
      loadQuoteDetails().catch(() => {});
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

async function loadQuoteDetails() {
  if (!currentQuoteId) return;

  const data = await fetchJson(`/quotes/${currentQuoteId}`);
  const q = data.quote;
  const items = data.items || [];

  byId("qStatus").value = q.status || "DRAFT";
  byId("qTotal").textContent = (q.total_net ?? 0).toFixed(2);

  const mount = byId("quoteItemsTable");
  renderTable({
    mountEl: mount,
    rows: items.map((i) => ({
      id: i.id,
      sku: i.sku_snapshot,
      produto: i.name_snapshot,
      qtd: i.quantity,
      preco: i.unit_price,
      desc: i.discount_percent,
      total: (i.net_total ?? 0).toFixed(2),
    })),
    columns: [
      { key: "id", title: "ID", className: "num" },
      { key: "sku", title: "SKU" },
      { key: "produto", title: "Produto" },
      { key: "qtd", title: "Qtd", className: "num" },
      { key: "preco", title: "Preço", className: "num" },
      { key: "desc", title: "Desc. %", className: "num" },
      { key: "total", title: "Total", className: "num" },
    ],
    filterKeys: ["id","sku","produto"],
    emptyText: "Nenhum item ainda.",
  });
}

async function onAddItem() {
  hideNotice("quoteNotice");
  try {
    if (!currentQuoteId) throw new Error("Crie ou selecione um orçamento antes.");

    const payload = {
      product_id: parseInt(byId("qiProduct").value, 10),
      quantity: parseNumber(byId("qiQty").value || "1"),
      unit_price: parseNumber(byId("qiPrice").value),
      discount_percent: parseNumber(byId("qiDisc").value),
    };

    if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) throw new Error("Qtd inválida.");

    // se o usuário deixar vazio, o backend preenche. Aqui só mandamos se for número:
    if (!Number.isFinite(payload.unit_price)) delete payload.unit_price;
    if (!Number.isFinite(payload.discount_percent)) delete payload.discount_percent;

    await fetchJson(`/quotes/${currentQuoteId}/items`, { method: "POST", body: JSON.stringify(payload) });
    showNotice("quoteNotice", "ok", "Item adicionado.");

    // limpa só quantidade, deixa preço/desc (pra agilizar)
    byId("qiQty").value = "";

    await loadQuoteDetails();
    await loadQuotes();
  } catch (e) {
    showNotice("quoteNotice", "err", e.message);
  }
}

async function onSetStatus() {
  hideNotice("quoteNotice");
  try {
    if (!currentQuoteId) throw new Error("Selecione um orçamento.");
    const payload = { status: byId("qStatus").value };
    await fetchJson(`/quotes/${currentQuoteId}/status`, { method: "PATCH", body: JSON.stringify(payload) });
    showNotice("quoteNotice", "ok", "Status atualizado.");
    await loadQuoteDetails();
    await loadQuotes();
  } catch (e) {
    showNotice("quoteNotice", "err", e.message);
  }
}

/* =======================
   STOCK
   ======================= */
async function onCreateMovement() {
  hideNotice("mvNotice");
  try {
    const payload = {
      product_id: parseInt(byId("mProductId").value, 10),
      type: byId("mType").value,
      quantity: parseNumber(byId("mQty").value),
      note: (byId("mNote").value || "").trim() || null,
    };
    if (!Number.isFinite(payload.product_id) || payload.product_id <= 0) throw new Error("product_id inválido.");
    if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) throw new Error("quantity inválida.");

    await fetchJson("/stock/movements", { method: "POST", body: JSON.stringify(payload) });
    showNotice("mvNotice", "ok", "Movimentação lançada.");
  } catch (e) {
    showNotice("mvNotice", "err", e.message);
  }
}

async function onLoadBalance() {
  const data = await fetchJson("/stock/balance");
  const mount = byId("balanceTable");
  renderTable({
    mountEl: mount,
    rows: data.map((r) => ({
      id: r.product_id,
      sku: r.sku,
      nome: r.name,
      saldo: r.balance,
    })),
    columns: [
      { key: "id", title: "ID", className: "num" },
      { key: "sku", title: "SKU" },
      { key: "nome", title: "Produto" },
      { key: "saldo", title: "Saldo", className: "num" },
    ],
    filterKeys: ["id","sku","nome"],
    emptyText: "Sem dados.",
  });
}

async function onLoadStatement() {
  const product_id = parseInt(byId("sProductId").value, 10);
  if (!Number.isFinite(product_id) || product_id <= 0) throw new Error("product_id inválido");

  const from = (byId("sFrom").value || "").trim();
  const to = (byId("sTo").value || "").trim();
  const params = new URLSearchParams({ product_id: String(product_id) });
  if (from) params.set("from_date", from);
  if (to) params.set("to_date", to);

  const data = await fetchJson("/stock/statement?" + params.toString());
  const mount = byId("statementTable");
  renderTable({
    mountEl: mount,
    rows: (data.lines || []).map((l) => ({
      id: l.id,
      data: l.created_at,
      tipo: l.type,
      qtd: l.quantity,
      sinal: l.signed_quantity,
      saldo: l.balance_after,
      obs: l.note || "",
    })),
    columns: [
      { key: "id", title: "ID", className: "num" },
      { key: "data", title: "Data" },
      { key: "tipo", title: "Tipo" },
      { key: "qtd", title: "Qtd", className: "num" },
      { key: "sinal", title: "Sinal", className: "num" },
      { key: "saldo", title: "Saldo", className: "num" },
      { key: "obs", title: "Obs" },
    ],
    filterKeys: ["id","tipo","obs"],
    emptyText: "Sem linhas.",
  });
}

/* =======================
   BOOT
   ======================= */
async function onEnterRoute(name) {
  // proteção: se não tiver token, joga pro login (exceto rotas de auth)
  if (!isAuthRoute(name) && !getToken()) {
    window.location.hash = "#/login";
    return;
  }

  // carregamentos por tela
  if (name === "categories") {
    await loadCategories();
  }

  if (name === "products") {
    await loadCategories();
    await loadProductsMin();
    await loadProductsTable();
  }

  if (name === "quotes") {
    await loadProductsMin();
    await loadQuotes();
    syncAutoFillFromProduct();
    await loadQuoteDetails().catch(() => {});
  }
}

function wire() {
  // auth nav
  byId("goForgot")?.addEventListener("click", () => (window.location.hash = "#/forgot"));
  byId("goRegister")?.addEventListener("click", () => (window.location.hash = "#/register"));
  byId("goReset")?.addEventListener("click", () => (window.location.hash = "#/reset"));
  byId("goLoginFromRegister")?.addEventListener("click", () => (window.location.hash = "#/login"));
  byId("goLoginFromForgot")?.addEventListener("click", () => (window.location.hash = "#/login"));
  byId("goLoginFromReset")?.addEventListener("click", () => (window.location.hash = "#/login"));

  byId("btnLogin")?.addEventListener("click", onLogin);
  byId("btnRegister")?.addEventListener("click", onRegister);
  byId("btnSendCode")?.addEventListener("click", onSendCode);
  byId("btnResetPass")?.addEventListener("click", onResetPassword);

  // categories
  byId("btnCreateCategory")?.addEventListener("click", onCreateCategory);
  byId("btnLoadCategories")?.addEventListener("click", () => loadCategories().catch(() => {}));

  // products
  byId("btnCreateProduct")?.addEventListener("click", onCreateProduct);
  byId("btnLoadProducts")?.addEventListener("click", () => loadProductsTable().catch(() => {}));

  // quotes
  byId("btnCreateQuote")?.addEventListener("click", onCreateQuote);
  byId("btnLoadQuotes")?.addEventListener("click", () => loadQuotes().catch(() => {}));
  byId("btnAddItem")?.addEventListener("click", onAddItem);
  byId("btnSetStatus")?.addEventListener("click", onSetStatus);
  byId("qiProduct")?.addEventListener("change", () => {
    byId("qiPrice").value = "";
    byId("qiDisc").value = "";
    syncAutoFillFromProduct();
  });

  // stock
  byId("btnCreateMovement")?.addEventListener("click", onCreateMovement);
  byId("btnLoadBalance")?.addEventListener("click", () => onLoadBalance().catch(() => {}));
  byId("btnLoadStatement")?.addEventListener("click", () => onLoadStatement().catch(() => {}));

  const applyRoute = async () => {
    const name = routeNameFromHash();
    showPage(name);
    await onEnterRoute(name);
  };

  window.addEventListener("hashchange", () => applyRoute().catch(() => {}));
  applyRoute().catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
  // fixa api base automaticamente (sem tela de config)
  if (!localStorage.getItem(LS_API_BASE)) {
    localStorage.setItem(LS_API_BASE, normalizeBase(guessApiBase()));
  }

  wire();
  if (!window.location.hash) window.location.hash = "#/login";
});
