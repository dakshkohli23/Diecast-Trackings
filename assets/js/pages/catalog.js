/**
 * PreTrack — Catalog Page
 * Read-only browsable catalog of all models with image grid + search.
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
    showToast('Failed to load catalog', 'error');
  }

  renderCatalog();
  initFilters();
})();

function buildPageHTML() {
  document.getElementById('section-catalog').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">Catalog</h2><p class="section-sub">Browse your complete diecast collection</p></div>
    </div>

    <div class="filters-bar glass" style="margin-bottom:1rem">
      <div class="filter-search" style="flex:2">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="catSearch" placeholder="Search models, brands..." />
      </div>
      <select id="catBrand" class="filter-select"><option value="">All Brands</option></select>
      <select id="catScale" class="filter-select">
        <option value="">All Scales</option>
        <option>1:64</option><option>1:43</option><option>1:18</option><option>1:24</option><option>1:12</option>
      </select>
      <select id="catStatus" class="filter-select">
        <option value="">All Statuses</option>
        <option>Ordered</option><option>In Transit</option><option>Delivered</option><option>Cancelled</option>
      </select>
      <select id="catSort" class="filter-select">
        <option value="newest">Newest</option>
        <option value="name">Name A–Z</option>
        <option value="brand">Brand A–Z</option>
        <option value="price-hi">Price ↓</option>
        <option value="price-lo">Price ↑</option>
      </select>
      <button class="btn btn-ghost" id="catClear"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="col-toolbar">
      <span class="col-count" id="catCount">0 models</span>
    </div>

    <div class="catalog-masonry" id="catalogGrid"></div>

    <!-- Detail modal -->
    <div class="modal-overlay hidden" id="catModal">
      <div class="modal-view-new glass" id="catModalBox"></div>
    </div>
  `;

  // Populate brand dropdown
  const brands = [...new Set(orders.map(o => o.brand).filter(Boolean))].sort();
  const sel    = document.getElementById('catBrand');
  if (sel) sel.innerHTML = '<option value="">All Brands</option>' + brands.map(b => `<option>${escHtml(b)}</option>`).join('');
}

function getFiltered() {
  const search = (document.getElementById('catSearch')?.value  || '').toLowerCase();
  const brand  =  document.getElementById('catBrand')?.value   || '';
  const scale  =  document.getElementById('catScale')?.value   || '';
  const status =  document.getElementById('catStatus')?.value  || '';
  const sort   =  document.getElementById('catSort')?.value    || 'newest';

  let list = orders.filter(o =>
    (!search || (o.productName||'').toLowerCase().includes(search) || (o.brand||'').toLowerCase().includes(search)) &&
    (!brand  || o.brand  === brand) &&
    (!scale  || o.scale  === scale) &&
    (!status || o.status === status)
  );

  list.sort((a, b) => {
    if (sort === 'name')     return (a.productName||'').localeCompare(b.productName||'');
    if (sort === 'brand')    return (a.brand||'').localeCompare(b.brand||'');
    if (sort === 'price-hi') return (b.total||0) - (a.total||0);
    if (sort === 'price-lo') return (a.total||0) - (b.total||0);
    return 0; // newest = DB order
  });

  return list;
}

function renderCatalog() {
  const list  = getFiltered();
  const grid  = document.getElementById('catalogGrid');
  const today = new Date().toISOString().slice(0,10);

  document.getElementById('catCount').textContent = `${list.length} model${list.length!==1?'s':''}`;

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i> No models found</div>';
    return;
  }

  const statusColors = { Ordered:'#7c5cfc','In Transit':'#14b8a6',Delivered:'#22c55e',Cancelled:'#ef4444' };

  grid.innerHTML = list.map(o => {
    const isOverdue = o.eta && o.eta < today && o.status !== 'Delivered' && o.status !== 'Cancelled';
    const color     = statusColors[o.status] || '#7c5cfc';
    return `
    <div class="catalog-card glass" data-id="${o.id}">
      <div class="catalog-card-img">
        ${o.imageUrl
          ? `<img src="${escHtml(o.imageUrl)}" alt="${escHtml(o.productName)}" loading="lazy" />`
          : `<div class="catalog-no-img"><i class="fa-solid fa-car-side"></i></div>`}
        <div class="catalog-card-status-dot" style="background:${color}" title="${o.status}"></div>
        ${isOverdue ? '<div class="catalog-overdue-flag"><i class="fa-solid fa-triangle-exclamation"></i></div>' : ''}
      </div>
      <div class="catalog-card-body">
        <div class="catalog-card-name">${escHtml(o.productName)}</div>
        <div class="catalog-card-brand">${escHtml(o.brand||'—')}</div>
        <div class="catalog-card-footer">
          <span class="catalog-scale">${o.scale||'—'}</span>
          <span class="catalog-price">${formatINR(o.total)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.catalog-card').forEach(card => {
    card.addEventListener('click', () => openCatalogModal(card.dataset.id));
  });
}

function openCatalogModal(id) {
  const o     = orders.find(x => x.id === id);
  if (!o) return;
  const today = new Date().toISOString().slice(0,10);
  const isOverdue   = o.eta && o.eta < today && o.status !== 'Delivered';
  const statusClass = { Ordered:'status-ordered','In Transit':'status-transit',Delivered:'status-delivered',Cancelled:'status-cancelled' }[o.status] || '';
  const paidPct     = o.total > 0 ? Math.round((o.paid||0)/o.total*100) : 0;

  document.getElementById('catModalBox').innerHTML = `
    <div class="vm-header">
      ${o.imageUrl ? `<img class="vm-img" src="${escHtml(o.imageUrl)}" />` : `<div class="vm-img-placeholder"><i class="fa-solid fa-car-side"></i></div>`}
      <div class="vm-header-info">
        <div class="vm-name">${escHtml(o.productName)}</div>
        <div class="vm-meta">${escHtml(o.brand||'—')} · ${o.scale||'—'} · ${o.variant||'—'}</div>
        <span class="status-badge ${statusClass}">${o.status||'—'}</span>
        ${isOverdue ? '<span class="status-badge" style="background:rgba(239,68,68,.12);color:#dc2626;margin-left:.5rem"><i class="fa-solid fa-triangle-exclamation"></i> Overdue</span>' : ''}
      </div>
      <button class="modal-close vm-close" id="catModalClose"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="vm-body">
      <div class="vm-section">
        <div class="vm-section-title"><i class="fa-solid fa-wallet"></i> Payment</div>
        <div class="vm-row"><span>Total</span><strong>${formatINR(o.total)}</strong></div>
        <div class="vm-row"><span>Paid</span><span style="color:#22c55e">${formatINR(o.paid)}</span></div>
        <div class="vm-row"><span>Pending</span><span style="color:${o.pending>0?'#f97316':'#22c55e'}">${formatINR(o.pending)}</span></div>
        <div style="margin-top:.5rem;height:6px;background:rgba(0,0,0,.08);border-radius:3px">
          <div style="width:${paidPct}%;height:100%;background:#22c55e;border-radius:3px"></div>
        </div>
      </div>
      <div class="vm-section">
        <div class="vm-section-title"><i class="fa-solid fa-calendar"></i> Details</div>
        <div class="vm-row"><span>Order Date</span><span>${formatDate(o.orderDate)}</span></div>
        <div class="vm-row"><span>ETA</span><span ${isOverdue?'style="color:#ef4444"':''}>${formatDate(o.eta)}</span></div>
        <div class="vm-row"><span>Seller</span><span>${escHtml(o.vendor||'—')}</span></div>
        <div class="vm-row"><span>Qty</span><span>${o.qty||1}</span></div>
        ${o.orderNumber ? `<div class="vm-row"><span>Tracking</span><span>${escHtml(o.orderNumber)}</span></div>` : ''}
      </div>
      ${o.notes ? `<div class="vm-section"><div class="vm-section-title"><i class="fa-solid fa-note-sticky"></i> Notes</div><p style="font-size:.82rem;color:var(--text-secondary)">${escHtml(o.notes)}</p></div>` : ''}
    </div>`;

  const modal = document.getElementById('catModal');
  modal.classList.remove('hidden');
  document.getElementById('catModalClose').onclick = () => modal.classList.add('hidden');
  modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
}

function initFilters() {
  // Repopulate brand select after data loads
  const brands = [...new Set(orders.map(o => o.brand).filter(Boolean))].sort();
  const sel    = document.getElementById('catBrand');
  if (sel) sel.innerHTML = '<option value="">All Brands</option>' + brands.map(b => `<option>${escHtml(b)}</option>`).join('');

  ['catSearch','catBrand','catScale','catStatus','catSort'].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  renderCatalog);
    document.getElementById(id)?.addEventListener('change', renderCatalog);
  });
  document.getElementById('catClear')?.addEventListener('click', () => {
    ['catSearch','catBrand','catScale','catStatus'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    renderCatalog();
  });
}
