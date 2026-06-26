/**
 * PreTrack — Sellers Page
 * Seller cards with spend summary, per-seller order list, dues indicator.
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
let activeSeller = null;

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
    showToast('Failed to load sellers', 'error');
  }

  renderSellerCards();
  initSearch();
})();

function buildPageHTML() {
  document.getElementById('section-sellers').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">Sellers</h2><p class="section-sub">Vendor breakdown with payment tracking</p></div>
    </div>

    <div class="filters-bar glass" style="margin-bottom:1rem">
      <div class="filter-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="sellerSearch" placeholder="Search seller..." />
      </div>
      <select id="sellerSort" class="filter-select">
        <option value="spend">Most Spent</option>
        <option value="orders">Most Orders</option>
        <option value="pending">Highest Pending</option>
        <option value="az">A–Z</option>
      </select>
    </div>

    <div class="sellers-layout">
      <div class="sellers-cards-col" id="sellerCardsCol"></div>
      <div class="seller-detail-panel glass hidden" id="sellerDetailPanel">
        <div class="seller-detail-header">
          <div>
            <div class="seller-detail-name" id="sellerDetailName">—</div>
            <div class="seller-detail-sub" id="sellerDetailSub">—</div>
          </div>
          <button class="modal-close" id="sellerDetailClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="seller-detail-stats" id="sellerDetailStats"></div>
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:.75rem 0 .5rem;padding:0 .1rem">Orders</div>
        <div id="sellerOrdersList"></div>
      </div>
    </div>
  `;
}

function buildSellerMap(search = '', sort = 'spend') {
  const map = {};
  orders.forEach(o => {
    const v = o.vendor?.trim() || 'Unknown';
    if (!map[v]) map[v] = { name: v, orders: [], total: 0, paid: 0, pending: 0, delivered: 0 };
    map[v].orders.push(o);
    map[v].total   += o.total   || 0;
    map[v].paid    += o.paid    || 0;
    map[v].pending += o.pending || 0;
    if (o.status === 'Delivered') map[v].delivered++;
  });

  let sellers = Object.values(map);
  if (search) sellers = sellers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  sellers.sort((a, b) => {
    if (sort === 'orders')  return b.orders.length - a.orders.length;
    if (sort === 'pending') return b.pending - a.pending;
    if (sort === 'az')      return a.name.localeCompare(b.name);
    return b.total - a.total; // spend
  });

  return sellers;
}

function renderSellerCards() {
  const search  = document.getElementById('sellerSearch')?.value  || '';
  const sort    = document.getElementById('sellerSort')?.value    || 'spend';
  const sellers = buildSellerMap(search, sort);
  const col     = document.getElementById('sellerCardsCol');

  if (!sellers.length) {
    col.innerHTML = '<div class="empty-state"><i class="fa-solid fa-store"></i> No sellers found</div>';
    return;
  }

  col.innerHTML = sellers.map(s => {
    const pct         = s.total > 0 ? Math.round(s.paid / s.total * 100) : 0;
    const delivRate   = s.orders.length > 0 ? Math.round(s.delivered / s.orders.length * 100) : 0;
    const hasDues     = s.pending > 0;
    return `
    <div class="seller-card glass ${activeSeller === s.name ? 'active' : ''}" data-seller="${escHtml(s.name)}">
      <div class="seller-card-top">
        <div class="seller-avatar">${s.name[0].toUpperCase()}</div>
        <div class="seller-card-info">
          <div class="seller-card-name">${escHtml(s.name)}</div>
          <div class="seller-card-meta">${s.orders.length} order${s.orders.length !== 1 ? 's' : ''} · ${delivRate}% delivered</div>
        </div>
        ${hasDues
          ? `<span class="seller-dues-badge"><i class="fa-solid fa-exclamation"></i> Due</span>`
          : `<span class="seller-paid-badge"><i class="fa-solid fa-check"></i> Clear</span>`}
      </div>
      <div class="seller-card-stats">
        <div class="scs-item"><span class="scs-label">Spent</span><span class="scs-val">${formatINR(s.total)}</span></div>
        <div class="scs-item"><span class="scs-label">Paid</span><span class="scs-val" style="color:#22c55e">${formatINR(s.paid)}</span></div>
        <div class="scs-item"><span class="scs-label">Pending</span><span class="scs-val" style="color:${hasDues?'#f97316':'#22c55e'}">${formatINR(s.pending)}</span></div>
      </div>
      <div class="seller-pay-bar">
        <div class="seller-pay-bar-fill" style="width:${pct}%"></div>
      </div>
      <div style="font-size:.65rem;color:var(--text-muted);margin-top:.2rem">${pct}% paid</div>
    </div>`;
  }).join('');

  col.querySelectorAll('.seller-card').forEach(card => {
    card.addEventListener('click', () => openSellerDetail(card.dataset.seller));
  });
}

function openSellerDetail(sellerName) {
  activeSeller = sellerName;
  renderSellerCards(); // re-render to show active state

  const seller  = buildSellerMap().find(s => s.name === sellerName);
  if (!seller) return;

  const panel = document.getElementById('sellerDetailPanel');
  panel.classList.remove('hidden');

  document.getElementById('sellerDetailName').textContent = seller.name;
  document.getElementById('sellerDetailSub').textContent  = `${seller.orders.length} orders · ${formatINR(seller.total)} total`;

  const pct       = seller.total > 0 ? Math.round(seller.paid / seller.total * 100) : 0;
  const delRate   = seller.orders.length > 0 ? Math.round(seller.delivered / seller.orders.length * 100) : 0;
  document.getElementById('sellerDetailStats').innerHTML = `
    <div class="sd-stat"><div class="sd-stat-val">${seller.orders.length}</div><div class="sd-stat-label">Orders</div></div>
    <div class="sd-stat"><div class="sd-stat-val" style="color:#22c55e">${formatINR(seller.paid)}</div><div class="sd-stat-label">Paid</div></div>
    <div class="sd-stat"><div class="sd-stat-val" style="color:${seller.pending>0?'#f97316':'#22c55e'}">${formatINR(seller.pending)}</div><div class="sd-stat-label">Pending</div></div>
    <div class="sd-stat"><div class="sd-stat-val">${delRate}%</div><div class="sd-stat-label">Delivered</div></div>`;

  const today = new Date().toISOString().slice(0,10);
  document.getElementById('sellerOrdersList').innerHTML = seller.orders.map(o => {
    const isOverdue   = o.eta && o.eta < today && o.status !== 'Delivered' && o.status !== 'Cancelled';
    const statusClass = { Ordered:'status-ordered','In Transit':'status-transit',Delivered:'status-delivered',Cancelled:'status-cancelled' }[o.status] || '';
    return `
    <div class="seller-order-row">
      <div class="seller-order-thumb">
        ${o.imageUrl ? `<img src="${escHtml(o.imageUrl)}" />` : `<i class="fa-solid fa-car-side"></i>`}
      </div>
      <div class="seller-order-info">
        <div class="seller-order-name">${escHtml(o.productName)}</div>
        <div class="seller-order-meta">${escHtml(o.brand||'—')} · ETA: <span ${isOverdue?'style="color:#ef4444"':''}>${formatDate(o.eta)}</span></div>
        <span class="status-badge ${statusClass}">${o.status}</span>
      </div>
      <div class="seller-order-price">
        <div style="font-weight:800;font-size:.82rem">${formatINR(o.total)}</div>
        ${o.pending > 0 ? `<div style="font-size:.68rem;color:#f97316">Due: ${formatINR(o.pending)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('sellerDetailClose').onclick = () => {
    panel.classList.add('hidden');
    activeSeller = null;
    renderSellerCards();
  };
}

function initSearch() {
  document.getElementById('sellerSearch')?.addEventListener('input',  renderSellerCards);
  document.getElementById('sellerSort')?.addEventListener('change',   renderSellerCards);
}
