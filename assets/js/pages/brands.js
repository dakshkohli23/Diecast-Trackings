/**
 * PreTrack — Brands Page
 * Per-brand spending, model count, delivery rate, drill-down.
 */

import { requireAuth }  from '../auth/auth-guard.js';
import { db }           from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, escHtml, formatDate, formatINR
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
let activeBrand = null;

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
    showToast('Failed to load brands', 'error');
  }

  renderBrandCards();
  initFilters();
})();

function buildPageHTML() {
  document.getElementById('section-brands').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">Brands</h2><p class="section-sub">Per-brand spending, models &amp; delivery rate</p></div>
    </div>

    <div class="filters-bar glass" style="margin-bottom:1rem">
      <div class="filter-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="brandSearch" placeholder="Search brand..." />
      </div>
      <select id="brandSort" class="filter-select">
        <option value="orders">Most Orders</option>
        <option value="spend">Most Spent</option>
        <option value="delivered">Most Delivered</option>
        <option value="az">A–Z</option>
      </select>
    </div>

    <div class="brands-layout">
      <div class="brands-grid-col" id="brandsGridCol"></div>
      <div class="brand-detail-panel glass hidden" id="brandDetailPanel">
        <div class="seller-detail-header">
          <div>
            <div class="seller-detail-name" id="brandDetailName">—</div>
            <div class="seller-detail-sub" id="brandDetailSub">—</div>
          </div>
          <button class="modal-close" id="brandDetailClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="seller-detail-stats" id="brandDetailStats"></div>
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:.75rem 0 .5rem;padding:0 .1rem">Models</div>
        <div id="brandOrdersList"></div>
      </div>
    </div>
  `;
}

const BRAND_COLORS = ['#7c5cfc','#6366f1','#ec4899','#f97316','#14b8a6','#22c55e','#0284c7','#a855f7'];

function buildBrandMap(search = '', sort = 'orders') {
  const map = {};
  orders.forEach(o => {
    const b = o.brand?.trim() || '?';
    if (!map[b]) map[b] = { name: b, orders: [], total: 0, paid: 0, pending: 0, delivered: 0, qty: 0 };
    map[b].orders.push(o);
    map[b].total   += o.total   || 0;
    map[b].paid    += o.paid    || 0;
    map[b].pending += o.pending || 0;
    map[b].qty     += o.qty     || 1;
    if (o.status === 'Delivered') map[b].delivered++;
  });

  let brands = Object.values(map);
  if (search) brands = brands.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));

  brands.sort((a, b) => {
    if (sort === 'spend')     return b.total     - a.total;
    if (sort === 'delivered') return b.delivered - a.delivered;
    if (sort === 'az')        return a.name.localeCompare(b.name);
    return b.orders.length - a.orders.length;
  });

  return brands;
}

function renderBrandCards() {
  const search = document.getElementById('brandSearch')?.value || '';
  const sort   = document.getElementById('brandSort')?.value   || 'orders';
  const brands = buildBrandMap(search, sort);
  const col    = document.getElementById('brandsGridCol');

  if (!brands.length) {
    col.innerHTML = '<div class="empty-state"><i class="fa-solid fa-building"></i> No brands found</div>';
    return;
  }

  const maxOrders = brands[0]?.orders.length || 1;

  col.innerHTML = brands.map((b, i) => {
    const color    = BRAND_COLORS[i % BRAND_COLORS.length];
    const delRate  = b.orders.length > 0 ? Math.round(b.delivered / b.orders.length * 100) : 0;
    const barWidth = Math.round(b.orders.length / maxOrders * 100);
    return `
    <div class="brand-card glass ${activeBrand === b.name ? 'active' : ''}" data-brand="${escHtml(b.name)}" style="${activeBrand===b.name?`border-color:${color}`:''}">
      <div class="brand-card-top">
        <div class="brand-avatar" style="background:${color}20;color:${color}">${b.name.slice(0,2).toUpperCase()}</div>
        <div class="brand-card-info">
          <div class="brand-card-name">${escHtml(b.name)}</div>
          <div class="brand-card-meta">${b.qty} unit${b.qty!==1?'s':''} · ${b.orders.length} order${b.orders.length!==1?'s':''}</div>
        </div>
      </div>
      <div class="brand-card-stats">
        <div class="brand-stat"><span class="brand-stat-label">Spend</span><span class="brand-stat-val">${formatINR(b.total)}</span></div>
        <div class="brand-stat"><span class="brand-stat-label">Delivered</span><span class="brand-stat-val" style="color:#22c55e">${b.delivered}</span></div>
        <div class="brand-stat"><span class="brand-stat-label">Rate</span><span class="brand-stat-val">${delRate}%</span></div>
      </div>
      <div class="lb-bar-track" style="margin-top:.6rem">
        <div class="lb-bar-fill" style="width:${barWidth}%;background:${color}"></div>
      </div>
    </div>`;
  }).join('');

  col.querySelectorAll('.brand-card').forEach(card => {
    card.addEventListener('click', () => openBrandDetail(card.dataset.brand));
  });
}

function openBrandDetail(brandName) {
  activeBrand = brandName;
  renderBrandCards();

  const brand = buildBrandMap().find(b => b.name === brandName);
  if (!brand) return;

  const panel = document.getElementById('brandDetailPanel');
  panel.classList.remove('hidden');

  document.getElementById('brandDetailName').textContent = brand.name;
  document.getElementById('brandDetailSub').textContent  = `${brand.orders.length} orders · ${brand.qty} units`;

  const delRate = brand.orders.length > 0 ? Math.round(brand.delivered / brand.orders.length * 100) : 0;
  document.getElementById('brandDetailStats').innerHTML = `
    <div class="sd-stat"><div class="sd-stat-val">${brand.orders.length}</div><div class="sd-stat-label">Orders</div></div>
    <div class="sd-stat"><div class="sd-stat-val">${brand.qty}</div><div class="sd-stat-label">Units</div></div>
    <div class="sd-stat"><div class="sd-stat-val">${formatINR(brand.total)}</div><div class="sd-stat-label">Spent</div></div>
    <div class="sd-stat"><div class="sd-stat-val">${delRate}%</div><div class="sd-stat-label">Delivered</div></div>`;

  const today = new Date().toISOString().slice(0,10);
  document.getElementById('brandOrdersList').innerHTML = brand.orders.map(o => {
    const isOverdue   = o.eta && o.eta < today && o.status !== 'Delivered' && o.status !== 'Cancelled';
    const statusClass = { Ordered:'status-ordered','In Transit':'status-transit',Delivered:'status-delivered',Cancelled:'status-cancelled' }[o.status] || '';
    return `
    <div class="seller-order-row">
      <div class="seller-order-thumb">
        ${o.imageUrl ? `<img src="${escHtml(o.imageUrl)}" />` : `<i class="fa-solid fa-car-side"></i>`}
      </div>
      <div class="seller-order-info">
        <div class="seller-order-name">${escHtml(o.productName)}</div>
        <div class="seller-order-meta">${o.scale||'—'} · ETA: <span ${isOverdue?'style="color:#ef4444"':''}>${formatDate(o.eta)}</span></div>
        <span class="status-badge ${statusClass}">${o.status}</span>
      </div>
      <div class="seller-order-price">
        <div style="font-weight:800;font-size:.82rem">${formatINR(o.total)}</div>
        ${o.pending > 0 ? `<div style="font-size:.68rem;color:#f97316">Due: ${formatINR(o.pending)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('brandDetailClose').onclick = () => {
    panel.classList.add('hidden');
    activeBrand = null;
    renderBrandCards();
  };
}

function initFilters() {
  document.getElementById('brandSearch')?.addEventListener('input',  renderBrandCards);
  document.getElementById('brandSort')?.addEventListener('change',   renderBrandCards);
}
