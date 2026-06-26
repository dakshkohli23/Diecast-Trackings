/**
 * PreTrack — Profile Page
 */

import { requireAuth }  from '../auth/auth-guard.js';
import { db, uploadAvatarToSupabase } from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, setText, escHtml, formatINR
} from './dashboard-shell.js';
import {
  getDocs, updateDoc, addDoc, collection, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

let userDoc  = null;
let userDocId = null;
let orders   = [];
let authUser  = null;

(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();
  authUser = user;
  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);

  buildPageHTML();

  // Load user doc + orders
  try {
    const [usersSnap, ordersSnap] = await Promise.all([
      getDocs(query(collection(db, 'users'), where('email', '==', user.email))),
      getDocs(collection(db, 'orders')),
    ]);
    if (!usersSnap.empty) {
      userDoc   = usersSnap.docs[0].data();
      userDocId = usersSnap.docs[0].id;
    }
    orders = ordersSnap.docs.map(d => d.data());
  } catch (e) { showToast('Failed to load profile', 'error'); }

  renderProfile(user, role);
  syncTopbarAvatar({ ...userDoc, role });
  renderStats();
  initAvatarUpload();
  initProfileForm();
  initPasswordForm();
})();

function buildPageHTML() {
  document.getElementById('section-profile').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">My Profile</h2><p class="section-sub">Manage your account &amp; preferences</p></div>
    </div>
    <div class="profile-layout">
      <!-- Left: Avatar + info -->
      <div class="profile-card glass">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar-lg" id="profileAvatarLg">
            <img id="profileAvatarImg" src="" alt="" style="display:none;width:100%;height:100%;object-fit:cover;border-radius:50%" />
            <span id="profileAvatarIni" style="font-size:2rem;color:#fff"></span>
          </div>
          <label class="profile-avatar-upload-btn" for="avatarInput" title="Change photo">
            <i class="fa-solid fa-camera"></i>
          </label>
          <input type="file" id="avatarInput" accept="image/*" hidden />
        </div>
        <div class="profile-card-name" id="profileCardName">—</div>
        <div class="profile-card-role" id="profileCardRole">—</div>
        <div class="profile-card-email" id="profileCardEmail">—</div>
        <div class="profile-stats-mini" id="profileStatsMini"></div>
      </div>

      <!-- Right: Forms -->
      <div style="flex:1;display:flex;flex-direction:column;gap:1.25rem">
        <!-- Edit profile -->
        <div class="widget glass">
          <div class="widget-header"><h3><i class="fa-solid fa-user-pen"></i> Edit Profile</h3></div>
          <div style="padding:0 1.25rem 1.25rem">
            <div class="form-group" style="margin-bottom:.85rem">
              <label class="fg-label">Display Name</label>
              <input type="text" id="pfName" class="fg-input" />
            </div>
            <button class="btn btn-primary" id="pfSaveBtn"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
          </div>
        </div>

        <!-- Change password -->
        <div class="widget glass">
          <div class="widget-header"><h3><i class="fa-solid fa-lock"></i> Change Password</h3></div>
          <div style="padding:0 1.25rem 1.25rem">
            <div class="form-group" style="margin-bottom:.85rem">
              <label class="fg-label">Current Password</label>
              <input type="password" id="pfCurrentPw" class="fg-input" placeholder="Your current password" />
            </div>
            <div class="form-group" style="margin-bottom:.85rem">
              <label class="fg-label">New Password</label>
              <input type="password" id="pfNewPw" class="fg-input" placeholder="Min 6 characters" />
            </div>
            <div class="form-group" style="margin-bottom:.85rem">
              <label class="fg-label">Confirm New Password</label>
              <input type="password" id="pfConfirmPw" class="fg-input" placeholder="Repeat new password" />
            </div>
            <div id="pfPwError" class="hidden" style="padding:.6rem .85rem;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.22);border-radius:8px;font-size:.8rem;color:#dc2626;margin-bottom:.75rem"></div>
            <button class="btn btn-primary" id="pfChangePwBtn"><i class="fa-solid fa-key"></i> Update Password</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderProfile(user, role) {
  const name    = userDoc?.name || userDoc?.displayName || user.email.split('@')[0];
  const roleMap = { super_admin:'Super Admin', admin:'Admin', editor:'Editor', viewer:'User' };

  setText('profileCardName', name);
  setText('profileCardRole', roleMap[role] || 'User');
  setText('profileCardEmail', user.email);

  const ini = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const iniEl = document.getElementById('profileAvatarIni');
  const imgEl = document.getElementById('profileAvatarImg');
  const avatarWrap = document.getElementById('profileAvatarLg');
  avatarWrap.style.background = 'var(--primary)';

  if (userDoc?.avatarUrl) {
    imgEl.src = userDoc.avatarUrl; imgEl.style.display = 'block';
    iniEl.style.display = 'none';
  } else {
    iniEl.textContent = ini;
  }

  const pfName = document.getElementById('pfName');
  if (pfName) pfName.value = name;
}

function renderStats() {
  const total     = orders.length;
  const invest    = orders.reduce((s, o) => s + (o.total||0), 0);
  const pending   = orders.reduce((s, o) => s + (o.pending||0), 0);
  const delivered = orders.filter(o => o.status==='Delivered').length;

  document.getElementById('profileStatsMini').innerHTML = `
    <div class="profile-stat-item"><span class="ps-val">${total}</span><span class="ps-label">Orders</span></div>
    <div class="profile-stat-item"><span class="ps-val">${delivered}</span><span class="ps-label">Delivered</span></div>
    <div class="profile-stat-item"><span class="ps-val">${formatINR(invest)}</span><span class="ps-label">Invested</span></div>
    <div class="profile-stat-item"><span class="ps-val" style="color:#f97316">${formatINR(pending)}</span><span class="ps-label">Pending</span></div>`;
}

function initAvatarUpload() {
  document.getElementById('avatarInput')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('Uploading avatar...', 'info');
    try {
      const url = await uploadAvatarToSupabase(file);
      // Update in Firestore
      if (userDocId) {
        await updateDoc(collection(db, 'users') && doc(db, 'users', userDocId) || doc(db, 'users', userDocId), { avatarUrl: url });
      }
      document.getElementById('profileAvatarImg').src = url;
      document.getElementById('profileAvatarImg').style.display = 'block';
      document.getElementById('profileAvatarIni').style.display = 'none';
      syncTopbarAvatar({ avatarUrl: url });
      showToast('Avatar updated!', 'success');
    } catch (err) {
      showToast('Avatar upload failed: ' + err.message, 'error');
    }
  });
}

function initProfileForm() {
  document.getElementById('pfSaveBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('pfName')?.value.trim();
    if (!name) { showToast('Name cannot be empty', 'warning'); return; }
    try {
      if (userDocId) {
        await updateDoc(doc(db, 'users', userDocId), { name, displayName: name });
      } else {
        const newDoc = await addDoc(collection(db, 'users'), { name, displayName: name, email: authUser.email, role: 'viewer', createdAt: serverTimestamp() });
        userDocId = newDoc.id;
      }
      setText('profileCardName', name);
      syncTopbarAvatar({ name });
      showToast('Profile updated!', 'success');
    } catch (e) { showToast('Failed to save: ' + e.message, 'error'); }
  });
}

function initPasswordForm() {
  document.getElementById('pfChangePwBtn')?.addEventListener('click', async () => {
    const current  = document.getElementById('pfCurrentPw')?.value;
    const newPw    = document.getElementById('pfNewPw')?.value;
    const confirm  = document.getElementById('pfConfirmPw')?.value;
    const errEl    = document.getElementById('pfPwError');
    errEl.classList.add('hidden');

    if (!current || !newPw || !confirm) { errEl.textContent = 'All fields required.'; errEl.classList.remove('hidden'); return; }
    if (newPw !== confirm) { errEl.textContent = 'Passwords do not match.'; errEl.classList.remove('hidden'); return; }
    if (newPw.length < 6)  { errEl.textContent = 'Password must be at least 6 characters.'; errEl.classList.remove('hidden'); return; }

    try {
      const cred = EmailAuthProvider.credential(authUser.email, current);
      await reauthenticateWithCredential(authUser, cred);
      await updatePassword(authUser, newPw);
      document.getElementById('pfCurrentPw').value = '';
      document.getElementById('pfNewPw').value     = '';
      document.getElementById('pfConfirmPw').value  = '';
      showToast('Password updated!', 'success');
    } catch (e) {
      errEl.textContent = e.code === 'auth/wrong-password' ? 'Current password is incorrect.' : 'Failed: ' + e.message;
      errEl.classList.remove('hidden');
    }
  });
}
