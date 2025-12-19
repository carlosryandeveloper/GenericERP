// GenericERP Front (v0.1)
// Front simples para testar o backend via fetch.
//
// IMPORTANTE:
// - Se abrir o index.html via file://, o navegador pode bloquear por CORS.
// - Soluções: habilitar CORS no backend, ou servir esse front (ex.: GitHub Pages + backend público).

const DEFAULT_API_BASE = "http://localhost:8000";

function byId(id) { return document.getElementById(id); }
function pretty(x) { return JSON.stringify(x, null, 2); }

function show(id, value, isError = false) {
  const el = byId(id);
  el.textContent = (typeof value === "string") ? value : pretty(value);
  el.classList.toggle("err", isError);
  el.classList.toggle("ok", !isError);
}

function getApiBase() {
  const raw = (byId("apiBase").value || DEFAULT_API_BASE).trim();
  return raw.replace(/\/$/, "");
}

async function request(path, options = {}) {
  const res = await fetch(getApiBase() + path, {
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
byId("apiBase").value = DEFAULT_API_BASE;

// Actions
byId("btnHealth").onclick = async () => {
  try {
    const data = await request("/health");
    show("healthResult", data);
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
    const data = await request("/products", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    show("productResult", data);
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
    const data = await request("/stock/movements", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    show("moveResult", data);
  } catch (e) {
    show("moveResult", String(e), true);
  }
};

byId("btnBalance").onclick = async () => {
  try {
    const data = await request("/stock/balance");
    show("balanceResult", data);
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
    show("statementResult", data);
  } catch (e) {
    show("statementResult", String(e), true);
  }
};
