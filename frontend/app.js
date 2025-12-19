const FALLBACK_LOCAL = "http://localhost:8000";

function byId(id) { return document.getElementById(id); }
function pretty(x) { return JSON.stringify(x, null, 2); }

function setApiStatus(kind, text) {
  const dot = byId("apiDot");
  const label = byId("apiLabel");
  dot.classList.remove("ok", "err");
  if (kind === "ok") dot.classList.add("ok");
  if (kind === "err") dot.classList.add("err");
  label.textContent = text;
}

function show(elId, value, isError = false) {
  const el = byId(elId);
  el.textContent = (typeof value === "string") ? value : pretty(value);
  el.classList.remove("ok", "err");
  el.classList.add(isError ? "err" : "ok");
}

function guessApiBase() {
  // Ex.: https://<nome>-5173.app.github.dev  -> backend: https://<nome>-8000.app.github.dev
  const url = window.location.href;

  if (url.includes(".app.github.dev")) {
    return window.location.origin.replace(/-\d+\./, "-8000.");
  }

  return FALLBACK_LOCAL;
}

function getApiBase() {
  const raw = (byId("apiBase").value || "").trim();
  const base = raw || guessApiBase();
  return base.replace(/\/$/, "");
}

async function request(path, options = {}) {
  const base = getApiBase();
  const res = await fetch(base + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}

  if (!res.ok) {
    const detail = (data && typeof data === "object" && data.detail) ? data.detail : text;
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return data;
}

// init
byId("apiBase").value = guessApiBase();
setApiStatus(null, "API: não testada");

byId("btnHealth").onclick = async () => {
  try {
    const data = await request("/health");
    show("healthResult", data, false);
    setApiStatus("ok", `API: OK (${getApiBase()})`);
  } catch (e) {
    show("healthResult", String(e), true);
    setApiStatus("err", `API: erro (${getApiBase()})`);
  }
};

byId("btnRoutes").onclick = async () => {
  try {
    const data = await request("/debug/routes");
    show("healthResult", data, false);
  } catch (e) {
    show("healthResult", String(e), true);
  }
};

byId("btnCreateProduct").onclick = async () => {
  try {
    const payload = {
      sku: byId("sku").value.trim(),
      name: byId("name").value.trim(),
      unit: byId("unit").value.trim(),
    };
    const data = await request("/products", { method: "POST", body: JSON.stringify(payload) });
    show("productResult", data, false);
  } catch (e) {
    show("productResult", String(e), true);
  }
};

byId("btnCreateMove").onclick = async () => {
  try {
    const payload = {
      product_id: Number(byId("productId").value),
      type: byId("type").value,
      quantity: Number(byId("qty").value),
      note: (byId("note").value || "").trim() || null,
    };
    const data = await request("/stock/movements", { method: "POST", body: JSON.stringify(payload) });
    show("moveResult", data, false);
  } catch (e) {
    show("moveResult", String(e), true);
  }
};

byId("btnBalance").onclick = async () => {
  try {
    const data = await request("/stock/balance");
    show("balanceResult", data, false);
  } catch (e) {
    show("balanceResult", String(e), true);
  }
};

byId("btnStatement").onclick = async () => {
  try {
    const productId = Number(byId("statementProductId").value);
    if (!productId) throw new Error("Informe um Product ID válido.");

    const fromDate = (byId("fromDate").value || "").trim();
    const toDate = (byId("toDate").value || "").trim();

    const params = new URLSearchParams({ product_id: String(productId) });
    if (fromDate) params.set("from_date", fromDate);
    if (toDate) params.set("to_date", toDate);

    const data = await request(`/stock/statement?${params.toString()}`);
    show("statementResult", data, false);
  } catch (e) {
    show("statementResult", String(e), true);
  }
};
