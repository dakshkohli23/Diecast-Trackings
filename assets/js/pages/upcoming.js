/**
 * PreTrack — Upcoming Deliveries Page
 * Orders sorted by ETA, urgency color-coding, overdue alerts.
 */

import { requireAuth }  from '../auth/auth-guard.js';
import { db }           from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, setText, escHtml, formatDate, formatINR
} from './dashboard-shell.js';
import { getDocs, collection, query, orderBy }
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

  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    showToast('Failed to load upcoming orders', 'error');
  }

  renderAll();
  initFilters();
})();

function buildPageHTML() {
  document.getElementById('section-upcoming').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">Upcoming Deliveries</h2><p class="section-sub">ETA timeline — overdue &amp; incoming</p></div>
    </div>

    <!-- Summary strip -->
    <div class="upcoming-summary" id="upcomingSummary"></div>

    <!-- Tabs -->
    <div class="upcoming-tabs" id="upcomingTabs">
      <button class="upcoming-tab active" data-tab="overdue">🔴 Overdue</button>
      <button class="upcoming-tab" data-tab="week">🟠 This Week</button>
      <button class="upcoming-tab" data-tab="month">🟣 This Month</button>
      <button class="upcoming-tab" data-tab="all">📦 All Pending</button>
    </div>

    <!-- Filter -->
    <div class="filters-bar glass" style="margin:.75rem 0">
      <div class="filter-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="upSearch" placeholder="Search..." />
      </div>
      <select id="upBrand" class="filter-select"><option value="">All Brands</option></select>
      <select id="upSeller" class="filter-select"><option value="">All Sellers</option></select>
    </div>

    <div id="upcomingContent"></div>
  `;
}

let activeTab = 'overdue';

function renderAll() {
  const today = new Date().toISOString().slice(0,10);
  const week  = new Date(); week.setDate(week.getDate() + 7);
  const wKey  = week.toISOString().slice(0,10);
  const month = new Date(); month.setDate(month.getDate() + 30);
  const mKey  = month.toISOString().slice(0,10);

  const pending = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled');
  const overdue = pending.filter(o => o.eta && o.eta < today);
  const thisWeek = pending.filter(o => o.eta && o.eta >= today && o.eta <= wKey);
  const thisMonth = pending.filter(o => o.eta && o.eta > wKey && o.eta <= mKey);
  const noEta = pending.filter(o => !o.eta);

  // Summary
  document.getElementById('upcomingSummary').innerHTML = `
    <div class="upcoming-sum-card" style="border-color:rgba(239,68,68,.3)">
      <div class="usc-val" style="color:#ef4444">${overdue.length}</div>
      <div class="usc-label">Overdue</div>
    </div>
    <div class="upcoming-sum-card" style="border-color:rgba(249,115,22,.3)">
      <div class="usc-val" style="color:#f97316">${thisWeek.length}</div>
      <div class="usc-label">This Week</div>
    </div>
    <div class="upcoming-sum-card" style="border-color:rgba(124,92,252,.3)">
      <div class="usc-val" style="color:#7c5cfc">${thisMonth.length}</div>
      <div class="usc-label">This Month</div>
    </div>
    <div class="upcoming-sum-card">
      <div class="usc-val">${pending.length}</div>
      <div class="usc-label">Total Pending</div>
    </div>`;

  // Badge in nav
  const badge = document.getElementById('upcomingBadge');
  if (badge && overdue.length > 0) {
    badge.textContent = overdue.length;
    badge.style.display = 'inline-flex';
  }

  // Populate selects
  const brands  = [...new Set(orders.map(o => o.brand).filter(Boolean))].sort();
  const sellers = [...new Set(orders.map(o => o.vendor).filter(Boolean))].sort();
  const bSel    = document.getElementById('upBrand');
  const sSel    = document.getElementById('upSeller');
  if (bSel) bSel.innerHTML = '<option value="">All Brands</option>' + brands.map(b => `<option>${escHtml(b)}</option>`).join('');
  if (sSel) sSel.innerHTML = '<option value="">All Sellers</option>' + sellers.map(s => `<option>${escHtml(s)}</option>`).join('');

  renderTab(overdue, thisWeek, thisMonth, pending);
  initTabs(overdue, thisWeek, thisMonth, pending);
}

function initTabs(overdue, thisWeek, thisMonth, pending) {
  document.querySelectorAll('.upcoming-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.upcoming-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderTab(overdue, thisWeek, thisMonth, pending);
    });
  });
}

function renderTab(overdue, thisWeek, thisMonth, pending) {
  const search = (document.getElementById('upSearch')?.value  || '').toLowerCase();
  const brand  =  document.getElementById('upBrand')?.value   || '';
  const seller =  document.getElementById('upSeller')?.value  || '';

  const filter = (list) => list.filter(o =>
    (!search || (o.productName||'').toLowerCase().includes(search) || (o.brand||'').toLowerCase().includes(search)) &&
    (!brand  || o.brand  === brand) &&
    (!seller || o.vendor === seller)
  );

  const map = { overdue: filter(overdue), week: filter(thisWeek), month: filter(thisMonth), all: filter(pending) };
  const list = map[activeTab] || [];

  const today = new Date().toISOString().slice(0,10);
  const content = document.getElementById('upcomingContent');

  if (!list.length) {
    content.innerHTML = '<div class="empty-state glass" style="border-radius:14px;padding:3rem"><i class="fa-solid fa-inbox"></i> Nothing here</div>';
    return;
  }

  const sorted = [...list].sort((a, b) => {
    if (!a.eta && !b.eta) return 0;
    if (!a.eta) return 1;
    if (!b.eta) return -1;
    return a.eta.localeCompare(b.eta);
  });

  const getUrgency = (o) => {
    if (!o.eta) return { color: '#9090b8', label: 'No ETA', bg: 'rgba(144,144,184,.1)' };
    if (o.eta < today) return { color: '#ef4444', label: 'Overdue', bg: 'rgba(239,68,68,.08)' };
    const days = Math.ceil((new Date(o.eta) - new Date(today)) / 86400000);
    if (days <= 3)  return { color: '#ef4444', label: `${days}d left`, bg: 'rgba(239,68,68,.06)' };
    if (days <= 7)  return { color: '#f97316', label: `${days}d left`, bg: 'rgba(249,115,22,.06)' };
    if (days <= 30) return { color: '#7c5cfc', label: `${days}d left`, bg: 'rgba(124,92,252,.06)' };
    return { color: '#22c55e', label: `${days}d left`, bg: 'rgba(34,197,94,.06)' };
  };

  const statusClass = (s) => ({ Ordered:'status-ordered','In Transit':'status-transit',Delivered:'status-delivered',Cancelled:'status-cancelled' }[s] || '');

  content.innerHTML = sorted.map(o => {
    const urg = getUrgency(o);
    return `
    <div class="upcoming-row glass" style="background:${urg.bg}">
      <div class="upcoming-thumb">
        ${o.imageUrl ? `<img src="${escHtml(o.imageUrl)}" />` : `<i class="fa-solid fa-car-side"></i>`}
      </div>
      <div class="upcoming-info">
        <div class="upcoming-name">${escHtml(o.productName)}</div>
        <div class="upcoming-meta">${escHtml(o.brand||'—')} · ${escHtml(o.vendor||'—')}</div>
        <span class="status-badge ${statusClass(o.status)}">${o.status}</span>
      </div>
      <div class="upcoming-right">
        <div class="upcoming-eta" style="color:${urg.color}">
          <i class="fa-solid fa-calendar-day"></i> ${formatDate(o.eta)}
        </div>
        <div class="upcoming-urgency" style="color:${urg.color};font-size:.68rem;font-weight:800">${urg.label}</div>
        <div class="upcoming-price">${formatINR(o.total)}</div>
        ${o.pending > 0 ? `<div style="font-size:.68rem;color:#f97316">Due: ${formatINR(o.pending)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function initFilters() {
  ['upSearch','upBrand','upSeller'].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  renderAll);
    document.getElementById(id)?.addEventListener('change', renderAll);
  });
}
