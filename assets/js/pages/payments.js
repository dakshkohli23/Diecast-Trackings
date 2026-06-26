/**
 * PreTrack — Payments Page
 * Per-order payment tracking, per-seller summary, running dues.
 */

import { requireAuth }  from '../auth/auth-guard.js';
import { db }           from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, setText, escHtml, formatDate, formatINR
} from './dashboard-shell.js';
import { getDocs, updateDoc, collection, doc, query, orderBy }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

let orders = [];

(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();
  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);
  syncTopbarAvatar({ email: user.email, role });

  buildPageHTML();
  await fetchOrders();
})();

function buildPageHTML() {
  document.getElementById('section-payments').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">Payments</h2><p class="section-sub">Track dues, paid amounts &amp; seller balances</p></div>
    </div>

    <!-- Summary cards -->
    <div class="payment-summary" id="paymentSummary"></div>

    <!-- Filter -->
    <div class="filters-bar glass" style="margin-bottom:1rem">
      <select id="payFilterSeller" class="filter-select"><option value="">All Sellers</option></select>
      <select id="payFilterStatus" class="filter-select">
        <option value="">All</option>
        <option value="pending">Has Pending</option>
        <option value="paid">Fully Paid</option>
      </select>
      <input type="text" id="paySearch" class="filter-select" style="flex:1;border:1px solid var(--glass-border);background:var(--glass-bg);padding:.5rem .85rem;border-radius:var(--radius-sm);color:var(--text-primary);font-family:inherit" placeholder="Search..." />
    </div>

    <!-- Per-order table -->
    <div class="widget glass" style="overflow-x:auto">
      <div class="widget-header"><h3><i class="fa-solid fa-receipt"></i> Order Payments</h3></div>
      <table class="orders-table" id="paymentsTable">
        <thead><tr><th>Product</th><th>Brand</th><th>Seller</th><th>Total</th><th>Paid</th><th>Pending</th><th>Progress</th><th>ETA</th><th>Quick Pay</th></tr></thead>
        <tbody id="paymentsBody"></tbody>
      </table>
    </div>

    <!-- Per-seller summary -->
    <div class="widget glass" style="margin-top:1.5rem">
      <div class="widget-header"><h3><i class="fa-solid fa-store"></i> Seller Summary</h3></div>
      <div id="sellerPaymentSummary"></div>
    </div>

    <!-- Quick pay modal -->
    <div class="modal-overlay hidden" id="quickPayModal">
      <div class="modal glass" style="max-width:380px">
        <div class="modal-header" style="padding:1.25rem 1.25rem 0">
          <h3>Quick Pay</h3>
          <button class="modal-close" id="qpClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div style="padding:1.25rem">
          <p id="qpLabel" style="font-size:.82rem;color:var(--text-muted);margin-bottom:1rem"></p>
          <label class="fg-label">Amount to Mark Paid (₹)</label>
          <input type="number" id="qpAmount" class="fg-input" style="margin-bottom:1rem" min="0" />
          <div style="display:flex;gap:.6rem">
            <button class="btn btn-ghost" id="qpCancel" style="flex:1">Cancel</button>
            <button class="btn btn-primary" id="qpSave" style="flex:1"><i class="fa-solid fa-check"></i> Save</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function fetchOrders() {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    populateSellerFilter();
    renderAll();
    initFilters();
    initQuickPay();
  } catch (e) {
    showToast('Failed to load payments', 'error');
  }
}

function populateSellerFilter() {
  const sellers = [...new Set(orders.map(o => o.vendor).filter(Boolean))].sort();
  const sel = document.getElementById('payFilterSeller');
  sel.innerHTML = '<option value="">All Sellers</option>' +
    sellers.map(s => `<option>${escHtml(s)}</option>`).join('');
}

function initFilters() {
  ['payFilterSeller','payFilterStatus','paySearch'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', renderAll)
  );
}

function getFiltered() {
  const seller = document.getElementById('payFilterSeller')?.value || '';
  const status = document.getElementById('payFilterStatus')?.value || '';
  const search = (document.getElementById('paySearch')?.value || '').toLowerCase();
  return orders.filter(o =>
    (!seller || o.vendor === seller) &&
    (!status || (status === 'pending' ? (o.pending||0) > 0 : (o.pending||0) === 0)) &&
    (!search || (o.productName||'').toLowerCase().includes(search) || (o.vendor||'').toLowerCase().includes(search))
  );
}

function renderAll() {
  const filtered = getFiltered();
  renderSummary(filtered);
  renderTable(filtered);
  renderSellerSummary(filtered);
}

function renderSummary(list) {
  const total   = list.reduce((s, o) => s + (o.total   || 0), 0);
  const paid    = list.reduce((s, o) => s + (o.paid    || 0), 0);
  const pending = list.reduce((s, o) => s + (o.pending || 0), 0);
  const pct     = total > 0 ? Math.round(paid / total * 100) : 0;

  document.getElementById('paymentSummary').innerHTML = `
    <div class="stat-card glass"><div class="stat-label">Total Value</div><div class="stat-value">${formatINR(total)}</div></div>
    <div class="stat-card glass"><div class="stat-label">Total Paid</div><div class="stat-value" style="color:#22c55e">${formatINR(paid)}</div></div>
    <div class="stat-card glass"><div class="stat-label">Total Pending</div><div class="stat-value" style="color:#f97316">${formatINR(pending)}</div></div>
    <div class="stat-card glass">
      <div class="stat-label">Payment Progress</div>
      <div class="stat-value">${pct}%</div>
      <div style="margin-top:.5rem;height:6px;background:rgba(0,0,0,0.08);border-radius:3px">
        <div style="width:${pct}%;height:100%;background:#22c55e;border-radius:3px;transition:width .5s"></div>
      </div>
    </div>`;
}

function renderTable(list) {
  const tbody = document.getElementById('paymentsBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No payments found</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(o => {
    const pct = o.total > 0 ? Math.round((o.paid||0) / o.total * 100) : 0;
    const today = new Date().toISOString().slice(0,10);
    const isOverdue = o.eta && o.eta < today && o.status !== 'Delivered';
    return `<tr>
      <td><strong>${escHtml(o.productName)}</strong></td>
      <td>${escHtml(o.brand||'—')}</td>
      <td>${escHtml(o.vendor||'—')}</td>
      <td>${formatINR(o.total)}</td>
      <td style="color:#22c55e">${formatINR(o.paid)}</td>
      <td style="color:${(o.pending||0)>0?'#f97316':'#22c55e'}">${formatINR(o.pending)}</td>
      <td style="min-width:120px">
        <div style="display:flex;align-items:center;gap:.5rem">
          <div style="flex:1;height:6px;background:rgba(0,0,0,0.08);border-radius:3px">
            <div style="width:${pct}%;height:100%;background:#22c55e;border-radius:3px"></div>
          </div>
          <span style="font-size:.68rem;color:var(--text-muted);white-space:nowrap">${pct}%</span>
        </div>
      </td>
      <td style="${isOverdue?'color:#ef4444':''}">${formatDate(o.eta)}</td>
      <td>
        ${(o.pending||0) > 0
          ? `<button class="btn btn-primary btn-sm qp-btn" data-id="${o.id}" data-name="${escHtml(o.productName)}" data-pending="${o.pending}">Pay</button>`
          : `<span style="color:#22c55e;font-size:.75rem;font-weight:700"><i class="fa-solid fa-check"></i> Paid</span>`}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.qp-btn').forEach(btn => {
    btn.addEventListener('click', () => openQuickPay(btn.dataset.id, btn.dataset.name, +btn.dataset.pending));
  });
}

function renderSellerSummary(list) {
  const map = {};
  list.forEach(o => {
    const v = o.vendor || 'Unknown';
    if (!map[v]) map[v] = { total: 0, paid: 0, pending: 0, count: 0 };
    map[v].total   += o.total   || 0;
    map[v].paid    += o.paid    || 0;
    map[v].pending += o.pending || 0;
    map[v].count++;
  });

  const rows = Object.entries(map).sort((a, b) => b[1].pending - a[1].pending);
  const el   = document.getElementById('sellerPaymentSummary');
  if (!rows.length) { el.innerHTML = '<div class="empty-state">No seller data</div>'; return; }

  el.innerHTML = `<div style="overflow-x:auto"><table class="orders-table">
    <thead><tr><th>Seller</th><th>Orders</th><th>Total</th><th>Paid</th><th>Pending</th><th>Health</th></tr></thead>
    <tbody>${rows.map(([seller, s]) => {
      const pct = s.total > 0 ? Math.round(s.paid/s.total*100) : 0;
      return `<tr>
        <td><strong>${escHtml(seller)}</strong></td>
        <td>${s.count}</td>
        <td>${formatINR(s.total)}</td>
        <td style="color:#22c55e">${formatINR(s.paid)}</td>
        <td style="color:${s.pending>0?'#f97316':'#22c55e'}">${formatINR(s.pending)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:.5rem">
            <div style="flex:1;height:6px;background:rgba(0,0,0,0.08);border-radius:3px">
              <div style="width:${pct}%;height:100%;background:${pct===100?'#22c55e':'#7c5cfc'};border-radius:3px"></div>
            </div>
            <span style="font-size:.68rem">${pct}%</span>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

let qpOrderId = null;
function openQuickPay(id, name, pending) {
  qpOrderId = id;
  setText('qpLabel', `Mark payment for: ${name} (pending: ${formatINR(pending)})`);
  const amtEl = document.getElementById('qpAmount');
  if (amtEl) amtEl.value = pending;
  document.getElementById('quickPayModal').classList.remove('hidden');
}

function initQuickPay() {
  document.getElementById('qpClose')?.addEventListener('click', closeQP);
  document.getElementById('qpCancel')?.addEventListener('click', closeQP);
  document.getElementById('quickPayModal')?.addEventListener('click', e => { if (e.target.id === 'quickPayModal') closeQP(); });
  document.getElementById('qpSave')?.addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('qpAmount')?.value) || 0;
    if (!qpOrderId || amount <= 0) return;
    const order = orders.find(o => o.id === qpOrderId);
    if (!order) return;
    const newPaid    = (order.paid || 0) + amount;
    const newPending = Math.max(0, (order.total || 0) - newPaid);
    try {
      await updateDoc(doc(db, 'orders', qpOrderId), { paid: newPaid, pending: newPending });
      showToast('Payment updated!', 'success');
      closeQP();
      await fetchOrders();
    } catch (e) {
      showToast('Failed to save payment', 'error');
    }
  });
}

function closeQP() {
  document.getElementById('quickPayModal').classList.add('hidden');
  qpOrderId = null;
}
