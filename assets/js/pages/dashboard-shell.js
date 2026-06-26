/**
 * PreTrack — Dashboard Shell
 * Sidebar toggle, topbar dropdown, global search, toast, shared helpers.
 * Import and call initShell(db, orders, currentUser) after auth.
 */

import { auth }  from '../services/firebase.js';
import { signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

/* ── SIDEBAR TOGGLE ── */
export function initSidebar() {
  const sidebar        = document.getElementById('sidebar');
  const mainWrap       = document.getElementById('mainWrap');
  const sidebarToggle  = document.getElementById('sidebarToggle');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const isMobile       = () => window.innerWidth <= 900;

  // Highlight current page in nav
  const currentPage = document.body.dataset.page;
  if (currentPage) {
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === currentPage);
    });
  }

  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('show');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('show');
  }
  function toggleCollapse() {
    sidebar.classList.toggle('collapsed');
    mainWrap?.classList.toggle('sidebar-collapsed');
  }

  sidebarToggle?.addEventListener('click', () => {
    if (isMobile()) { sidebar.classList.contains('open') ? closeSidebar() : openSidebar(); }
    else { toggleCollapse(); }
  });
  sidebarOverlay?.addEventListener('click', closeSidebar);

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = '../../login.html';
  });
  document.getElementById('ddLogout')?.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = '../../login.html';
  });

  // Topbar nav buttons
  document.getElementById('topbarAddBtn')?.addEventListener('click', () => {
    window.location.href = 'add-order.html';
  });
  document.getElementById('ddGoProfile')?.addEventListener('click', () => {
    window.location.href = 'profile.html';
  });
  document.getElementById('ddGoSettings')?.addEventListener('click', () => {
    window.location.href = 'settings.html';
  });
}

/* ── TOPBAR DROPDOWN ── */
export function initTopbarDropdown(user) {
  const btn      = document.getElementById('topbarProfileBtn');
  const dropdown = document.getElementById('topbarDropdown');
  const chevron  = document.getElementById('topbarChevron');

  if (!btn || !dropdown) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', isOpen);
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  });
  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    if (chevron) chevron.style.transform = '';
  });

  // Populate user info
  if (user) {
    const email = user.email || '—';
    setText('topbarDdEmail', email);
    setText('topbarDdName', document.getElementById('profileName')?.textContent || email);
  }
}

/* ── GLOBAL SEARCH ── */
export function initGlobalSearch(getOrders) {
  const overlay = document.getElementById('gsOverlay');
  const input   = document.getElementById('gsInput');
  const body    = document.getElementById('gsBody');
  const trigger = document.getElementById('gsTrigger');
  if (!overlay) return;

  let results = [];
  let focusedIdx = -1;

  function open() { overlay.classList.remove('hidden'); setTimeout(() => input?.focus(), 50); }
  function close() { overlay.classList.add('hidden'); if (input) input.value = ''; renderEmpty(); }

  trigger?.addEventListener('click', open);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault(); open();
    }
    if (e.key === 'Escape') close();
    if (overlay.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { focusedIdx = Math.min(focusedIdx + 1, results.length - 1); updateFocus(); }
    if (e.key === 'ArrowUp')   { focusedIdx = Math.max(focusedIdx - 1, 0); updateFocus(); }
    if (e.key === 'Enter' && results[focusedIdx]) openResult(results[focusedIdx]);
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { renderEmpty(); return; }
    const orders = getOrders();
    results = orders.filter(o =>
      (o.productName||'').toLowerCase().includes(q) ||
      (o.brand||'').toLowerCase().includes(q) ||
      (o.vendor||'').toLowerCase().includes(q)
    ).slice(0, 10);
    focusedIdx = -1;
    renderResults();
  });

  function renderEmpty() {
    results = []; focusedIdx = -1;
    body.innerHTML = `<div class="gs-empty"><i class="fa-solid fa-magnifying-glass"></i><span>Type to search your collection</span></div>`;
  }

  function renderResults() {
    if (!results.length) {
      body.innerHTML = `<div class="gs-empty"><i class="fa-solid fa-inbox"></i><span>No results found</span></div>`;
      return;
    }
    body.innerHTML = results.map((o, i) => `
      <div class="gs-result-item" data-idx="${i}">
        <div class="gs-result-img">
          ${o.imageUrl ? `<img src="${escHtml(o.imageUrl)}" />` : `<i class="fa-solid fa-car-side"></i>`}
        </div>
        <div>
          <div class="gs-result-name">${escHtml(o.productName)}</div>
          <div class="gs-result-meta">${escHtml(o.brand||'—')} · ${escHtml(o.status||'—')} · ₹${o.total||0}</div>
        </div>
      </div>`).join('');
    body.querySelectorAll('.gs-result-item').forEach(el => {
      el.addEventListener('click', () => openResult(results[+el.dataset.idx]));
    });
  }

  function updateFocus() {
    body.querySelectorAll('.gs-result-item').forEach((el, i) => {
      el.classList.toggle('focused', i === focusedIdx);
    });
  }

  function openResult(order) {
    close();
    // Navigate to collection page with the order highlighted
    window.location.href = `collection.html?highlight=${order.id}`;
  }
}

/* ── TOAST ── */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: 'circle-check', error: 'circle-xmark', warning: 'triangle-exclamation', info: 'circle-info' };
  toast.innerHTML = `<i class="fa-solid fa-${icons[type] || 'circle-info'}"></i> ${escHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

/* ── TOPBAR AVATAR SYNC ── */
export function syncTopbarAvatar(profile) {
  const imgEl   = document.getElementById('topbarAvatarImg');
  const iniEl   = document.getElementById('topbarAvatarInitials');
  const ddImg   = document.getElementById('topbarDdAvatarImg');
  const ddIni   = document.getElementById('topbarDdInitials');
  const nameEl  = document.getElementById('profileName');
  const roleEl  = document.getElementById('profileRole');

  const name = profile?.displayName || profile?.name || '';
  const role = profile?.role || '';
  const url  = profile?.avatarUrl || '';

  if (nameEl && name) nameEl.textContent = name;
  if (roleEl && role) {
    const roleMap = { super_admin:'Super Admin', admin:'Admin', editor:'Editor', viewer:'User' };
    roleEl.textContent = roleMap[role] || 'User';
  }

  const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '?';

  if (url) {
    [imgEl, ddImg].forEach(el => { if (el) { el.src = url; el.style.display = 'block'; } });
    [iniEl, ddIni].forEach(el => { if (el) el.style.display = 'none'; });
  } else {
    [iniEl, ddIni].forEach(el => { if (el) { el.textContent = initials; el.style.display = ''; } });
    [imgEl, ddImg].forEach(el => { if (el) el.style.display = 'none'; });
  }
  setText('topbarDdName', name);
}

/* ── ADMIN VISIBILITY ── */
export function applyRoleVisibility(role) {
  const isAdmin = ['admin', 'super_admin'].includes(role);
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

/* ── HELPERS ── */
export function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
export function escHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
export function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}
