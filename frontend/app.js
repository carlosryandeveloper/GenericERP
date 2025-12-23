const byId = (id) => document.getElementById(id);

const FALLBACK_LOCAL = "http://localhost:8000";
const LS_API_BASE = "genericerp.apiBase";
const LS_TOKEN = "genericerp.token";

const ROUTES = {
  login: { title: "Login", desc: "Entre com seu e-mail e senha." },
  register: { title: "Criar conta", desc: "Cadastro com confirmação por e-mail." },
  forgot: { title: "Esqueci minha senha", desc: "Envio de token (6 dígitos) para o e-mail." },
  reset: { title: "Redefinir senha", desc: "Informe token (6 dígitos) e defina a nova senha." },

  config: { title: "Configuração", desc: "Defina a API Base e valide a conexão." },
  products: { title: "Produtos", desc: "Crie produtos e consulte listas em tabela." },
  movements: { title: "Movimentações", desc: "Lance IN/OUT/ADJUST e veja validações." },
  balance: { title: "Saldo", desc: "Saldo por produto (por usuário)." },
  statement: { title: "Extrato", desc: "Extrato com período, saldo inicial e saldo final." },
};

function normalizeBase(v) {
  const s = (v || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function guessApiBase() {
  return normalizeBase(FALLBACK_LOCAL);
}

function apiBase() {
  return normalizeBase(byId("apiBase")?.value || localStorage.getItem(LS_API_BASE) || guessApiBase());
}

function setApiPill(kind, text) {
  const pill = byId("apiPill");
  const txt = byId("apiPillTxt");
  if (!pill || !txt) return;

  pill.dataset.kind = kind;
  txt.textContent = text || "";
}

function setOut(id, data, kind = "ok") {
  const el = byId(id);
  if (!el) return;

  el.classList.remove("ok", "err");
  el.classList.add(kind === "err" ? "err" : "ok");

  if (typeof data === "string") el.textContent = data;
  else el.textContent = JSON.stringify(data, null, 2);
}

function getToken() {
  return localStorage.getItem(LS_TOKEN) || "";
}

function setToken(t) {
  if (!t) localStorage.removeItem(LS_TOKEN);
  else localStorage.setItem(LS_TOKEN, t);
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

async function onHealth() {
  setApiPill("warn", "API: testando...");
  try {
    const data = await fetchJson("/health");
    setApiPill("ok", "API: ok");
    setOut("cfgOut", data, "ok");
  } catch (e) {
    setApiPill("err", "API: erro");
    setOut("cfgOut", { error: e.message, data: e.data }, "err");
  }
}

async function onRoutes() {
  setOut("cfgOut", "Carregando /debug/routes...", "ok");
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
function flash(msg) {
  sessionStorage.setItem("genericerp.flash", msg);
}
function consumeFlash() {
  const v = sessionStorage.getItem("genericerp.flash");
  sessionStorage.removeItem("genericerp.flash");
  return v || "";
}

function isLoggedIn() {
  return !!getToken();
}

function isProtectedRoute(name) {
  return ["products", "movements", "balance", "statement"].includes(name);
}

function updateNavAuthState() {
  const logged = isLoggedIn();

  document.querySelectorAll('.navLink[data-protected="1"]').forEach((a) => {
    a.style.display = logged ? "" : "none";
  });

  const hint = byId("loginTokenHint");
  if (hint) hint.textContent = logged ? "✅ token ativo" : "🔒 sem token";
}

async function onRegister() {
  setOut("registerOut", "Criando conta...", "ok");
  try {
    const payload = {
      email: (byId("regEmail").value || "").trim(),
      password: (byId("regPass").value || "").trim(),
    };

    const data = await fetchJson("/auth/register", { method: "POST", body: JSON.stringify(payload) });
    setOut("registerOut", data, "ok");

    flash("Conta criada. Confirmação enviada por e-mail (se o SMTP estiver configurado).");
    window.location.hash = "#/login";
  } catch (e) {
    setOut("registerOut", { error: e.message, data: e.data }, "err");
  }
}

async function onLogin() {
  setOut("loginOut", "Entrando...", "ok");
  try {
    const payload = {
      email: (byId("loginEmail").value || "").trim(),
      password: (byId("loginPass").value || "").trim(),
    };

    const data = await fetchJson("/auth/login", { method: "POST", body: JSON.stringify(payload) });
    setToken(data.access_token || "");

    updateNavAuthState();

    flash("Login feito. Bora operar.");
    window.location.hash = "#/products";
  } catch (e) {
    setToken("");
    updateNavAuthState();
    setOut("loginOut", { error: e.message, data: e.data }, "err");
  }
}

async function onMe() {
  setOut("loginOut", "Consultando /auth/me...", "ok");
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
  } catch { /* não trava */ }

  setToken("");
  updateNavAuthState();
  flash("Saiu. Volte sempre (com token).");
  window.location.hash = "#/login";
}

async function onForgot() {
  setOut("forgotOut", "Enviando token...", "ok");
  try {
    const email = (byId("fpEmail").value || "").trim();
    const payload = { email };

    const data = await fetchJson("/auth/forgot-password", { method: "POST", body: JSON.stringify(payload) });
    setOut("forgotOut", data, "ok");

    byId("rpEmail").value = email;
    flash("Token enviado (confira seu e-mail).");
    window.location.hash = "#/reset";
  } catch (e) {
    setOut("forgotOut", { error: e.message, data: e.data }, "err");
  }
}

async function onResetPass() {
  setOut("resetOut", "Alterando senha...", "ok");
  try {
    const payload = {
      email: (byId("rpEmail").value || "").trim(),
      token: (byId("rpToken").value || "").trim(),
      new_password: (byId("rpNewPass").value || "").trim(),
    };

    const data = await fetchJson("/auth/reset-password", { method: "POST", body: JSON.stringify(payload) });
    setOut("resetOut", data, "ok");

    flash("Senha alterada. Agora é login.");
    window.location.hash = "#/login";
  } catch (e) {
    setOut("resetOut", { error: e.message, data: e.data }, "err");
  }
}

/* =======================
   ROTAS / UI
   ======================= */
function routeNameFromHash() {
  const h = (window.location.hash || "").trim();
  const m = h.match(/^#\/([a-z-]+)/i);
  const name = m ? m[1] : "login";
  return ROUTES[name] ? name : "login";
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => {
    p.style.display = (p.dataset.page === name) ? "block" : "none";
  });

  document.querySelectorAll(".navLink").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
  });

  const t = ROUTES[name]?.title || "GenericERP";
  const d = ROUTES[name]?.desc || "";
  if (byId("pageTitle")) byId("pageTitle").textContent = t;
  if (byId("pageDesc")) byId("pageDesc").textContent = d;

  byId("apiBaseMini").textContent = apiBase() || "—";
}

function saveApiBase(value) {
  const v = normalizeBase(value);
  localStorage.setItem(LS_API_BASE, v);
  byId("apiBase").value = v;
  byId("apiBaseMini").textContent = v || "—";
}

function loadApiBase() {
  const stored = localStorage.getItem(LS_API_BASE);
  const v = normalizeBase(stored || "") || guessApiBase();
  if (byId("apiBase")) byId("apiBase").value = v;
  byId("apiBaseMini").textContent = v || "—";
}

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

  // auth (v0.3)
  byId("btnLogin")?.addEventListener("click", onLogin);
  byId("btnRegisterConfirm")?.addEventListener("click", onRegister);

  byId("btnGoForgot")?.addEventListener("click", () => (window.location.hash = "#/forgot"));
  byId("btnGoRegister")?.addEventListener("click", () => (window.location.hash = "#/register"));

  byId("btnBackToLoginFromRegister")?.addEventListener("click", () => (window.location.hash = "#/login"));
  byId("btnBackToLoginFromForgot")?.addEventListener("click", () => (window.location.hash = "#/login"));
  byId("btnBackToLoginFromReset")?.addEventListener("click", () => (window.location.hash = "#/login"));

  byId("btnForgotSend")?.addEventListener("click", onForgot);
  byId("btnResetPass")?.addEventListener("click", onResetPass);

  byId("btnMe")?.addEventListener("click", onMe);
  byId("btnLogout")?.addEventListener("click", onLogout);

  const applyRoute = () => {
    let name = routeNameFromHash();

    if (isProtectedRoute(name) && !isLoggedIn()) {
      name = "login";
      if (window.location.hash !== "#/login") window.location.hash = "#/login";
    }

    showPage(name);
    updateNavAuthState();

    const msg = consumeFlash();
    if (msg) {
      const outId =
        name === "login" ? "loginOut" :
        name === "register" ? "registerOut" :
        name === "forgot" ? "forgotOut" :
        name === "reset" ? "resetOut" : null;

      if (outId) setOut(outId, { info: msg }, "ok");
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
