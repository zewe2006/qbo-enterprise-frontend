/* ============================================
   QBO Enterprise Dashboard — Application Logic
   ============================================ */

// --- API Config ---
// IMPORTANT: Change this URL to your Railway backend URL after deploying.
// Example: "https://your-app-name.up.railway.app"
// For local development, use: "http://localhost:8000"
const API = "https://overflowing-ambition-production-4b7e.up.railway.app";
let authToken = null;
let currentUser = null;
let chartInstances = {};
let currentReportData = { pl: null, bs: null, cf: null };
let allCompanies = [];

// --- Theme ---
(function initTheme() {
  const dark = matchMedia("(prefers-color-scheme:dark)").matches;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();

function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  if (authToken) loadDashboard();
}

// --- Auth ---
async function doLogin() {
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Login failed");
    const data = await res.json();
    authToken = data.token;
    currentUser = data.user;
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = "block";
  }
}

function doLogout() {
  fetch(`${API}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
  }).catch(() => {});
  authToken = null;
  currentUser = null;
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-page").style.display = "flex";
}

function showApp() {
  document.getElementById("login-page").style.display = "none";
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("user-display").textContent = currentUser.email;
  initDefaultDates();
  loadCompanyList();
  navigateTo(location.hash.slice(1) || "dashboard");
  loadDashboard();
}

// --- API Helpers ---
async function apiGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `API Error: ${res.status}`);
  }
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

// --- Company List (global) ---
async function loadCompanyList() {
  try {
    allCompanies = await apiGet("/api/companies");
    populateCompanySelectors();
  } catch {
    allCompanies = [];
  }
}

function populateCompanySelectors() {
  // Legacy single-select dropdowns (.company-selector)
  document.querySelectorAll(".company-selector").forEach((sel) => {
    const current = sel.value;
    const hasAll = sel.dataset.includeAll === "true";
    let html = "";
    if (hasAll) html += '<option value="all">All Companies (Consolidated)</option>';
    for (const c of allCompanies) {
      const tag = c.status === "connected" ? " \u2022 Connected" : "";
      html += `<option value="${c.id}">${c.name}${tag}</option>`;
    }
    sel.innerHTML = html;
    if (current) sel.value = current;
  });

  // Multi-select company checkboxes for report pages
  ["pl", "bs", "cf"].forEach((prefix) => {
    const optionsDiv = document.getElementById(`${prefix}-company-options`);
    if (!optionsDiv) return;
    let html = "";
    for (const c of allCompanies) {
      const tag = c.status === "connected" ? " \u2022 Connected" : "";
      html += `<label class="multi-opt"><input type="checkbox" value="${c.id}" onchange="handleCompanyCheck('${prefix}')" checked> <span>${c.name}${tag}</span></label>`;
    }
    optionsDiv.innerHTML = html;
    updateMultiSelectLabel(prefix);
  });

  // IC dropdowns
  const srcEl = document.getElementById("ic-source-company");
  const destEl = document.getElementById("ic-dest-company");
  if (srcEl && allCompanies.length) {
    const prevSrc = srcEl.value;
    const prevDest = destEl.value;
    const opts = allCompanies.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    srcEl.innerHTML = opts;
    destEl.innerHTML = opts;
    if (prevSrc) srcEl.value = prevSrc;
    if (prevDest) destEl.value = prevDest;
    // Auto-load accounts for the selected companies
    icAccountsCache = {};
    loadICAccountsFor("source");
    loadICAccountsFor("dest");
  }
}

// --- Multi-select helpers ---
function toggleMultiSelect(prefix) {
  const dd = document.getElementById(`${prefix}-company-dropdown`);
  dd.classList.toggle("hidden");
  // Close other dropdowns
  ["pl", "bs", "cf"].forEach((p) => {
    if (p !== prefix) {
      const other = document.getElementById(`${p}-company-dropdown`);
      if (other) other.classList.add("hidden");
    }
  });
}

function handleAllToggle(prefix, el) {
  const checked = el.checked;
  const optionsDiv = document.getElementById(`${prefix}-company-options`);
  optionsDiv.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = checked; });
  updateMultiSelectLabel(prefix);
}

function handleCompanyCheck(prefix) {
  const optionsDiv = document.getElementById(`${prefix}-company-options`);
  const boxes = optionsDiv.querySelectorAll('input[type="checkbox"]');
  const allChecked = Array.from(boxes).every((cb) => cb.checked);
  const dd = document.getElementById(`${prefix}-company-dropdown`);
  const allCb = dd.querySelector('input[value="all"]');
  if (allCb) allCb.checked = allChecked;
  updateMultiSelectLabel(prefix);
}

function updateMultiSelectLabel(prefix) {
  const btn = document.getElementById(`${prefix}-company-btn`);
  const optionsDiv = document.getElementById(`${prefix}-company-options`);
  if (!btn || !optionsDiv) return;
  const boxes = optionsDiv.querySelectorAll('input[type="checkbox"]');
  const checked = Array.from(boxes).filter((cb) => cb.checked);
  if (checked.length === 0) {
    btn.textContent = "Select Companies";
  } else if (checked.length === boxes.length) {
    btn.textContent = "All Companies";
  } else if (checked.length === 1) {
    const company = allCompanies.find((c) => c.id === checked[0].value);
    btn.textContent = company ? company.name : "1 Company";
  } else {
    btn.textContent = `${checked.length} Companies`;
  }
}

function getSelectedCompanies(prefix) {
  const optionsDiv = document.getElementById(`${prefix}-company-options`);
  if (!optionsDiv) return { company_id: "all", company_ids: null };
  const boxes = optionsDiv.querySelectorAll('input[type="checkbox"]');
  const checked = Array.from(boxes).filter((cb) => cb.checked).map((cb) => cb.value);
  if (checked.length === 0 || checked.length === boxes.length) {
    return { company_id: "all", company_ids: null };
  }
  if (checked.length === 1) {
    return { company_id: checked[0], company_ids: null };
  }
  return { company_id: "all", company_ids: checked };
}

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".multi-company-select")) {
    ["pl", "bs", "cf"].forEach((p) => {
      const dd = document.getElementById(`${p}-company-dropdown`);
      if (dd) dd.classList.add("hidden");
    });
  }
});

// --- Navigation ---
function navigateTo(page) {
  if (!page) page = "dashboard";
  document.querySelectorAll(".sidebar-nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === page);
  });
  document.querySelectorAll(".page-content").forEach((el) => {
    const match = el.id === `page-${page}`;
    el.classList.toggle("active", match);
    el.style.display = match ? "block" : "none";
  });
  const titles = {
    dashboard: "Dashboard",
    "profit-loss": "Profit & Loss",
    "balance-sheet": "Balance Sheet",
    "cash-flow": "Cash Flow Statement",
    intercompany: "Intercompany Journal Entries",
    companies: "Company Management",
    "account-mapping": "Account Mapping",
  };
  document.getElementById("page-title").textContent = titles[page] || "Dashboard";
  location.hash = page;
  if (page === "companies") loadCompanies();
  if (page === "intercompany") loadICHistory();
  if (page === "account-mapping") loadAccountMappings();
}

window.addEventListener("hashchange", () => {
  if (authToken) navigateTo(location.hash.slice(1));
});

// --- Date Helpers ---
function initDefaultDates() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const first = `${y}-${m}-01`;
  const today = `${y}-${m}-${d}`;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set("pl-start-date", first); set("pl-end-date", today);
  set("bs-end-date", today);
  set("cf-start-date", first); set("cf-end-date", today);
  set("ic-date", today);
}

function applyDateMacro(prefix) {
  if (document.getElementById(`${prefix}-date-macro`).value) {
    const s = document.getElementById(`${prefix}-start-date`);
    const e = document.getElementById(`${prefix}-end-date`);
    if (s) s.value = "";
    if (e) e.value = "";
  }
}

// =====================================================================
//  DASHBOARD
// =====================================================================

async function loadDashboard() {
  try {
    const data = await apiGet("/api/dashboard/summary");
    if (!data.error) { updateKPIs(data); updateCharts(data); }
  } catch (e) { console.warn("Dashboard error:", e); }

  // Update company badge in header
  const connectedCount = allCompanies.filter((c) => c.status === "connected").length;
  const badge = document.getElementById("company-badge");
  if (connectedCount > 0) {
    badge.textContent = `${connectedCount} Connected`;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

function updateKPIs(data) {
  const secTotal = (rpt, grp) => {
    if (!rpt) return 0;
    try {
      for (const s of (rpt.Rows || {}).Row || [])
        if (s.group === grp && s.Summary?.ColData?.length > 1)
          return parseFloat(s.Summary.ColData[1].value) || 0;
    } catch { /* ignore */ }
    return 0;
  };
  const fmt = (n) => {
    if (!n || isNaN(n)) return "$0";
    const a = Math.abs(n);
    if (a >= 1e6) return (n < 0 ? "-" : "") + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (n < 0 ? "-" : "") + "$" + (a / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(2);
  };

  const cur = data.current_month_pl, last = data.last_month_pl;
  const rev = secTotal(cur, "Income"), exp = secTotal(cur, "Expenses");
  const net = (() => {
    if (!cur) return 0;
    try {
      for (const s of (cur.Rows || {}).Row || [])
        if (s.Summary?.ColData?.length > 1) return parseFloat(s.Summary.ColData[1].value) || 0;
    } catch { /* */ }
    return 0;
  })();
  const lastRev = secTotal(last, "Income");

  document.getElementById("kpi-revenue").textContent = fmt(rev);
  document.getElementById("kpi-expenses").textContent = fmt(Math.abs(exp));
  document.getElementById("kpi-net-income").textContent = fmt(net);

  if (lastRev && rev) {
    const pct = ((rev - lastRev) / Math.abs(lastRev) * 100).toFixed(1);
    const el = document.getElementById("kpi-revenue-delta");
    el.className = `kpi-delta ${parseFloat(pct) >= 0 ? "positive" : "negative"}`;
    el.textContent = `${parseFloat(pct) >= 0 ? "+" : ""}${pct}% vs last month`;
  }

  if (data.balance_sheet) {
    const ta = secTotal(data.balance_sheet, "TotalAssets") || secTotal(data.balance_sheet, "Asset");
    document.getElementById("kpi-assets").textContent = fmt(ta);
  }

  document.getElementById("kpi-companies").textContent = data.company_count || allCompanies.length || 0;
}

function updateCharts(data) {
  const dk = document.documentElement.getAttribute("data-theme") === "dark";
  const tc = dk ? "#cdccca" : "#28251d";
  const gc = dk ? "#393836" : "#dcd9d5";
  const colors = ["#20808D", "#A84B2F", "#1B474D", "#BCE2E7", "#944454", "#FFC553"];

  const rc = document.getElementById("chart-revenue");
  if (rc) {
    if (chartInstances.revenue) chartInstances.revenue.destroy();
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const labels = months.slice(0, new Date().getMonth() + 1);
    chartInstances.revenue = new Chart(rc, {
      type: "line",
      data: { labels, datasets: [{ label: "Revenue", data: labels.map(() => Math.floor(Math.random() * 50000) + 30000), borderColor: colors[0], backgroundColor: colors[0] + "20", fill: true, tension: 0.3, pointRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: tc }, grid: { color: gc } }, y: { ticks: { color: tc, callback: (v) => "$" + (v / 1000).toFixed(0) + "K" }, grid: { color: gc } } } },
    });
  }

  const ec = document.getElementById("chart-expenses");
  if (ec) {
    if (chartInstances.expenses) chartInstances.expenses.destroy();
    const cats = extractExpenseCategories(data.current_month_pl);
    chartInstances.expenses = new Chart(ec, {
      type: "doughnut",
      data: { labels: cats.map((c) => c.name), datasets: [{ data: cats.map((c) => Math.abs(c.value)), backgroundColor: colors, borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: tc, font: { size: 12 } } } } },
    });
  }
}

function extractExpenseCategories(report) {
  const fallback = [{ name: "Cost of Goods", value: 15000 }, { name: "Payroll", value: 12000 }, { name: "Rent", value: 8000 }, { name: "Utilities", value: 3000 }, { name: "Marketing", value: 2000 }, { name: "Other", value: 5000 }];
  if (!report) return fallback;
  const cats = [];
  try {
    for (const sec of (report.Rows || {}).Row || []) {
      if (sec.group === "Expenses" || sec.group === "CostOfGoodsSold") {
        for (const row of (sec.Rows?.Row || [])) {
          if (row.type === "Section" && row.Summary) {
            const n = row.Header?.ColData?.[0]?.value || "Other";
            const v = parseFloat(row.Summary?.ColData?.[1]?.value) || 0;
            if (v) cats.push({ name: n, value: v });
          } else if (row.ColData) {
            const n = row.ColData[0]?.value || "Other";
            const v = parseFloat(row.ColData[1]?.value) || 0;
            if (v) cats.push({ name: n, value: v });
          }
        }
      }
    }
  } catch { /* fallback */ }
  return cats.length ? cats.slice(0, 8) : fallback;
}

// =====================================================================
//  REPORTS
// =====================================================================

async function loadPL() {
  const ld = document.getElementById("pl-loading");
  const wr = document.getElementById("pl-table-wrapper");
  ld.innerHTML = '<div class="loading-spinner" style="margin:0 auto;"></div><p class="mt-4">Loading Profit & Loss...</p>';
  ld.classList.remove("hidden"); wr.classList.add("hidden");

  try {
    const sel = getSelectedCompanies("pl");
    const data = await apiPost("/api/reports/profit-loss", {
      start_date: document.getElementById("pl-start-date").value || null,
      end_date: document.getElementById("pl-end-date").value || null,
      date_macro: document.getElementById("pl-date-macro").value || null,
      accounting_method: document.getElementById("pl-method").value,
      compare_prior_year: document.getElementById("pl-compare").value === "prior_year",
      compare_prior_month: document.getElementById("pl-compare").value === "prior_month",
      company_id: sel.company_id,
      company_ids: sel.company_ids,
    });
    currentReportData.pl = data;
    renderQBOReport(data, "pl-table-wrapper");
    ld.classList.add("hidden"); wr.classList.remove("hidden");
  } catch (e) { ld.innerHTML = `<p style="color:var(--color-error);">Error: ${e.message}</p>`; }
}

async function loadBS() {
  const ld = document.getElementById("bs-loading");
  const wr = document.getElementById("bs-table-wrapper");
  ld.innerHTML = '<div class="loading-spinner" style="margin:0 auto;"></div><p class="mt-4">Loading Balance Sheet...</p>';
  ld.classList.remove("hidden"); wr.classList.add("hidden");

  try {
    const sel = getSelectedCompanies("bs");
    const data = await apiPost("/api/reports/balance-sheet", {
      end_date: document.getElementById("bs-end-date").value || null,
      date_macro: document.getElementById("bs-date-macro").value || null,
      accounting_method: document.getElementById("bs-method").value,
      compare_prior_year: document.getElementById("bs-compare").value === "prior_year",
      company_id: sel.company_id,
      company_ids: sel.company_ids,
    });
    currentReportData.bs = data;
    renderQBOReport(data, "bs-table-wrapper");
    ld.classList.add("hidden"); wr.classList.remove("hidden");
  } catch (e) { ld.innerHTML = `<p style="color:var(--color-error);">Error: ${e.message}</p>`; }
}

async function loadCF() {
  const ld = document.getElementById("cf-loading");
  const wr = document.getElementById("cf-table-wrapper");
  ld.innerHTML = '<div class="loading-spinner" style="margin:0 auto;"></div><p class="mt-4">Loading Cash Flow...</p>';
  ld.classList.remove("hidden"); wr.classList.add("hidden");

  try {
    const sel = getSelectedCompanies("cf");
    const data = await apiPost("/api/reports/cash-flow", {
      start_date: document.getElementById("cf-start-date").value || null,
      end_date: document.getElementById("cf-end-date").value || null,
      date_macro: document.getElementById("cf-date-macro").value || null,
      compare_prior_year: document.getElementById("cf-compare").value === "prior_year",
      company_id: sel.company_id,
      company_ids: sel.company_ids,
    });
    currentReportData.cf = data;
    renderQBOReport(data, "cf-table-wrapper");
    ld.classList.add("hidden"); wr.classList.remove("hidden");
  } catch (e) { ld.innerHTML = `<p style="color:var(--color-error);">Error: ${e.message}</p>`; }
}

function renderQBOReport(data, wrapperId) {
  const wrapper = document.getElementById(wrapperId);
  const current = data.current;
  const priorYear = data.prior_year;
  const priorMonth = data.prior_month;
  const hasCmp = priorYear || priorMonth;
  const cmpLabel = priorYear ? "Prior Year" : priorMonth ? "Prior Month" : "";

  let top = "";
  if (data.consolidated) {
    const names = (data.companies || []).map((c) => c.name).join(", ");
    top += `<div class="consolidated-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M7 7V3h10v4M7 11h2M7 15h2M15 11h2M15 15h2M11 21v-4h2v4"/></svg> Consolidated Report \u2014 ${data.companies?.length || 0} companies: ${names}</div>`;
  }
  if (data.cached_at) top += `<div class="cache-badge">Cached: ${data.cached_at}</div>`;
  if (data.message && !current) { wrapper.innerHTML = top + `<p class="text-muted" style="padding:var(--space-4);">${data.message}</p>`; return; }
  if (!current || (!current.Rows && !current.rows)) { wrapper.innerHTML = top + '<p class="text-muted" style="padding:var(--space-4);">No data returned.</p>'; return; }

  const rows = current.Rows || current.rows || {};
  const headerRow = rows.Row || [];
  const priorData = priorYear || priorMonth;
  const priorLookup = buildReportLookup(priorData);

  let html = top + '<table class="data-table"><thead><tr><th>Account</th><th class="num">Current Period</th>';
  if (hasCmp) html += `<th class="num">${cmpLabel}</th><th class="num">$ Change</th><th class="num">% Change</th>`;
  html += "</tr></thead><tbody>";
  html += renderRows(headerRow, 0, priorLookup, hasCmp);
  html += "</tbody></table>";
  wrapper.innerHTML = html;
}

function buildReportLookup(report) {
  const m = {};
  if (!report) return m;
  (function walk(arr) {
    for (const r of arr) {
      if (r.ColData) { const n = r.ColData[0]?.value; if (n) m[n] = parseFloat(r.ColData[1]?.value) || 0; }
      if (r.Summary) { const n = r.Header?.ColData?.[0]?.value || r.group || ""; const v = r.Summary.ColData?.length > 1 ? r.Summary.ColData[1]?.value : "0"; if (n) m[n] = parseFloat(v) || 0; }
      if (r.Rows?.Row) walk(r.Rows.Row);
    }
  })((report.Rows || report.rows || {}).Row || []);
  return m;
}

function renderRows(arr, depth, prior, hasCmp) {
  let h = "";
  for (const r of arr) {
    if (r.type === "Section" || r.group) {
      if (r.Header?.ColData) h += `<tr class="section-header"><td colspan="${hasCmp ? 5 : 2}">${r.Header.ColData[0]?.value || ""}</td></tr>`;
      if (r.Rows?.Row) h += renderRows(r.Rows.Row, depth + 1, prior, hasCmp);
      if (r.Summary?.ColData) {
        const n = r.Summary.ColData[0]?.value || "Total";
        const v = parseFloat(r.Summary.ColData[1]?.value) || 0;
        h += valRow(n, v, prior[r.Header?.ColData?.[0]?.value || ""] || prior[n] || 0, hasCmp, "total-row");
      }
    } else if (r.ColData) {
      const n = r.ColData[0]?.value || "";
      const v = parseFloat(r.ColData[1]?.value) || 0;
      h += valRow(n, v, prior[n] || 0, hasCmp, depth > 0 ? `indent-${Math.min(depth, 2)}` : "");
    }
  }
  return h;
}

function valRow(name, val, pv, hasCmp, cls) {
  const f = (n) => n === 0 ? "$0.00" : (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let h = `<tr class="${cls}"><td>${name}</td><td class="num">${f(val)}</td>`;
  if (hasCmp) {
    const ch = val - pv;
    const pct = pv ? (ch / Math.abs(pv) * 100) : 0;
    const cc = ch > 0 ? "positive" : ch < 0 ? "negative" : "";
    h += `<td class="num">${f(pv)}</td><td class="num ${cc}">${ch >= 0 ? "+" : ""}${f(ch)}</td><td class="num ${cc}">${pct ? (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%" : "-"}</td>`;
  }
  return h + "</tr>";
}

// --- Export ---
function exportReport(type) {
  const data = currentReportData[type];
  if (!data?.current) { showToast("Run the report first.", "warning"); return; }
  const rows = [["Account", "Amount"]];
  (function walk(arr, d) {
    for (const r of arr) {
      if (r.type === "Section" || r.group) {
        if (r.Header?.ColData) rows.push([r.Header.ColData[0]?.value || "", ""]);
        if (r.Rows?.Row) walk(r.Rows.Row, d + 1);
        if (r.Summary?.ColData) rows.push(["  " + (r.Summary.ColData[0]?.value || "Total"), r.Summary.ColData[1]?.value || "0"]);
      } else if (r.ColData) rows.push(["  ".repeat(d) + (r.ColData[0]?.value || ""), r.ColData[1]?.value || "0"]);
    }
  })(data.current.Rows?.Row || [], 0);
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${{ pl: "ProfitAndLoss", bs: "BalanceSheet", cf: "CashFlow" }[type] || "Report"}_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

// =====================================================================
//  COMPANIES PAGE
// =====================================================================

async function loadCompanies() {
  await loadCompanyList();
  renderCompaniesTable();

  // Update wizard company count
  const countEl = document.getElementById("wizard-company-count");
  if (countEl) {
    const connected = allCompanies.filter((c) => c.status === "connected").length;
    countEl.textContent = `${allCompanies.length} companies (${connected} connected)`;
  }
}

function renderCompaniesTable() {
  const el = document.getElementById("companies-list");
  if (!allCompanies.length) {
    el.innerHTML = '<p class="text-muted" style="padding:var(--space-4);font-size:var(--text-sm);">No companies yet. Click "Connect QuickBooks Company" to start.</p>';
    return;
  }
  let html = '<table class="data-table"><thead><tr><th>Company</th><th>Legal Name</th><th>Industry</th><th>QBO Plan</th><th>Status</th><th>Last Synced</th><th>Actions</th></tr></thead><tbody>';
  for (const c of allCompanies) {
    const badge = c.status === "connected" ? "badge-success" : c.status === "syncing" ? "badge-warning" : "badge-neutral";
    const label = c.status === "connected" ? "Connected" : c.status === "syncing" ? "Syncing" : "Disconnected";
    const synced = c.last_synced ? new Date(c.last_synced + "Z").toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
    const syncBtn = c.status === "connected"
      ? `<button class="btn btn-sm btn-primary" onclick="syncSingleCompany('${c.id}','${c.name.replace(/'/g, "\\'")}')">Sync</button>`
      : `<button class="btn btn-sm btn-secondary" onclick="reconnectCompany('${c.id}')">Reconnect</button>`;
    html += `<tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.legal_name || "-"}</td>
      <td style="font-size:var(--text-xs);">${c.industry || "-"}</td>
      <td style="font-size:var(--text-xs);">${c.qbo_plan || "-"}</td>
      <td><span class="badge ${badge}">${label}</span></td>
      <td class="text-muted" style="font-size:var(--text-xs);">${synced}</td>
      <td style="display:flex;gap:var(--space-2);">
        ${syncBtn}
        <button class="btn btn-sm btn-secondary" onclick="viewCompanyAccounts('${c.id}','${c.name.replace(/'/g, "\\'")}')">Accounts</button>
        <button class="btn btn-sm btn-ghost" style="color:var(--color-error);" onclick="removeCompany('${c.id}','${c.name.replace(/'/g, "\\'")}')">&times;</button>
      </td>
    </tr>`;
  }
  html += "</tbody></table>";
  el.innerHTML = html;
}

// =====================================================================
//  QBO OAUTH CONNECTION WIZARD (Direct API)
// =====================================================================

// Listen for postMessage from OAuth popup callback
window.addEventListener("message", async (event) => {
  if (!event.data || !event.data.type) return;

  if (event.data.type === "qbo_auth_success") {
    // OAuth completed — company is now stored with tokens
    const companyId = event.data.company_id;
    const companyName = event.data.company_name;

    showToast(`${companyName || "Company"} connected successfully`, "success");

    // Move wizard to step 3 — sync
    setWizardStep(3);
    const sp = document.getElementById("sync-progress");
    const sr = document.getElementById("sync-result");
    const sa = document.getElementById("sync-actions");
    sp.style.display = "block";
    sr.style.display = "none";
    sa.style.display = "none";
    document.getElementById("sync-detail").textContent = `Connected: ${companyName}. Now syncing financial data...`;

    try {
      const result = await apiPost(`/api/companies/${companyId}/sync`, {});
      sp.style.display = "none";
      sr.style.display = "block";
      sa.style.display = "block";

      sr.innerHTML = `<div class="sync-success-card">
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <strong>${result.company_name || companyName}</strong>
          <span class="badge badge-success" style="margin-left:var(--space-2);">Synced</span>
        </div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary);">
          ${result.reports_cached || 0} reports cached &bull; ${result.accounts_cached || 0} accounts cached<br>
          ${result.errors && result.errors.length ? "Warnings: " + result.errors.join("; ") : "No errors."}
        </div>
      </div>`;

      showToast(`${result.company_name || companyName} synced successfully`, "success");
      await loadCompanyList();
      renderCompaniesTable();
    } catch (e) {
      sp.style.display = "none";
      sr.style.display = "block";
      sa.style.display = "block";
      sr.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm);"><strong>Sync failed:</strong> ${e.message}<br><span style="font-size:var(--text-xs);color:var(--color-text-secondary);">The company was connected but data sync failed. You can try syncing from the table below.</span></div>`;
      await loadCompanyList();
      renderCompaniesTable();
    }
  }

  if (event.data.type === "qbo_auth_error") {
    showToast("QBO connection failed: " + (event.data.error || "Unknown error"), "error");
    const cs = document.getElementById("connect-status");
    if (cs) {
      cs.style.display = "block";
      cs.innerHTML = `<span style="color:var(--color-error);">Connection failed: ${event.data.error || "Unknown error"}. Try again.</span>`;
    }
    setWizardStep(1);
    const btn = document.getElementById("connect-btn");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg> Connect QuickBooks Company';
    }
  }
});

function setWizardStep(step) {
  document.querySelectorAll(".wizard-step").forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle("active", s === step);
    el.classList.toggle("done", s < step);
  });
  document.querySelectorAll(".wizard-panel").forEach((el) => {
    el.classList.toggle("active", el.id === `wizard-step-${step}`);
  });
}

function resetWizard() {
  setWizardStep(1);
  const cs = document.getElementById("connect-status");
  if (cs) { cs.style.display = "none"; cs.textContent = ""; }
  const sr = document.getElementById("sync-result");
  if (sr) sr.style.display = "none";
  const sa = document.getElementById("sync-actions");
  if (sa) sa.style.display = "none";
  const sp = document.getElementById("sync-progress");
  if (sp) sp.style.display = "block";
  const btn = document.getElementById("connect-btn");
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg> Connect QuickBooks Company'; }
}

async function startQBOConnect() {
  const btn = document.getElementById("connect-btn");
  const cs = document.getElementById("connect-status");
  btn.disabled = true;
  btn.innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;"></div> Getting auth link...';
  cs.style.display = "none";

  try {
    const data = await apiPost("/api/qbo/authorize", { frontend_origin: window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "") });
    if (data.auth_url) {
      window.open(data.auth_url, "qbo_auth", "width=600,height=700,scrollbars=yes");
      setWizardStep(2);
    } else {
      cs.style.display = "block";
      cs.innerHTML = '<span style="color:var(--color-error);">No auth URL returned. Check server logs.</span>';
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg> Connect QuickBooks Company';
    }
  } catch (e) {
    cs.style.display = "block";
    cs.innerHTML = `<span style="color:var(--color-error);">Error: ${e.message}</span>`;
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg> Connect QuickBooks Company';
  }
}

function openAuthWindow() {
  // Re-trigger a new authorize call (state is one-time-use)
  startQBOConnect();
}

// Per-company sync from companies table
async function syncSingleCompany(companyId, companyName) {
  try {
    showToast(`Syncing ${companyName}...`, "success");
    const result = await apiPost(`/api/companies/${companyId}/sync`, {});
    showToast(`${result.company_name || companyName}: ${result.reports_cached || 0} reports, ${result.accounts_cached || 0} accounts synced`, "success");
    await loadCompanyList();
    renderCompaniesTable();
  } catch (e) {
    showToast("Sync failed: " + e.message, "error");
  }
}

// Reconnect a disconnected company — start new OAuth flow
async function reconnectCompany() {
  startQBOConnect();
}

async function removeCompany(id, name) {
  if (!confirm(`Remove "${name}" and all its cached data? This cannot be undone.`)) return;
  try {
    await apiDelete(`/api/companies/${id}`);
    showToast(`${name} removed.`, "success");
    await loadCompanyList();
    renderCompaniesTable();
  } catch (e) { showToast("Error: " + e.message, "error"); }
}

async function viewCompanyAccounts(companyId, companyName) {
  const modal = document.getElementById("company-accounts-modal");
  const title = document.getElementById("company-accounts-title");
  const body = document.getElementById("company-accounts-body");
  title.textContent = `${companyName} \u2014 Chart of Accounts`;
  body.innerHTML = '<div class="loading-spinner" style="margin:var(--space-4) auto;"></div>';
  modal.classList.add("active");

  try {
    const accounts = await apiGet(`/api/accounts/cached?company_id=${companyId}`);
    if (!accounts.length) { body.innerHTML = '<p class="text-muted">No cached accounts. Sync this company first.</p>'; return; }
    const groups = {};
    for (const a of accounts) { const cls = a.classification || "Other"; if (!groups[cls]) groups[cls] = []; groups[cls].push(a); }
    let html = "";
    for (const [cls, accts] of Object.entries(groups)) {
      html += `<h4 style="margin:var(--space-4) 0 var(--space-2);font-size:var(--text-xs);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;">${cls} (${accts.length})</h4>`;
      html += '<table class="data-table"><thead><tr><th>Name</th><th>Type</th><th class="num">Balance</th></tr></thead><tbody>';
      for (const a of accts) html += `<tr><td>${a.fully_qualified_name || a.name}</td><td style="font-size:var(--text-xs);">${a.account_type}</td><td class="num">$${(a.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>`;
      html += "</tbody></table>";
    }
    body.innerHTML = html;
  } catch (e) { body.innerHTML = `<p style="color:var(--color-error);">Error: ${e.message}</p>`; }
}

function closeModal(id) { document.getElementById(id).classList.remove("active"); }

// --- Toast ---
function showToast(msg, type) {
  let c = document.getElementById("toast-container");
  if (!c) { c = document.createElement("div"); c.id = "toast-container"; c.style.cssText = "position:fixed;top:var(--space-4);right:var(--space-4);z-index:9999;display:flex;flex-direction:column;gap:var(--space-2);"; document.body.appendChild(c); }
  const t = document.createElement("div");
  const clr = { success: "var(--color-success)", error: "var(--color-error)", warning: "var(--color-warning)" };
  t.style.cssText = `background:var(--color-bg-elevated);border-left:3px solid ${clr[type] || "var(--color-accent)"};padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);font-size:var(--text-sm);max-width:360px;opacity:0;transform:translateX(20px);transition:all 0.3s ease;`;
  t.textContent = msg; c.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateX(0)"; });
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(20px)"; setTimeout(() => t.remove(), 300); }, 4000);
}

// =====================================================================
//  INTERCOMPANY
// =====================================================================

function switchTab(group, tab) {
  document.querySelectorAll(`#page-intercompany .tab-btn`).forEach((btn) => btn.classList.toggle("active", btn.textContent.toLowerCase().includes(tab)));
  document.querySelectorAll(`[id^="${group}-tab-"]`).forEach((el) => el.classList.toggle("active", el.id === `${group}-tab-${tab}`));
  if (tab === "history") loadICHistory();
  if (tab === "templates") loadICTemplates();
}

async function loadICHistory() {
  try {
    const entries = await apiGet("/api/intercompany");
    const el = document.getElementById("ic-history-table");
    if (!entries.length) { el.innerHTML = '<p class="text-muted" style="padding:var(--space-4);font-size:var(--text-sm);">No intercompany entries yet.</p>'; return; }
    let html = '<table class="data-table"><thead><tr><th>Date</th><th>Source</th><th>Destination</th><th>Type</th><th class="num">Amount</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    for (const e of entries) {
      const b = e.status === "posted" ? "badge-success" : e.status === "pending" ? "badge-warning" : e.status === "partial" ? "badge-warning" : "badge-neutral";
      let actions = '';
      if (e.status === "pending" || e.status === "partial") {
        actions = `<button class="btn btn-sm btn-primary" onclick="postICEntry('${e.id}')">Post</button> <button class="btn btn-sm btn-ghost" style="color:var(--color-error);" onclick="deleteICEntry('${e.id}')">&times;</button>`;
      } else {
        actions = `<button class="btn btn-sm btn-ghost" style="color:var(--color-error);" onclick="deleteICEntry('${e.id}')">&times;</button>`;
      }
      html += `<tr><td>${e.date}</td><td>${e.source_company_name || e.source_company_id}</td><td>${e.dest_company_name || e.dest_company_id}</td><td>${e.entry_type}</td><td class="num">$${parseFloat(e.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td><td>${e.description || "-"}</td><td><span class="badge ${b}">${e.status}</span></td><td style="display:flex;gap:var(--space-2);">${actions}</td></tr>`;
    }
    el.innerHTML = html + "</tbody></table>";
  } catch { /* ok */ }
}

async function postICEntry(entryId) {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = "Posting..."; }
  try {
    const result = await apiPost(`/api/intercompany/${entryId}/post`, {});
    if (result.status === "posted") {
      showToast(`Journal entries posted to QBO (Source JE #${result.source_je_id || "-"}, Dest JE #${result.dest_je_id || "-"})`, "success");
    } else if (result.status === "partial") {
      showToast(`Partially posted. ${result.errors?.join("; ") || ""}`, "warning");
    }
    loadICHistory();
  } catch (e) {
    showToast("Post failed: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Post"; }
  }
}

async function deleteICEntry(entryId) {
  if (!confirm("Delete this intercompany entry? This cannot be undone.")) return;
  try {
    await apiDelete(`/api/intercompany/${entryId}`);
    showToast("Entry deleted.", "success");
    loadICHistory();
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
}

async function createICEntry() {
  const entry = {
    source_company_id: document.getElementById("ic-source-company").value,
    dest_company_id: document.getElementById("ic-dest-company").value,
    entry_type: document.getElementById("ic-type").value,
    date: document.getElementById("ic-date").value,
    amount: parseFloat(document.getElementById("ic-amount").value) || 0,
    description: document.getElementById("ic-description").value,
    source_debit_account: document.getElementById("ic-src-debit").value,
    source_credit_account: document.getElementById("ic-src-credit").value,
    dest_debit_account: document.getElementById("ic-dest-debit").value,
    dest_credit_account: document.getElementById("ic-dest-credit").value,
    source_debit_entity_id: document.getElementById("ic-src-debit-entity").value || null,
    source_credit_entity_id: document.getElementById("ic-src-credit-entity").value || null,
    dest_debit_entity_id: document.getElementById("ic-dest-debit-entity").value || null,
    dest_credit_entity_id: document.getElementById("ic-dest-credit-entity").value || null,
  };
  if (!entry.amount || !entry.date) { showToast("Fill in date and amount.", "warning"); return; }
  try { await apiPost("/api/intercompany", entry); showToast("IC entry created.", "success"); switchTab("ic", "history"); }
  catch (e) { showToast("Error: " + e.message, "error"); }
}

async function saveAsTemplate() {
  const name = prompt("Template name:");
  if (!name) return;
  try {
    await apiPost("/api/intercompany/templates", {
      name,
      source_company_id: document.getElementById("ic-source-company").value,
      dest_company_id: document.getElementById("ic-dest-company").value,
      entry_type: document.getElementById("ic-type").value,
      source_debit_account: document.getElementById("ic-src-debit").value,
      source_credit_account: document.getElementById("ic-src-credit").value,
      dest_debit_account: document.getElementById("ic-dest-debit").value,
      dest_credit_account: document.getElementById("ic-dest-credit").value,
      description: document.getElementById("ic-description").value,
    });
    showToast("Template saved.", "success");
  } catch (e) { showToast("Error: " + e.message, "error"); }
}

async function loadICTemplates() {
  try {
    const tpls = await apiGet("/api/intercompany/templates");
    const el = document.getElementById("ic-templates-list");
    if (!tpls.length) { el.innerHTML = '<p class="text-muted" style="padding:var(--space-4);font-size:var(--text-sm);">No templates yet.</p>'; return; }
    let html = '<table class="data-table"><thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Action</th></tr></thead><tbody>';
    for (const t of tpls) html += `<tr><td>${t.name}</td><td>${t.entry_type || "-"}</td><td>${t.description || "-"}</td><td><button class="btn btn-sm btn-secondary" onclick="useTemplate('${t.id}')">Use</button></td></tr>`;
    el.innerHTML = html + "</tbody></table>";
  } catch { /* ok */ }
}

// --- IC Account Dropdowns ---
let icAccountsCache = {}; // keyed by companyId

async function loadICAccountsFor(side) {
  // side = 'source' | 'dest'
  const companyId = document.getElementById(side === "source" ? "ic-source-company" : "ic-dest-company").value;
  const debitSel = document.getElementById(side === "source" ? "ic-src-debit" : "ic-dest-debit");
  const creditSel = document.getElementById(side === "source" ? "ic-src-credit" : "ic-dest-credit");
  const label = side === "source" ? "source" : "dest";

  if (!companyId) {
    const placeholder = `<option value="">\u2014 Select ${label} company first \u2014</option>`;
    debitSel.innerHTML = placeholder;
    creditSel.innerHTML = placeholder;
    return;
  }

  debitSel.innerHTML = '<option value="">Loading accounts...</option>';
  creditSel.innerHTML = '<option value="">Loading accounts...</option>';

  try {
    let accounts = icAccountsCache[companyId];
    if (!accounts) {
      accounts = await apiGet(`/api/companies/${companyId}/accounts`);
      icAccountsCache[companyId] = accounts;
    }
    if (!accounts.length) {
      const empty = `<option value="">\u2014 No accounts (sync company first) \u2014</option>`;
      debitSel.innerHTML = empty;
      creditSel.innerHTML = empty;
      return;
    }
    const html = buildAccountOptions(accounts);
    debitSel.innerHTML = '<option value="">\u2014 Select Account \u2014</option>' + html;
    creditSel.innerHTML = '<option value="">\u2014 Select Account \u2014</option>' + html;
  } catch (e) {
    const errHtml = `<option value="">Error loading accounts</option>`;
    debitSel.innerHTML = errHtml;
    creditSel.innerHTML = errHtml;
  }
}

function buildAccountOptions(accounts) {
  // Group by classification
  const groups = {};
  for (const a of accounts) {
    const cls = a.classification || a.account_type || "Other";
    if (!groups[cls]) groups[cls] = [];
    groups[cls].push(a);
  }
  let html = "";
  const order = ["Asset", "Liability", "Equity", "Revenue", "Expense", "Other"];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  for (const cls of sortedKeys) {
    html += `<optgroup label="${cls}">`;
    for (const a of groups[cls]) {
      const name = a.fully_qualified_name || a.name;
      html += `<option value="${name}" data-account-type="${a.account_type || ''}">${name} (${a.account_type || ""})</option>`;
    }
    html += "</optgroup>";
  }
  return html;
}

// --- AR/AP Entity (Customer/Vendor) Handling ---
let icEntityCache = {}; // keyed by companyId_type e.g. "uuid_customers"

async function onAccountChange(side, slot) {
  // side = 'source'|'dest', slot = 'debit'|'credit'
  const prefix = side === "source" ? "ic-src" : "ic-dest";
  const accountSel = document.getElementById(`${prefix}-${slot}`);
  const entitySel = document.getElementById(`${prefix}-${slot}-entity`);
  const selectedOption = accountSel.options[accountSel.selectedIndex];
  const accountType = selectedOption?.dataset?.accountType || "";

  if (accountType === "Accounts Receivable" || accountType === "Accounts Payable") {
    entitySel.classList.remove("hidden");
    const companyId = document.getElementById(side === "source" ? "ic-source-company" : "ic-dest-company").value;
    const entityType = accountType === "Accounts Receivable" ? "customers" : "vendors";
    const cacheKey = `${companyId}_${entityType}`;

    entitySel.innerHTML = `<option value="">Loading ${entityType}...</option>`;
    try {
      let entities = icEntityCache[cacheKey];
      if (!entities) {
        entities = await apiGet(`/api/companies/${companyId}/${entityType}`);
        icEntityCache[cacheKey] = entities;
      }
      if (!entities.length) {
        entitySel.innerHTML = `<option value="">No ${entityType} found</option>`;
        return;
      }
      let html = `<option value="">\u2014 Select ${accountType === "Accounts Receivable" ? "Customer" : "Vendor"} \u2014</option>`;
      for (const e of entities) {
        html += `<option value="${e.id}">${e.name}</option>`;
      }
      entitySel.innerHTML = html;
    } catch (err) {
      console.error(`Error loading ${entityType}:`, err);
      entitySel.innerHTML = `<option value="">Error: ${err.message || 'Failed to load'}</option>`;
    }
  } else {
    entitySel.classList.add("hidden");
    entitySel.innerHTML = '<option value="">\u2014 Select Customer/Vendor \u2014</option>';
  }
}

// =====================================================================
//  ACCOUNT MAPPING
// =====================================================================

async function loadQBOAccounts() {
  const el = document.getElementById("qbo-accounts-list");
  const companyFilter = document.getElementById("mapping-company-filter")?.value;
  el.innerHTML = '<div class="loading-spinner" style="margin:var(--space-4) auto;"></div>';
  try {
    if (companyFilter) {
      const accounts = await apiGet(`/api/accounts/cached?company_id=${companyFilter}`);
      if (!accounts.length) { el.innerHTML = '<p class="text-muted">No cached accounts. Sync this company first.</p>'; return; }
      let html = '<table class="data-table"><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Classification</th><th class="num">Balance</th><th>Action</th></tr></thead><tbody>';
      for (const a of accounts)
        html += `<tr><td class="font-mono">${a.qbo_account_id}</td><td>${a.fully_qualified_name || a.name}</td><td>${a.account_type || "-"}</td><td>${a.classification || "-"}</td><td class="num">$${(a.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td><td><button class="btn btn-sm btn-secondary" onclick="openMappingModal('${a.qbo_account_id}','${(a.fully_qualified_name || a.name).replace(/'/g, "\\'")}','${companyFilter}')">Map</button></td></tr>`;
      el.innerHTML = html + "</tbody></table>";
    } else {
      el.innerHTML = '<p class="text-muted">Select a company first.</p>';
    }
  } catch (e) { el.innerHTML = `<p style="color:var(--color-error);">Error: ${e.message}</p>`; }
}

function openMappingModal(accountId, accountName, companyId) {
  const cat = prompt(`Map "${accountName}" to consolidation category:\n\n(e.g., Revenue, COGS, Operating Expenses, Fixed Assets, Current Liabilities, Equity)`);
  if (!cat) return;
  const sub = prompt("Subcategory (optional):\n\n(e.g., Food Revenue, Rent, Payroll)");
  apiPost("/api/account-mappings", { company_id: companyId, qbo_account_id: accountId, qbo_account_name: accountName, consolidated_category: cat, consolidated_subcategory: sub || null })
    .then(() => { showToast("Mapping saved.", "success"); loadAccountMappings(); })
    .catch((e) => showToast("Error: " + e.message, "error"));
}

async function loadAccountMappings() {
  try {
    const mappings = await apiGet("/api/account-mappings");
    const el = document.getElementById("account-mappings-list");
    if (!mappings.length) { el.innerHTML = '<p class="text-muted" style="padding:var(--space-4);font-size:var(--text-sm);">No mappings yet.</p>'; return; }
    let html = '<table class="data-table"><thead><tr><th>Company</th><th>QBO Account</th><th>Category</th><th>Subcategory</th><th>Action</th></tr></thead><tbody>';
    for (const m of mappings)
      html += `<tr><td>${m.company_name || "-"}</td><td>${m.qbo_account_name}</td><td>${m.consolidated_category}</td><td>${m.consolidated_subcategory || "-"}</td><td><button class="btn btn-sm btn-ghost" onclick="deleteMapping('${m.id}')" style="color:var(--color-error);">Remove</button></td></tr>`;
    el.innerHTML = html + "</tbody></table>";
  } catch { /* ok */ }
}

async function deleteMapping(id) {
  try { await apiDelete(`/api/account-mappings/${id}`); loadAccountMappings(); }
  catch (e) { showToast("Error: " + e.message, "error"); }
}

// --- Init ---
document.getElementById("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
