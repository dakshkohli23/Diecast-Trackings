/**
 * PreTrack — Users Page (Admin Only)
 * Manage user accounts, roles, access requests.
 */

import { requireAuth, hasRole } from '../auth/auth-guard.js';
import { db, secondaryAuth, SUPER_ADMIN } from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, setText, escHtml
} from './dashboard-shell.js';
import {
  getDocs, addDoc, updateDoc, deleteDoc,
  collection, doc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

let users = [];
let accessRequests = [];

(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();

  if (!hasRole(role, 'admin')) {
    document.getElementById('section-users').innerHTML =
      '<div class="empty-state"><i class="fa-solid fa-lock"></i> Admin access required.</div>';
    return;
  }

  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);
  syncTopbarAvatar({ email: user.email, role });

  buildPageHTML();
  await Promise.all([fetchUsers(), fetchAccessRequests()]);
  initAddUser();
})();

function buildPageHTML() {
  document.getElementById('section-users').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">User Management</h2><p class="section-sub">Manage accounts &amp; access</p></div>
      <button class="btn btn-primary" id="addUserBtn"><i class="fa-solid fa-user-plus"></i> Add User</button>
    </div>

    <!-- Users table -->
    <div class="widget glass" style="overflow-x:auto">
      <div class="widget-header"><h3><i class="fa-solid fa-users"></i> All Users</h3></div>
      <table class="orders-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody id="usersBody"></tbody>
      </table>
    </div>

    <!-- Access Requests -->
    <div class="widget glass" style="margin-top:1.5rem;overflow-x:auto">
      <div class="widget-header"><h3><i class="fa-solid fa-user-clock"></i> Access Requests <span class="nav-badge" id="reqCountBadge" style="display:none"></span></h3></div>
      <div id="accessRequestsPanel"></div>
    </div>

    <!-- Add User Modal -->
    <div class="modal-overlay hidden" id="addUserModal">
      <div class="modal glass" style="max-width:420px">
        <div class="modal-header" style="padding:1.25rem 1.25rem 0">
          <h3>Add New User</h3>
          <button class="modal-close" id="auClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div style="padding:1.25rem">
          <div class="form-group" style="margin-bottom:.85rem">
            <label class="fg-label">Display Name</label>
            <input type="text" id="auName" class="fg-input" placeholder="Full name" />
          </div>
          <div class="form-group" style="margin-bottom:.85rem">
            <label class="fg-label">Email <span class="fg-required">*</span></label>
            <input type="email" id="auEmail" class="fg-input" placeholder="user@example.com" required />
          </div>
          <div class="form-group" style="margin-bottom:.85rem">
            <label class="fg-label">Password <span class="fg-required">*</span></label>
            <input type="password" id="auPw" class="fg-input" placeholder="Min 6 characters" required />
          </div>
          <div class="form-group" style="margin-bottom:1.25rem">
            <label class="fg-label">Role</label>
            <select id="auRole" class="fg-input fg-select">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="form-error hidden" id="auError" style="margin-bottom:.75rem;padding:.6rem .85rem;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.22);border-radius:8px;font-size:.8rem;color:#dc2626">
            <span id="auErrorMsg"></span>
          </div>
          <div style="display:flex;gap:.6rem">
            <button class="btn btn-ghost" id="auCancel" style="flex:1">Cancel</button>
            <button class="btn btn-primary" id="auSave" style="flex:1"><i class="fa-solid fa-user-plus"></i> Create User</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function fetchUsers() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsers();
  } catch (e) { showToast('Failed to load users', 'error'); }
}

async function fetchAccessRequests() {
  try {
    const snap = await getDocs(query(collection(db, 'access_requests'), orderBy('createdAt', 'desc')));
    accessRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAccessRequests();
  } catch (e) { /* ignore */ }
}

function renderUsers() {
  const tbody = document.getElementById('usersBody');
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No users yet</td></tr>'; return; }

  tbody.innerHTML = users.map(u => {
    const roleColors = { super_admin:'#7c5cfc', admin:'#6366f1', editor:'#14b8a6', viewer:'#22c55e' };
    const roleColor  = roleColors[u.role] || '#9090b8';
    return `<tr>
      <td><strong>${escHtml(u.name||u.displayName||'—')}</strong></td>
      <td>${escHtml(u.email)}</td>
      <td>
        <span style="background:${roleColor}20;color:${roleColor};padding:2px 10px;border-radius:20px;font-size:.7rem;font-weight:700;text-transform:uppercase">
          ${u.role||'viewer'}
        </span>
      </td>
      <td>
        <span style="color:${u.status==='disabled'?'#ef4444':'#22c55e'};font-size:.78rem;font-weight:600">
          ${u.status==='disabled'?'Disabled':'Active'}
        </span>
      </td>
      <td>
        <select class="filter-select role-changer" data-id="${u.id}" style="font-size:.75rem;padding:.3rem .6rem">
          <option value="viewer"   ${u.role==='viewer'  ?'selected':''}>Viewer</option>
          <option value="editor"   ${u.role==='editor'  ?'selected':''}>Editor</option>
          <option value="admin"    ${u.role==='admin'   ?'selected':''}>Admin</option>
        </select>
        <button class="btn btn-danger btn-sm del-user-btn" data-id="${u.id}" title="Delete" style="margin-left:.5rem">
          <i class="fa-solid fa-trash"></i>
        </button>
        <button class="btn btn-ghost btn-sm toggle-status-btn" data-id="${u.id}" data-status="${u.status||'active'}" style="margin-left:.25rem">
          ${u.status==='disabled'?'Enable':'Disable'}
        </button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.role-changer').forEach(sel => {
    sel.addEventListener('change', async () => {
      try {
        await updateDoc(doc(db, 'users', sel.dataset.id), { role: sel.value });
        showToast('Role updated', 'success');
        users.find(u => u.id === sel.dataset.id).role = sel.value;
      } catch (e) { showToast('Failed to update role', 'error'); }
    });
  });

  tbody.querySelectorAll('.del-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this user? This cannot be undone.')) return;
      try {
        await deleteDoc(doc(db, 'users', btn.dataset.id));
        showToast('User deleted', 'success');
        await fetchUsers();
      } catch (e) { showToast('Failed to delete user', 'error'); }
    });
  });

  tbody.querySelectorAll('.toggle-status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.status === 'disabled' ? 'active' : 'disabled';
      try {
        await updateDoc(doc(db, 'users', btn.dataset.id), { status: newStatus });
        showToast(`User ${newStatus === 'disabled' ? 'disabled' : 'enabled'}`, 'success');
        await fetchUsers();
      } catch (e) { showToast('Failed to update status', 'error'); }
    });
  });
}

function renderAccessRequests() {
  const pending = accessRequests.filter(r => r.status === 'pending');
  const badge   = document.getElementById('reqCountBadge');
  if (pending.length) { badge.textContent = pending.length; badge.style.display = 'inline-flex'; }
  else badge.style.display = 'none';

  const el = document.getElementById('accessRequestsPanel');
  if (!accessRequests.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i> No access requests</div>'; return; }

  el.innerHTML = `<div style="overflow-x:auto"><table class="orders-table">
    <thead><tr><th>Name</th><th>Email</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${accessRequests.map(r => `<tr>
      <td>${escHtml(r.name||'—')}</td>
      <td>${escHtml(r.email)}</td>
      <td style="max-width:200px;font-size:.78rem">${escHtml(r.reason||'—')}</td>
      <td>
        <span style="color:${r.status==='approved'?'#22c55e':r.status==='denied'?'#ef4444':'#f97316'};font-weight:700;font-size:.75rem;text-transform:uppercase">
          ${r.status||'pending'}
        </span>
      </td>
      <td>
        ${r.status === 'pending' ? `
          <button class="btn btn-primary btn-sm approve-req" data-id="${r.id}" data-email="${escHtml(r.email)}" data-name="${escHtml(r.name||'')}">Approve</button>
          <button class="btn btn-danger btn-sm deny-req" data-id="${r.id}" style="margin-left:.35rem">Deny</button>
        ` : `<span style="font-size:.75rem;color:var(--text-muted)">—</span>`}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;

  el.querySelectorAll('.approve-req').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'access_requests', btn.dataset.id), { status: 'approved' });
        showToast(`Request approved for ${btn.dataset.email}`, 'success');
        await fetchAccessRequests();
      } catch (e) { showToast('Failed to approve', 'error'); }
    });
  });

  el.querySelectorAll('.deny-req').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'access_requests', btn.dataset.id), { status: 'denied' });
        showToast('Request denied', 'success');
        await fetchAccessRequests();
      } catch (e) { showToast('Failed to deny', 'error'); }
    });
  });
}

function initAddUser() {
  document.getElementById('addUserBtn')?.addEventListener('click', () => {
    document.getElementById('addUserModal').classList.remove('hidden');
  });
  const closeModal = () => {
    document.getElementById('addUserModal').classList.add('hidden');
    document.getElementById('auError').classList.add('hidden');
    ['auName','auEmail','auPw'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('auRole').value = 'viewer';
    document.getElementById('auSave').disabled = false;
    document.getElementById('auSave').innerHTML = '<i class="fa-solid fa-user-plus"></i> Create User';
  };

  document.getElementById('auClose')?.addEventListener('click', closeModal);
  document.getElementById('auCancel')?.addEventListener('click', closeModal);
  document.getElementById('addUserModal')?.addEventListener('click', e => { if (e.target.id === 'addUserModal') closeModal(); });

  document.getElementById('auSave')?.addEventListener('click', async () => {
    const name  = document.getElementById('auName').value.trim();
    const email = document.getElementById('auEmail').value.trim();
    const pw    = document.getElementById('auPw').value;
    const role  = document.getElementById('auRole').value;
    const errEl = document.getElementById('auError');
    const msgEl = document.getElementById('auErrorMsg');
    const btn   = document.getElementById('auSave');

    errEl.classList.add('hidden');
    if (!email || !pw) { msgEl.textContent = 'Email and password are required.'; errEl.classList.remove('hidden'); return; }
    if (pw.length < 6)  { msgEl.textContent = 'Password must be at least 6 characters.'; errEl.classList.remove('hidden'); return; }

    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

    try {
      // Create Firebase Auth user via secondary app (doesn't sign out current user)
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pw);
      // Store in Firestore users collection
      await addDoc(collection(db, 'users'), {
        uid: cred.user.uid,
        name: name || email,
        email,
        role,
        status: 'active',
        createdAt: serverTimestamp(),
      });
      showToast('User created!', 'success');
      closeModal();
      await fetchUsers();
    } catch (e) {
      let msg = 'Failed to create user.';
      if (e.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
      if (e.code === 'auth/weak-password')        msg = 'Password is too weak.';
      if (e.code === 'auth/invalid-email')        msg = 'Invalid email address.';
      msgEl.textContent = msg;
      errEl.classList.remove('hidden');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create User';
    }
  });
}
