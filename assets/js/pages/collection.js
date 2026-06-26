/**
 * PreTrack — Collection Page
 * Full order grid with grid/list toggle, filters, add/edit/delete modal.
 */

import { requireAuth }       from '../auth/auth-guard.js';
import { db, uploadImageToSupabase, deleteImageFromSupabase } from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, initGlobalSearch, syncTopbarAvatar,
  applyRoleVisibility, showToast, setText, escHtml, formatDate, formatINR
} from './dashboard-shell.js';
import {
  getDocs, addDoc, updateDoc, deleteDoc,
  collection, doc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

/* ── State ── */
let orders       = [];
let filteredOrders = [];
let viewMode     = 'grid'; // 'grid' | 'list'
let currentEdit  = null;
let currentImageFile = null;
let customBrands = [];

const BASE_BRANDS = ['Hot Wheels','Mini GT','Pop Race','Tarmac Works','Tomica','Matchbox','Kaido House','Inno64'];
function getAllBrands() { return [...BASE_BRANDS, ...customBrands]; }

/* ── Boot ── */
(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();
  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);
  syncTopbarAvatar({ email: user.email, role });

  buildPageHTML();
  await fetchOrders();
  initFilters();
  initViewToggle();
  initModal();
  initGlobalSearch(() => orders);

  // Check for highlight param (from global search)
  const params = new URLSearchParams(window.location.search);
  const highlightId = params.get('highlight');
  if (highlightId) setTimeout(() => highlightOrder(highlightId), 500);
})();

/* ── Build Page HTML ── */
function buildPageHTML() {
  document.getElementById('section-collection').innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Collection</h2>
        <p class="section-sub">All orders, preorders &amp; inventory</p>
      </div>
      <button class="btn btn-primary" id="addOrderBtn"><i class="fa-solid fa-plus"></i> Add Model</button>
    </div>

    <div class="filters-bar glass">
      <div class="filter-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="invSearch" placeholder="Search name, brand..." />
      </div>
      <select id="invFilterBrand" class="filter-select"><option value="">All Brands</option></select>
      <select id="invFilterStatus" class="filter-select">
        <option value="">All Statuses</option>
        <option>Ordered</option><option>In Transit</option><option>Delivered</option><option>Cancelled</option>
      </select>
      <select id="invFilterScale" class="filter-select">
        <option value="">All Scales</option>
        <option>1:64</option><option>1:43</option><option>1:18</option><option>1:24</option><option>1:12</option><option>Other</option>
      </select>
      <select id="invSort" class="filter-select">
        <option value="newest">Newest</option>
        <option value="name-az">Name A–Z</option>
        <option value="name-za">Name Z–A</option>
        <option value="price-hi">Price High</option>
        <option value="price-lo">Price Low</option>
      </select>
      <button class="btn btn-ghost" id="invClearFilters"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="col-toolbar">
      <span class="col-count" id="colCount">0 models</span>
      <div class="col-view-toggle">
        <button class="col-view-btn active" id="viewBtnGrid" title="Grid view"><i class="fa-solid fa-grip"></i></button>
        <button class="col-view-btn" id="viewBtnList" title="List view"><i class="fa-solid fa-list"></i></button>
      </div>
    </div>

    <div id="colGridView" class="col-grid"></div>

    <div id="colListView" class="table-wrap glass" style="display:none;overflow-x:auto">
      <table class="orders-table">
        <thead><tr><th>Product</th><th>Brand</th><th>Status</th><th>Qty</th><th>Total</th><th>Pending</th><th>ETA</th><th>Actions</th></tr></thead>
        <tbody id="ordersTableBody"></tbody>
      </table>
    </div>

    <!-- ADD/EDIT MODAL -->
    <div class="modal-overlay hidden" id="orderModal">
      <div class="modal modal-redesign glass" id="orderModalBox">
        <div class="modal-header">
          <div class="modal-header-left">
            <div class="modal-header-icon"><i class="fa-solid fa-car-side"></i></div>
            <div>
              <h3 id="modalTitle">Add New Order</h3>
              <p class="modal-header-sub">Fill in the required fields below</p>
            </div>
          </div>
          <button class="modal-close" id="modalClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <form id="orderForm">
            <input type="hidden" id="editOrderId" />
            <div class="form-section">
              <div class="form-section-label"><i class="fa-solid fa-star"></i> Required</div>
              <div class="form-grid-new">
                <div class="form-group fg-full">
                  <label class="fg-label"><i class="fa-solid fa-tag"></i> Product Name <span class="fg-required">*</span></label>
                  <input type="text" id="fProductName" class="fg-input" placeholder="e.g. Nissan Skyline GT-R R34" required />
                </div>
                <div class="form-group fg-half">
                  <label class="fg-label"><i class="fa-solid fa-building"></i> Brand <span class="fg-required">*</span></label>
                  <select id="fBrandSelect" class="fg-input fg-select" required>
                    <option value="">Select Brand</option>
                    <option value="__new__">＋ Add New Brand</option>
                  </select>
                  <input type="hidden" id="fBrand" />
                  <div class="new-brand-row hidden" id="newBrandRow">
                    <input type="text" id="fNewBrand" class="fg-input" placeholder="Enter new brand name..." />
                    <button type="button" class="btn-add-brand" id="confirmNewBrand"><i class="fa-solid fa-check"></i> Add</button>
                    <button type="button" class="btn-cancel-brand" id="cancelNewBrand"><i class="fa-solid fa-xmark"></i></button>
                  </div>
                </div>
                <div class="form-group fg-quarter">
                  <label class="fg-label"><i class="fa-solid fa-boxes-stacked"></i> Qty <span class="fg-required">*</span></label>
                  <input type="number" id="fQty" class="fg-input" min="1" value="1" required />
                </div>
                <div class="form-group fg-quarter">
                  <label class="fg-label"><i class="fa-solid fa-calendar-plus"></i> Order Date</label>
                  <input type="date" id="fOrderDate" class="fg-input" />
                </div>
                <div class="form-group fg-quarter">
                  <label class="fg-label"><i class="fa-solid fa-calendar-check"></i> ETA Date</label>
                  <input type="date" id="fEta" class="fg-input" />
                </div>
                <div class="form-group fg-full">
                  <label class="fg-label"><i class="fa-solid fa-circle-dot"></i> Status</label>
                  <div class="status-pill-group" id="statusPillGroup">
                    <label class="status-pill active" data-status="Ordered"><input type="radio" name="fStatusRadio" value="Ordered" checked hidden /><i class="fa-solid fa-cart-shopping"></i> Ordered</label>
                    <label class="status-pill" data-status="In Transit"><input type="radio" name="fStatusRadio" value="In Transit" hidden /><i class="fa-solid fa-truck-moving"></i> In Transit</label>
                    <label class="status-pill" data-status="Delivered"><input type="radio" name="fStatusRadio" value="Delivered" hidden /><i class="fa-solid fa-box-open"></i> Delivered</label>
                    <label class="status-pill" data-status="Cancelled"><input type="radio" name="fStatusRadio" value="Cancelled" hidden /><i class="fa-solid fa-ban"></i> Cancelled</label>
                  </div>
                  <input type="hidden" id="fStatus" value="Ordered" />
                </div>
              </div>
            </div>

            <div class="form-section">
              <div class="form-section-label"><i class="fa-solid fa-wallet"></i> Payment</div>
              <div class="form-grid-new">
                <div class="form-group fg-quarter"><label class="fg-label"><i class="fa-solid fa-tag"></i> Pre Order Amt (₹)</label><input type="number" id="fPreorderPrice" class="fg-input" min="0" value="0" /></div>
                <div class="form-group fg-quarter"><label class="fg-label"><i class="fa-solid fa-indian-rupee-sign"></i> Buy Price/piece (₹)</label><input type="number" id="fActualPrice" class="fg-input" min="0" value="0" /></div>
                <div class="form-group fg-quarter"><label class="fg-label"><i class="fa-solid fa-truck"></i> Shipping (₹)</label><input type="number" id="fShipping" class="fg-input" min="0" value="0" /></div>
                <div class="form-group fg-quarter"><label class="fg-label"><i class="fa-solid fa-hand-holding-dollar"></i> Total Paid (₹)</label><input type="number" id="fPaid" class="fg-input" min="0" value="0" /></div>
                <div class="form-group fg-half"><label class="fg-label"><i class="fa-solid fa-calculator"></i> Total (auto)</label><div class="fg-calc-field" id="fTotalDisplay">₹0</div><input type="hidden" id="fTotal" /></div>
                <div class="form-group fg-half"><label class="fg-label"><i class="fa-solid fa-hourglass-half"></i> Pending (auto)</label><div class="fg-calc-field fg-calc-pending" id="fPendingDisplay">₹0</div><input type="hidden" id="fPending" /></div>
              </div>
            </div>

            <details class="form-section form-section-optional">
              <summary class="form-section-label form-section-toggle">
                <i class="fa-solid fa-ellipsis"></i> Optional Details
                <i class="fa-solid fa-chevron-down toggle-chevron"></i>
              </summary>
              <div class="form-grid-new" style="margin-top:1rem">
                <div class="form-group fg-half"><label class="fg-label"><i class="fa-solid fa-barcode"></i> Order / Tracking #</label><input type="text" id="fOrderNumber" class="fg-input" placeholder="e.g. TRK-123456" /></div>
                <div class="form-group fg-quarter"><label class="fg-label"><i class="fa-solid fa-ruler"></i> Scale</label><select id="fScale" class="fg-input fg-select"><option>1:64</option><option>1:43</option><option>1:18</option><option>1:24</option><option>1:12</option><option>Other</option></select></div>
                <div class="form-group fg-quarter"><label class="fg-label"><i class="fa-solid fa-cube"></i> Variant</label><select id="fVariant" class="fg-input fg-select"><option>Box</option><option>Blister</option><option>Other</option></select></div>
                <div class="form-group fg-half"><label class="fg-label"><i class="fa-solid fa-store"></i> Seller Name</label><input type="text" id="fVendor" class="fg-input" placeholder="e.g. Karz & Dolls" /></div>
                <div class="form-group fg-full"><label class="fg-label"><i class="fa-solid fa-note-sticky"></i> Notes</label><textarea id="fNotes" class="fg-input fg-textarea" rows="2"></textarea></div>
              </div>
            </details>

            <div class="form-section">
              <div class="form-section-label"><i class="fa-solid fa-image"></i> Photo</div>
              <div class="image-upload-area" id="imageUploadArea">
                <div class="image-preview" id="imagePreview">
                  <i class="fa-solid fa-camera"></i><p>Click to upload photo</p><span>JPG, PNG, WEBP · max 5MB</span>
                </div>
                <input type="file" id="fImage" accept="image/*" hidden />
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-ghost" id="modalCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
              <button type="submit" class="btn btn-primary" id="modalSave"><i class="fa-solid fa-floppy-disk"></i> Save Order</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- VIEW MODAL -->
    <div class="modal-overlay hidden" id="viewModal">
      <div class="modal-view-new glass" id="viewModalBox"></div>
    </div>
  `;
}

/* ── Fetch ── */
async function fetchOrders() {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Collect custom brands
    const known = new Set(BASE_BRANDS);
    customBrands = [...new Set(orders.map(o => o.brand).filter(b => b && !known.has(b)))];
    populateBrandFilter();
    applyFilters();
  } catch (e) {
    showToast('Failed to load orders', 'error');
  }
}

/* ── Filters ── */
function initFilters() {
  ['invSearch','invFilterBrand','invFilterStatus','invFilterScale','invSort'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', applyFilters);
    document.getElementById(id)?.addEventListener('change', applyFilters);
  });
  document.getElementById('invClearFilters')?.addEventListener('click', () => {
    ['invSearch','invFilterBrand','invFilterStatus','invFilterScale'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    applyFilters();
  });
}

function populateBrandFilter() {
  const sel = document.getElementById('invFilterBrand');
  if (!sel) return;
  const brands = [...new Set(orders.map(o => o.brand).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All Brands</option>' +
    brands.map(b => `<option>${escHtml(b)}</option>`).join('');
}

function applyFilters() {
  const search = (document.getElementById('invSearch')?.value || '').toLowerCase();
  const brand  = document.getElementById('invFilterBrand')?.value  || '';
  const status = document.getElementById('invFilterStatus')?.value || '';
  const scale  = document.getElementById('invFilterScale')?.value  || '';
  const sort   = document.getElementById('invSort')?.value         || 'newest';

  filteredOrders = orders.filter(o =>
    (!search || (o.productName||'').toLowerCase().includes(search) || (o.brand||'').toLowerCase().includes(search)) &&
    (!brand  || o.brand  === brand) &&
    (!status || o.status === status) &&
    (!scale  || o.scale  === scale)
  );

  filteredOrders.sort((a, b) => {
    if (sort === 'name-az') return (a.productName||'').localeCompare(b.productName||'');
    if (sort === 'name-za') return (b.productName||'').localeCompare(a.productName||'');
    if (sort === 'price-hi') return (b.total||0) - (a.total||0);
    if (sort === 'price-lo') return (a.total||0) - (b.total||0);
    return 0; // newest = Firestore order
  });

  setText('colCount', `${filteredOrders.length} model${filteredOrders.length !== 1 ? 's' : ''}`);
  renderGrid();
  renderTable();
}

/* ── View Toggle ── */
function initViewToggle() {
  document.getElementById('viewBtnGrid')?.addEventListener('click', () => setView('grid'));
  document.getElementById('viewBtnList')?.addEventListener('click', () => setView('list'));
}
function setView(mode) {
  viewMode = mode;
  document.getElementById('colGridView').style.display = mode === 'grid' ? '' : 'none';
  document.getElementById('colListView').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('viewBtnGrid')?.classList.toggle('active', mode === 'grid');
  document.getElementById('viewBtnList')?.classList.toggle('active', mode === 'list');
}

/* ── Grid Render ── */
function renderGrid() {
  const grid = document.getElementById('colGridView');
  if (!grid) return;
  if (!filteredOrders.length) {
    grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i> No items found</div>';
    return;
  }
  grid.innerHTML = filteredOrders.map(o => {
    const today   = new Date().toISOString().slice(0,10);
    const isOverdue = o.eta && o.eta < today && o.status !== 'Delivered' && o.status !== 'Cancelled';
    const statusClass = { Ordered:'status-ordered', 'In Transit':'status-transit', Delivered:'status-delivered', Cancelled:'status-cancelled' }[o.status] || '';
    return `
    <div class="col-card glass" data-id="${o.id}" ${isOverdue ? 'style="border-color:rgba(239,68,68,0.3)"' : ''}>
      <div class="col-card-img">
        ${o.imageUrl ? `<img src="${escHtml(o.imageUrl)}" alt="${escHtml(o.productName)}" loading="lazy" />` : `<i class="fa-solid fa-car-side"></i>`}
        ${isOverdue ? '<div class="col-card-overdue-badge"><i class="fa-solid fa-triangle-exclamation"></i> Overdue</div>' : ''}
      </div>
      <div class="col-card-body">
        <div class="col-card-name">${escHtml(o.productName)}</div>
        <div class="col-card-meta">${escHtml(o.brand||'—')} · ${o.scale||'—'}</div>
        <div class="col-card-row">
          <span class="status-badge ${statusClass}">${o.status||'—'}</span>
          <span class="col-card-price">${formatINR(o.total)}</span>
        </div>
        ${o.pending > 0 ? `<div class="col-card-pending">Due: ${formatINR(o.pending)}</div>` : ''}
      </div>
      <div class="col-card-actions">
        <button class="btn btn-ghost btn-sm view-btn" data-id="${o.id}" title="View"><i class="fa-solid fa-eye"></i></button>
        <button class="btn btn-ghost btn-sm edit-btn" data-id="${o.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-danger btn-sm del-btn" data-id="${o.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openViewModal(btn.dataset.id); }));
  grid.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); }));
  grid.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); deleteOrder(btn.dataset.id); }));
  grid.querySelectorAll('.col-card').forEach(card => card.addEventListener('click', () => openViewModal(card.dataset.id)));
}

/* ── Table Render ── */
function renderTable() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;
  if (!filteredOrders.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row"><i class="fa-solid fa-inbox"></i> No items found</td></tr>';
    return;
  }
  tbody.innerHTML = filteredOrders.map(o => {
    const statusClass = { Ordered:'status-ordered','In Transit':'status-transit',Delivered:'status-delivered',Cancelled:'status-cancelled' }[o.status]||'';
    return `<tr>
      <td><strong>${escHtml(o.productName)}</strong></td>
      <td>${escHtml(o.brand||'—')}</td>
      <td><span class="status-badge ${statusClass}">${o.status||'—'}</span></td>
      <td>${o.qty||1}</td>
      <td>${formatINR(o.total)}</td>
      <td style="color:${o.pending>0?'#f97316':'#22c55e'}">${formatINR(o.pending)}</td>
      <td>${formatDate(o.eta)}</td>
      <td>
        <button class="btn btn-ghost btn-sm edit-btn" data-id="${o.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-danger btn-sm del-btn" data-id="${o.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
  tbody.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', () => deleteOrder(btn.dataset.id)));
}

/* ── Modal ── */
function initModal() {
  document.getElementById('addOrderBtn')?.addEventListener('click', () => openAddModal());
  document.getElementById('modalClose')?.addEventListener('click', closeModal);
  document.getElementById('modalCancel')?.addEventListener('click', closeModal);
  document.getElementById('orderModal')?.addEventListener('click', e => { if (e.target.id === 'orderModal') closeModal(); });

  // Payment auto-calc
  ['fActualPrice','fQty','fShipping','fPaid'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcPayment);
  });

  // Status pills
  document.querySelectorAll('.status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.status-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      document.getElementById('fStatus').value = pill.dataset.status;
    });
  });

  // Brand new
  document.getElementById('fBrandSelect')?.addEventListener('change', e => {
    if (e.target.value === '__new__') {
      document.getElementById('newBrandRow')?.classList.remove('hidden');
      document.getElementById('fNewBrand')?.focus();
    } else {
      document.getElementById('fBrand').value = e.target.value;
    }
  });
  document.getElementById('confirmNewBrand')?.addEventListener('click', () => {
    const val = document.getElementById('fNewBrand').value.trim();
    if (!val) return;
    if (!customBrands.includes(val)) customBrands.push(val);
    document.getElementById('fBrand').value = val;
    rebuildBrandDropdown(val);
    document.getElementById('newBrandRow')?.classList.add('hidden');
  });
  document.getElementById('cancelNewBrand')?.addEventListener('click', () => {
    document.getElementById('newBrandRow')?.classList.add('hidden');
    document.getElementById('fBrandSelect').value = '';
  });

  // Image upload
  document.getElementById('imageUploadArea')?.addEventListener('click', () => document.getElementById('fImage')?.click());
  document.getElementById('fImage')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    currentImageFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('imagePreview').innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" />`;
    };
    reader.readAsDataURL(file);
  });

  // Form submit
  document.getElementById('orderForm')?.addEventListener('submit', saveOrder);

  // Close view modal
  document.getElementById('viewModal')?.addEventListener('click', e => { if (e.target.id === 'viewModal') document.getElementById('viewModal').classList.add('hidden'); });

  rebuildBrandDropdown('');
}

function rebuildBrandDropdown(selected) {
  const sel = document.getElementById('fBrandSelect');
  if (!sel) return;
  sel.innerHTML = `<option value="">Select Brand</option>` +
    getAllBrands().map(b => `<option value="${escHtml(b)}" ${b === selected ? 'selected' : ''}>${escHtml(b)}</option>`).join('') +
    `<option value="__new__">＋ Add New Brand</option>`;
}

function openAddModal() {
  currentEdit = null; currentImageFile = null;
  document.getElementById('modalTitle').textContent = 'Add New Order';
  document.getElementById('orderForm').reset();
  document.getElementById('fStatus').value = 'Ordered';
  document.getElementById('fTotalDisplay').textContent = '₹0';
  document.getElementById('fPendingDisplay').textContent = '₹0';
  document.getElementById('imagePreview').innerHTML = `<i class="fa-solid fa-camera"></i><p>Click to upload photo</p><span>JPG, PNG, WEBP · max 5MB</span>`;
  document.querySelectorAll('.status-pill').forEach(p => p.classList.toggle('active', p.dataset.status === 'Ordered'));
  rebuildBrandDropdown('');
  document.getElementById('fOrderDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('orderModal').classList.remove('hidden');
}

function openEditModal(id) {
  const order = orders.find(o => o.id === id);
  if (!order) return;
  currentEdit = order; currentImageFile = null;
  document.getElementById('modalTitle').textContent = 'Edit Order';
  document.getElementById('editOrderId').value = id;

  setValue('fProductName', order.productName);
  setValue('fQty', order.qty || 1);
  setValue('fOrderDate', order.orderDate || '');
  setValue('fEta', order.eta || '');
  setValue('fPreorderPrice', order.preorderPrice || 0);
  setValue('fActualPrice', order.actualPrice || 0);
  setValue('fShipping', order.shipping || 0);
  setValue('fPaid', order.paid || 0);
  setValue('fOrderNumber', order.orderNumber || '');
  setValue('fVendor', order.vendor || '');
  setValue('fNotes', order.notes || '');

  document.getElementById('fStatus').value = order.status || 'Ordered';
  document.querySelectorAll('.status-pill').forEach(p => p.classList.toggle('active', p.dataset.status === order.status));
  rebuildBrandDropdown(order.brand || '');
  document.getElementById('fBrand').value = order.brand || '';

  // Scale & variant
  const scaleEl = document.getElementById('fScale');
  if (scaleEl && order.scale) scaleEl.value = order.scale;
  const varEl = document.getElementById('fVariant');
  if (varEl && order.variant) varEl.value = order.variant;

  calcPayment();

  if (order.imageUrl) {
    document.getElementById('imagePreview').innerHTML = `<img src="${escHtml(order.imageUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" />`;
  } else {
    document.getElementById('imagePreview').innerHTML = `<i class="fa-solid fa-camera"></i><p>Click to upload photo</p><span>JPG, PNG, WEBP · max 5MB</span>`;
  }

  document.getElementById('orderModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('orderModal').classList.add('hidden');
  currentEdit = null; currentImageFile = null;
}

function calcPayment() {
  const qty  = parseFloat(document.getElementById('fQty')?.value)          || 1;
  const buy  = parseFloat(document.getElementById('fActualPrice')?.value)   || 0;
  const ship = parseFloat(document.getElementById('fShipping')?.value)      || 0;
  const paid = parseFloat(document.getElementById('fPaid')?.value)          || 0;
  const total   = (buy * qty) + ship;
  const pending = Math.max(0, total - paid);
  document.getElementById('fTotal').value    = total;
  document.getElementById('fPending').value  = pending;
  document.getElementById('fTotalDisplay').textContent   = formatINR(total);
  document.getElementById('fPendingDisplay').textContent = formatINR(pending);
}

async function saveOrder(e) {
  e.preventDefault();
  const btn = document.getElementById('modalSave');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    let imageUrl = currentEdit?.imageUrl || '';
    if (currentImageFile) {
      imageUrl = await uploadImageToSupabase(currentImageFile);
    }

    const data = {
      productName:   document.getElementById('fProductName').value.trim(),
      brand:         document.getElementById('fBrand').value || document.getElementById('fBrandSelect').value,
      qty:           parseInt(document.getElementById('fQty').value) || 1,
      orderDate:     document.getElementById('fOrderDate').value,
      eta:           document.getElementById('fEta').value,
      status:        document.getElementById('fStatus').value || 'Ordered',
      preorderPrice: parseFloat(document.getElementById('fPreorderPrice').value) || 0,
      actualPrice:   parseFloat(document.getElementById('fActualPrice').value)   || 0,
      shipping:      parseFloat(document.getElementById('fShipping').value)       || 0,
      paid:          parseFloat(document.getElementById('fPaid').value)           || 0,
      total:         parseFloat(document.getElementById('fTotal').value)          || 0,
      pending:       parseFloat(document.getElementById('fPending').value)        || 0,
      orderNumber:   document.getElementById('fOrderNumber').value.trim(),
      scale:         document.getElementById('fScale')?.value || '1:64',
      variant:       document.getElementById('fVariant')?.value || 'Box',
      vendor:        document.getElementById('fVendor').value.trim(),
      notes:         document.getElementById('fNotes').value.trim(),
      imageUrl,
    };

    if (currentEdit) {
      await updateDoc(doc(db, 'orders', currentEdit.id), { ...data, updatedAt: serverTimestamp() });
      showToast('Order updated!', 'success');
    } else {
      await addDoc(collection(db, 'orders'), { ...data, createdAt: serverTimestamp() });
      showToast('Order added!', 'success');
    }
    closeModal();
    await fetchOrders();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Order';
  }
}

async function deleteOrder(id) {
  if (!confirm('Delete this order? This cannot be undone.')) return;
  try {
    const order = orders.find(o => o.id === id);
    if (order?.imageUrl) await deleteImageFromSupabase(order.imageUrl);
    await deleteDoc(doc(db, 'orders', id));
    showToast('Order deleted', 'success');
    await fetchOrders();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

function openViewModal(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const today = new Date().toISOString().slice(0,10);
  const isOverdue = o.eta && o.eta < today && o.status !== 'Delivered';
  const statusClass = { Ordered:'status-ordered','In Transit':'status-transit',Delivered:'status-delivered',Cancelled:'status-cancelled' }[o.status]||'';
  const paidPct = o.total > 0 ? Math.round((o.paid||0) / o.total * 100) : 0;

  document.getElementById('viewModalBox').innerHTML = `
    <div class="vm-header">
      ${o.imageUrl ? `<img class="vm-img" src="${escHtml(o.imageUrl)}" />` : `<div class="vm-img-placeholder"><i class="fa-solid fa-car-side"></i></div>`}
      <div class="vm-header-info">
        <div class="vm-name">${escHtml(o.productName)}</div>
        <div class="vm-meta">${escHtml(o.brand||'—')} · ${o.scale||'—'} · ${o.variant||'—'}</div>
        <span class="status-badge ${statusClass}">${o.status||'—'}</span>
        ${isOverdue ? '<span class="status-badge" style="background:rgba(239,68,68,0.15);color:#dc2626;margin-left:.5rem"><i class="fa-solid fa-triangle-exclamation"></i> Overdue</span>' : ''}
      </div>
      <button class="modal-close vm-close" onclick="document.getElementById('viewModal').classList.add('hidden')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="vm-body">
      <div class="vm-section">
        <div class="vm-section-title"><i class="fa-solid fa-wallet"></i> Payment</div>
        <div class="vm-row"><span>Total</span><strong>${formatINR(o.total)}</strong></div>
        <div class="vm-row"><span>Paid</span><span style="color:#22c55e">${formatINR(o.paid)}</span></div>
        <div class="vm-row"><span>Pending</span><span style="color:${o.pending>0?'#f97316':'#22c55e'}">${formatINR(o.pending)}</span></div>
        <div style="margin-top:.5rem;height:6px;background:rgba(0,0,0,0.08);border-radius:3px">
          <div style="width:${paidPct}%;height:100%;background:#22c55e;border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="font-size:.68rem;color:var(--text-muted);margin-top:.25rem">${paidPct}% paid</div>
      </div>
      <div class="vm-section">
        <div class="vm-section-title"><i class="fa-solid fa-calendar"></i> Timeline</div>
        <div class="vm-row"><span>Order Date</span><span>${formatDate(o.orderDate)}</span></div>
        <div class="vm-row"><span>ETA</span><span ${isOverdue?'style="color:#ef4444"':''}>${formatDate(o.eta)}</span></div>
        <div class="vm-row"><span>Qty</span><span>${o.qty||1}</span></div>
      </div>
      ${o.vendor ? `<div class="vm-section"><div class="vm-section-title"><i class="fa-solid fa-store"></i> Seller</div><div class="vm-row"><span>Seller</span><span>${escHtml(o.vendor)}</span></div></div>` : ''}
      ${o.notes  ? `<div class="vm-section"><div class="vm-section-title"><i class="fa-solid fa-note-sticky"></i> Notes</div><p style="font-size:.82rem;color:var(--text-secondary)">${escHtml(o.notes)}</p></div>` : ''}
      <div style="display:flex;gap:.6rem;margin-top:1rem">
        <button class="btn btn-primary" style="flex:1" onclick="document.getElementById('viewModal').classList.add('hidden');openEditModal('${o.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-danger" onclick="deleteOrder('${o.id}');document.getElementById('viewModal').classList.add('hidden')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  document.getElementById('viewModal').classList.remove('hidden');
  // expose openEditModal globally for the inline onclick
  window.openEditModal = openEditModal;
  window.deleteOrder   = deleteOrder;
}

function highlightOrder(id) {
  const card = document.querySelector(`.col-card[data-id="${id}"]`);
  if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.style.boxShadow = '0 0 0 3px var(--primary)'; setTimeout(() => card.style.boxShadow = '', 2000); }
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
