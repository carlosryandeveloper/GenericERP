const byId = (id) => document.getElementById(id);

const FALLBACK_LOCAL = "http://localhost:8000";
const LS_API_BASE = "genericerp.apiBase";
const LS_TOKEN = "genericerp.token";
const SS_FLASH = "genericerp.flash";

const ROUTES = {
  login: { title: "Login", desc: "Entre com seu e-mail e senha." },
  register: { title: "Criar conta", desc: "Cadastro com confirmação por e-mail." },
  forgot: { title: "Esqueci minha senha", desc: "Envio de token de 6 dígitos por e-mail." },
  reset: { title: "Redefinir senha", desc: "Informe token (6 dígitos) e defina a nova senha." },

  config: { title: "Configuração", desc: "Defina a API Base e valide a conexão." },
  products: { title: "Produtos", desc: "Crie produtos e consulte listas em tabela." },
  movements: { title: "Movimentações", desc: "Lance IN/OUT/ADJUST e veja validações." },
  balance: { title: "Saldo", desc: "Saldo por produto (por usuário)." },
  statement: { title: "Extrato", desc: "Extrato do produto com saldo acumulado (por usuário)." },
};

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

function apiBase() {
  return normalizeBase(byId("apiBase")?.value || "");
}

function loadApiBase() {
  const stored = localStorage.getItem(LS_API_BASE);
  const v = normalizeBase(stored || "") || normalizeBase(guessApiBase());
  if (byId("apiBase")) byId("apiBase").value = v;
}

function saveApiBase(value) {
  const v = normalizeBase(value);
  localStorage.setItem(LS_API_BASE, v);
  if (byId("apiBase")) byId("apiBase").value = v;
}

function getToken() {
  return localStorage.getItem(LS_TOKEN) || "";
}

function setToken(t) {
  if (!t) localStorage.removeItem(LS_TOKEN);
  else localStorage.setItem(LS_TOKEN, t);
}

function isLoggedIn() {
  return !!getToken();
}

function flash(msg) {
  sessionStorage.setItem(SS_FLASH, msg);
}
function consumeFlash() {
  const v = sessionStorage.getItem(SS_FLASH) || "";
  sessionStorage.removeItem(SS_FLASH);
  return v;
}

async function fetchJson(path, opts = {}) {
  const base = apiBase();
  if (!base) throw new Error("API Base vazia");

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
    try { data = text ? JSON.parse(text) : null; }
    catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.detail ? `${res.status} ${pretty(data.detail)}` : `${res.status} ${res.statusText}`;
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
   TABELA (v0.2 mantida)
   ======================= */
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

function isProtectedRoute(name) {
  return ["products", "movements", "balance", "statement"].includes(name);
}

function updateNavAuthState() {
  const logged = isLoggedIn();
  document.querySelectorAll('.navLink[data-protected="1"]').forEach((a) => {
    a.style.display = logged ? "" : "none";
  });
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

/* =======================
   HANDLERS (API util)
   ======================= */
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

/* =======================
   AUTH (v0.3)
   ======================= */
async function onRegister() {
  setOut("registerOut", "Criando conta...", "ok");

  const email = (byId("regEmail").value || "").trim();
  const password = (byId("regPass").value || "").trim();

  try {
    const data = await fetchJson("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setOut("registerOut", data, "ok");
    flash("Conta criada. Verifique seu e-mail de confirmação e volte para o login.");
    window.location.hash = "#/login";
  } catch (e) {
    // e-mail já existe -> orienta pro esqueci senha
    if (e.status === 409) {
      const detail = e.data?.detail;
      const msg =
        (typeof detail === "object" && (detail.message || detail.hint))
          ? `${detail.message || ""}\n${detail.hint || ""}`.trim()
          : "Já existe uma conta com esse e-mail. Use 'Esqueci minha senha' para redefinir.";

      setOut("registerOut", { erro: msg }, "err");

      if (byId("fpEmail")) byId("fpEmail").value = email;
      flash(msg);
      window.location.hash = "#/forgot";
      return;
    }

    setOut("registerOut", { error: e.message, data: e.data }, "err");
  }
}

async function onLogin() {
  setOut("loginOut", "Entrando...", "ok");

  const email = (byId("loginEmail").value || "").trim();
  const password = (byId("loginPass").value || "").trim();

  try {
    const data = await fetchJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setToken(data.access_token || "");
    updateNavAuthState();

    flash("Login feito. Indo para Produtos.");
    window.location.hash = "#/products";
  } catch (e) {
    setToken("");
    updateNavAuthState();
    setOut("loginOut", { error: e.message, data: e.data }, "err");
  }
}

async function onMe() {
  setOut("loginOut", "Chamando /auth/me ...", "ok");
  try {
    const data = await fetchJson("/auth/me");
    setOut("loginOut", data, "ok");
  } catch (e) {
    setOut("loginOut", { error: e.message, data: e.data }, "err");
  }
}

async function onLogout() {
  setOut("loginOut", "Saindo...", "ok");
  try {
    await fetchJson("/auth/logout", { method: "POST" });
  } catch {
    // não trava
  }
  setToken("");
  updateNavAuthState();
  flash("Saiu. Voltando ao login.");
  window.location.hash = "#/login";
}

async function onForgotSend() {
  setOut("forgotOut", "Enviando token...", "ok");
  const email = (byId("fpEmail").value || "").trim();

  try {
    const data = await fetchJson("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    setOut("forgotOut", data, "ok");
    if (byId("rpEmail")) byId("rpEmail").value = email;

    flash("Se o e-mail existir, você vai receber um token de 6 dígitos. Agora preencha e redefina a senha.");
    window.location.hash = "#/reset";
  } catch (e) {
    setOut("forgotOut", { error: e.message, data: e.data }, "err");
  }
}

async function onResetPass() {
  setOut("resetOut", "Alterando senha...", "ok");

  const email = (byId("rpEmail").value || "").trim();
  const token = (byId("rpToken").value || "").trim();
  const new_password = (byId("rpNewPass").value || "").trim();

  try {
    const data = await fetchJson("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, token, new_password }),
    });

    setOut("resetOut", data, "ok");
    flash("Senha alterada. Volte pro login e entre.");
    window.location.hash = "#/login";
  } catch (e) {
    setOut("resetOut", { error: e.message, data: e.data }, "err");
  }
}

/* =======================
   PRODUCTS / MOV / BAL / STAT (v0.2 mantido)
   ======================= */
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
  const mount = byId("productsMinTable");
  setOut("productsMinMsg", "Carregando /products/min (tabela)...", "ok");
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/products/min");
    renderTable({
      mountEl: mount,
      rows,
      columns: [
        { key: "id", title: "ID", className: "num" },
        { key: "name", title: "Nome" },
        { key: "unit", title: "Unidade" },
      ],
      filterKeys: ["id", "name", "unit"],
      emptyText: "Nenhum produto ainda.",
    });
    setOut("productsMinMsg", "Tabela carregada.", "ok");
  } catch (e) {
    setOut("productsMinMsg", { error: e.message, data: e.data }, "err");
    if (mount) mount.innerHTML = "";
  }
}

async function onProductsTable() {
  const mount = byId("productsTable");
  setOut("productsTableMsg", "Carregando /products (tabela)...", "ok");
  if (mount) mount.innerHTML = "";

  try {
    const rows = await fetchJson("/products");
    renderTable({
      mountEl: mount,
      rows,
      columns: [
        { key: "id", title: "ID", className: "num" },
        { key: "sku", title: "SKU" },
        { key: "name", title: "Nome" },
        { key: "unit", title: "Unidade" },
      ],
      filterKeys: ["id", "sku", "name", "unit"],
      emptyText: "Nenhum produto ainda.",
    });
    setOut("productsTableMsg", "Tabela carregada.", "ok");
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

/* =======================
   BOOT
   ======================= */
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

  // auth routing buttons
  byId("btnGoForgot")?.addEventListener("click", () => (window.location.hash = "#/forgot"));
  byId("btnGoRegister")?.addEventListener("click", () => (window.location.hash = "#/register"));
  byId("btnBackLoginFromRegister")?.addEventListener("click", () => (window.location.hash = "#/login"));
  byId("btnBackLoginFromForgot")?.addEventListener("click", () => (window.location.hash = "#/login"));
  byId("btnBackLoginFromReset")?.addEventListener("click", () => (window.location.hash = "#/login"));

  // auth actions
  byId("btnRegisterConfirm")?.addEventListener("click", onRegister);
  byId("btnLogin")?.addEventListener("click", onLogin);
  byId("btnMe")?.addEventListener("click", onMe);
  byId("btnLogout")?.addEventListener("click", onLogout);
  byId("btnForgotSend")?.addEventListener("click", onForgotSend);
  byId("btnResetPass")?.addEventListener("click", onResetPass);

  // products
  byId("btnCreateProduct")?.addEventListener("click", onCreateProduct);
  byId("btnLoadProductsMin")?.addEventListener("click", onProductsMin);
  byId("btnLoadProductsTable")?.addEventListener("click", onProductsTable);

  // movements/balance/statement
  byId("btnCreateMovement")?.addEventListener("click", onCreateMovement);
  byId("btnLoadBalance")?.addEventListener("click", onBalance);
  byId("btnLoadStatement")?.addEventListener("click", onStatement);

  const applyRoute = () => {
    let name = routeNameFromHash();

    if (isProtectedRoute(name) && !isLoggedIn()) {
      flash("Você precisa estar logado para acessar essa tela.");
      name = "login";
      window.location.hash = "#/login";
    }

    showPage(name);
    updateNavAuthState();

    const msg = consumeFlash();
    if (msg) {
      const out =
        name === "login" ? "loginOut" :
        name === "register" ? "registerOut" :
        name === "forgot" ? "forgotOut" :
        name === "reset" ? "resetOut" : null;

      if (out) setOut(out, { info: msg }, "ok");
    }
  };

  window.addEventListener("hashchange", applyRoute);
  applyRoute();
}

document.addEventListener("DOMContentLoaded", () => {
  loadApiBase();
  setApiPill("warn", "API: não testada");
  updateNavAuthState();
  wire();

  if (!window.location.hash) window.location.hash = "#/login";
});
