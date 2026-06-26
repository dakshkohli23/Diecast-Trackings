/**
 * PreTrack — Access Requests Page (Admin Only)
 * Standalone page for managing access requests with approve/deny actions.
 */

import { requireAuth, hasRole } from '../auth/auth-guard.js';
import { db } from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, escHtml
} from './dashboard-shell.js';
import {
  getDocs, updateDoc, deleteDoc,
  collection, doc, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

let requests = [];

(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();

  if (!hasRole(role, 'admin')) {
    document.getElementById('section-access-requests').innerHTML =
      '<div class="empty-state"><i class="fa-solid fa-lock"></i> Admin access required.</div>';
    return;
  }

  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);
  syncTopbarAvatar({ email: user.email, role });

  buildPageHTML();
  await fetchRequests();
  initFilters();
})();

function buildPageHTML() {
  document.getElementById('section-access-requests').innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Access Requests</h2>
        <p class="section-sub">Review and manage who gets access to PreTrack</p>
      </div>
      <button class="btn btn-ghost" id="refreshBtn"><i class="fa-solid fa-rotate"></i> Refresh</button>
    </div>

    <!-- Summary -->
    <div class="stats-grid" id="reqSummary" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.25rem"></div>

    <!-- Filter tabs -->
    <div class="upcoming-tabs" id="reqTabs" style="margin-bottom:1rem">
      <button class="upcoming-tab active" data-status="pending">⏳ Pending</button>
      <button class="upcoming-tab" data-status="approved">✅ Approved</button>
      <button class="upcoming-tab" data-status="denied">❌ Denied</button>
      <button class="upcoming-tab" data-status="all">📋 All</button>
    </div>

    <div class="widget glass" style="overflow-x:auto">
      <table class="orders-table" id="reqTable">
        <thead><tr><th>Name</th><th>Email</th><th>Reason</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody id="reqBody"></tbody>
      </table>
    </div>
  `;
}

async function fetchRequests() {
  try {
    const snap = await getDocs(query(collection(db, 'access_requests'), orderBy('createdAt', 'desc')));
    requests   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSummary();
    renderTable('pending');
  } catch (e) {
    showToast('Failed to load requests', 'error');
  }
}

function renderSummary() {
  const total    = requests.length;
  const pending  = requests.filter(r => r.status === 'pending').length;
  const approved = requests.filter(r => r.status === 'approved').length;
  const denied   = requests.filter(r => r.status === 'denied').length;

  document.getElementById('reqSummary').innerHTML = `
    <div class="stat-card glass"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
    <div class="stat-card glass"><div class="stat-label">Pending</div><div class="stat-value" style="color:#f97316">${pending}</div></div>
    <div class="stat-card glass"><div class="stat-label">Approved</div><div class="stat-value" style="color:#22c55e">${approved}</div></div>
    <div class="stat-card glass"><div class="stat-label">Denied</div><div class="stat-value" style="color:#ef4444">${denied}</div></div>`;

  // Badge in sidebar
  const badge = document.getElementById('accessRequestsBadge');
  if (badge) {
    badge.textContent    = pending;
    badge.style.display  = pending > 0 ? 'inline-flex' : 'none';
  }
}

function renderTable(statusFilter) {
  const list = statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter);
  const tbody = document.getElementById('reqBody');

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row"><i class="fa-solid fa-inbox"></i> No ${statusFilter === 'all' ? '' : statusFilter} requests</td></tr>`;
    return;
  }

  const statusColor = { pending: '#f97316', approved: '#22c55e', denied: '#ef4444' };

  tbody.innerHTML = list.map(r => {
    const ts = r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000).toLocaleDateString('en-IN') : '—';
    return `<tr>
      <td><strong>${escHtml(r.name || '—')}</strong></td>
      <td>${escHtml(r.email)}</td>
      <td style="max-width:220px;font-size:.75rem;color:var(--text-secondary)">${escHtml(r.reason || '—')}</td>
      <td style="white-space:nowrap;font-size:.75rem">${ts}</td>
      <td>
        <span style="font-size:.7rem;font-weight:800;text-transform:uppercase;color:${statusColor[r.status]||'#9090b8'}">
          ${r.status || 'pending'}
        </span>
      </td>
      <td>
        ${r.status === 'pending' ? `
          <button class="btn btn-primary btn-sm approve-btn" data-id="${r.id}" data-email="${escHtml(r.email)}">
            <i class="fa-solid fa-check"></i> Approve
          </button>
          <button class="btn btn-danger btn-sm deny-btn" data-id="${r.id}" style="margin-left:.35rem">
            <i class="fa-solid fa-xmark"></i> Deny
          </button>` : `
          <button class="btn btn-ghost btn-sm delete-btn" data-id="${r.id}" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>`}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'access_requests', btn.dataset.id), { status: 'approved' });
        showToast(`Approved: ${btn.dataset.email}`, 'success');
        await fetchRequests();
      } catch (e) { showToast('Failed to approve', 'error'); }
    });
  });

  tbody.querySelectorAll('.deny-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'access_requests', btn.dataset.id), { status: 'denied' });
        showToast('Request denied', 'success');
        await fetchRequests();
      } catch (e) { showToast('Failed to deny', 'error'); }
    });
  });

  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this request permanently?')) return;
      try {
        await deleteDoc(doc(db, 'access_requests', btn.dataset.id));
        showToast('Deleted', 'success');
        await fetchRequests();
      } catch (e) { showToast('Failed to delete', 'error'); }
    });
  });
}

function initFilters() {
  let activeStatus = 'pending';

  document.querySelectorAll('.upcoming-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.upcoming-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatus = btn.dataset.status;
      renderTable(activeStatus);
    });
  });

  document.getElementById('refreshBtn')?.addEventListener('click', fetchRequests);
}
