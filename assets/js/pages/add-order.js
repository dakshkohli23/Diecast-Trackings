/**
 * PreTrack — Add Order Page (dedicated page version)
 * Full form — redirects to collection after save.
 */

import { requireAuth }  from '../auth/auth-guard.js';
import { db, uploadImageToSupabase } from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, escHtml, formatINR
} from './dashboard-shell.js';
import { addDoc, getDocs, collection, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

const BASE_BRANDS = ['Hot Wheels','Mini GT','Pop Race','Tarmac Works','Tomica','Matchbox','Kaido House','Inno64'];
let customBrands  = [];
let imageFile     = null;

(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();
  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);
  syncTopbarAvatar({ email: user.email, role });

  // Load existing brands from orders
  try {
    const snap = await getDocs(collection(db, 'orders'));
    const known = new Set(BASE_BRANDS);
    customBrands = [...new Set(snap.docs.map(d => d.data().brand).filter(b => b && !known.has(b)))];
  } catch (_) {}

  buildPageHTML();
  initForm();
})();

function buildPageHTML() {
  document.getElementById('section-add-order').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">Add New Order</h2><p class="section-sub">Fill in the details to track a new preorder</p></div>
      <a href="collection.html" class="btn btn-ghost"><i class="fa-solid fa-arrow-left"></i> Back to Collection</a>
    </div>

    <form id="addOrderForm" class="add-order-form">
      <!-- Required -->
      <div class="add-order-card glass">
        <div class="add-order-card-title"><i class="fa-solid fa-star"></i> Required Details</div>
        <div class="form-grid-new">
          <div class="form-group fg-full">
            <label class="fg-label">Product Name <span class="fg-required">*</span></label>
            <input type="text" id="fProductName" class="fg-input" placeholder="e.g. Nissan Skyline GT-R R34 — Paul Walker" required />
          </div>
          <div class="form-group fg-half">
            <label class="fg-label">Brand <span class="fg-required">*</span></label>
            <select id="fBrandSelect" class="fg-input fg-select" required>
              <option value="">Select Brand</option>
              ${[...BASE_BRANDS,...customBrands].map(b => `<option>${escHtml(b)}</option>`).join('')}
              <option value="__new__">＋ Add New Brand</option>
            </select>
            <input type="hidden" id="fBrand" />
            <div class="new-brand-row hidden" id="newBrandRow">
              <input type="text" id="fNewBrand" class="fg-input" placeholder="New brand name" />
              <button type="button" class="btn-add-brand" id="confirmNewBrand"><i class="fa-solid fa-check"></i> Add</button>
              <button type="button" class="btn-cancel-brand" id="cancelNewBrand"><i class="fa-solid fa-xmark"></i></button>
            </div>
          </div>
          <div class="form-group fg-quarter">
            <label class="fg-label">Quantity</label>
            <input type="number" id="fQty" class="fg-input" min="1" value="1" />
          </div>
          <div class="form-group fg-quarter">
            <label class="fg-label">Scale</label>
            <select id="fScale" class="fg-input fg-select">
              <option>1:64</option><option>1:43</option><option>1:18</option><option>1:24</option><option>1:12</option><option>Other</option>
            </select>
          </div>
          <div class="form-group fg-quarter">
            <label class="fg-label">Variant</label>
            <select id="fVariant" class="fg-input fg-select">
              <option>Box</option><option>Blister</option><option>Other</option>
            </select>
          </div>
          <div class="form-group fg-quarter">
            <label class="fg-label">Order Date</label>
            <input type="date" id="fOrderDate" class="fg-input" />
          </div>
          <div class="form-group fg-quarter">
            <label class="fg-label">ETA Date</label>
            <input type="date" id="fEta" class="fg-input" />
          </div>
          <div class="form-group fg-full">
            <label class="fg-label">Status</label>
            <div class="status-pill-group">
              <label class="status-pill active" data-status="Ordered"><input type="radio" name="fStatus" value="Ordered" checked hidden /><i class="fa-solid fa-cart-shopping"></i> Ordered</label>
              <label class="status-pill" data-status="In Transit"><input type="radio" name="fStatus" value="In Transit" hidden /><i class="fa-solid fa-truck-moving"></i> In Transit</label>
              <label class="status-pill" data-status="Delivered"><input type="radio" name="fStatus" value="Delivered" hidden /><i class="fa-solid fa-box-open"></i> Delivered</label>
              <label class="status-pill" data-status="Cancelled"><input type="radio" name="fStatus" value="Cancelled" hidden /><i class="fa-solid fa-ban"></i> Cancelled</label>
            </div>
            <input type="hidden" id="fStatus" value="Ordered" />
          </div>
        </div>
      </div>

      <!-- Payment -->
      <div class="add-order-card glass">
        <div class="add-order-card-title"><i class="fa-solid fa-wallet"></i> Payment Details</div>
        <div class="form-grid-new">
          <div class="form-group fg-quarter"><label class="fg-label">Pre-order Amt (₹)</label><input type="number" id="fPreorderPrice" class="fg-input" min="0" value="0" /></div>
          <div class="form-group fg-quarter"><label class="fg-label">Buy Price/piece (₹)</label><input type="number" id="fActualPrice" class="fg-input" min="0" value="0" /></div>
          <div class="form-group fg-quarter"><label class="fg-label">Shipping (₹)</label><input type="number" id="fShipping" class="fg-input" min="0" value="0" /></div>
          <div class="form-group fg-quarter"><label class="fg-label">Total Paid (₹)</label><input type="number" id="fPaid" class="fg-input" min="0" value="0" /></div>
          <div class="form-group fg-half"><label class="fg-label">Total (auto-calculated)</label><div class="fg-calc-field" id="fTotalDisplay">₹0</div><input type="hidden" id="fTotal" /></div>
          <div class="form-group fg-half"><label class="fg-label">Pending (auto-calculated)</label><div class="fg-calc-field fg-calc-pending" id="fPendingDisplay">₹0</div><input type="hidden" id="fPending" /></div>
        </div>
      </div>

      <!-- Optional -->
      <div class="add-order-card glass">
        <div class="add-order-card-title"><i class="fa-solid fa-ellipsis"></i> Optional Details</div>
        <div class="form-grid-new">
          <div class="form-group fg-half"><label class="fg-label">Seller Name</label><input type="text" id="fVendor" class="fg-input" placeholder="e.g. Karz &amp; Dolls" /></div>
          <div class="form-group fg-half"><label class="fg-label">Order / Tracking #</label><input type="text" id="fOrderNumber" class="fg-input" placeholder="TRK-123456" /></div>
          <div class="form-group fg-full"><label class="fg-label">Notes</label><textarea id="fNotes" class="fg-input fg-textarea" rows="2" placeholder="Any notes about this order..."></textarea></div>
        </div>
      </div>

      <!-- Photo -->
      <div class="add-order-card glass">
        <div class="add-order-card-title"><i class="fa-solid fa-image"></i> Model Photo</div>
        <div class="image-upload-area" id="imageUploadArea" style="height:180px">
          <div class="image-preview" id="imagePreview">
            <i class="fa-solid fa-camera"></i><p>Click to upload photo</p><span>JPG, PNG, WEBP · max 5MB</span>
          </div>
          <input type="file" id="fImage" accept="image/*" hidden />
        </div>
      </div>

      <!-- Actions -->
      <div class="add-order-actions">
        <a href="collection.html" class="btn btn-ghost btn-lg"><i class="fa-solid fa-xmark"></i> Cancel</a>
        <button type="submit" class="btn btn-primary btn-lg" id="saveBtn"><i class="fa-solid fa-floppy-disk"></i> Save Order</button>
      </div>
    </form>
  `;
}

function initForm() {
  // Default date
  const today = new Date().toISOString().slice(0,10);
  const orderDateEl = document.getElementById('fOrderDate');
  if (orderDateEl) orderDateEl.value = today;

  // Payment calc
  ['fActualPrice','fQty','fShipping','fPaid'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', calcPayment)
  );

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
      document.getElementById('newBrandRow').classList.remove('hidden');
      document.getElementById('fNewBrand').focus();
    } else {
      document.getElementById('fBrand').value = e.target.value;
    }
  });
  document.getElementById('confirmNewBrand')?.addEventListener('click', () => {
    const val = document.getElementById('fNewBrand').value.trim();
    if (!val) return;
    document.getElementById('fBrand').value = val;
    // Add option to select
    const sel = document.getElementById('fBrandSelect');
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = val; opt.selected = true;
    sel.insertBefore(opt, sel.lastElementChild);
    document.getElementById('newBrandRow').classList.add('hidden');
  });
  document.getElementById('cancelNewBrand')?.addEventListener('click', () => {
    document.getElementById('newBrandRow').classList.add('hidden');
    document.getElementById('fBrandSelect').value = '';
  });

  // Image upload
  document.getElementById('imageUploadArea')?.addEventListener('click', () => document.getElementById('fImage').click());
  document.getElementById('fImage')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    imageFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('imagePreview').innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" />`;
    };
    reader.readAsDataURL(file);
  });

  // Form submit
  document.getElementById('addOrderForm')?.addEventListener('submit', submitForm);
}

function calcPayment() {
  const qty  = parseFloat(document.getElementById('fQty')?.value)         || 1;
  const buy  = parseFloat(document.getElementById('fActualPrice')?.value)  || 0;
  const ship = parseFloat(document.getElementById('fShipping')?.value)     || 0;
  const paid = parseFloat(document.getElementById('fPaid')?.value)         || 0;
  const total   = (buy * qty) + ship;
  const pending = Math.max(0, total - paid);
  document.getElementById('fTotal').value    = total;
  document.getElementById('fPending').value  = pending;
  document.getElementById('fTotalDisplay').textContent   = formatINR(total);
  document.getElementById('fPendingDisplay').textContent = formatINR(pending);
}

async function submitForm(e) {
  e.preventDefault();
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    let imageUrl = '';
    if (imageFile) imageUrl = await uploadImageToSupabase(imageFile);

    const brandVal = document.getElementById('fBrand').value ||
                     document.getElementById('fBrandSelect').value;

    const data = {
      productName:   document.getElementById('fProductName').value.trim(),
      brand:         brandVal,
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
      scale:         document.getElementById('fScale').value || '1:64',
      variant:       document.getElementById('fVariant').value || 'Box',
      vendor:        document.getElementById('fVendor').value.trim(),
      notes:         document.getElementById('fNotes').value.trim(),
      imageUrl,
      createdAt: serverTimestamp(),
    };

    await addDoc(collection(db, 'orders'), data);
    showToast('Order added!', 'success');
    setTimeout(() => { window.location.href = 'collection.html'; }, 800);
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Order';
  }
}
