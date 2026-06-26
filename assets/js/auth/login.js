/**
 * PreTrack — Login Page Logic
 */

import { auth, db, SUPER_ADMIN } from '../services/firebase.js';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getDocs, collection, query, where, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// Persist session across reloads
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Auto-redirect if already signed in
onAuthStateChanged(auth, user => {
  if (user) window.location.href = 'pages/dashboard/index.html';
});

// Password visibility toggle
document.getElementById('togglePw')?.addEventListener('click', () => {
  const inp  = document.getElementById('password');
  const icon = document.querySelector('#togglePw i');
  const isText = inp.type === 'text';
  inp.type = isText ? 'password' : 'text';
  icon.className = `fa-solid fa-eye${isText ? '' : '-slash'}`;
});

// ── LOGIN FORM ──
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('username').value.trim();
  const pw    = document.getElementById('password').value;
  const btn   = document.getElementById('loginBtn');
  const err   = document.getElementById('loginError');
  const msg   = document.getElementById('errorMsg');

  if (!email || !pw) return;
  err.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Signing in…</span>';

  const resetBtn = () => {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> <span>Sign In to Dashboard</span>';
  };
  const showErr = (m) => {
    msg.textContent = m;
    err.classList.remove('hidden');
    resetBtn();
    setTimeout(() => err.classList.add('hidden'), 6000);
  };

  try {
    await signInWithEmailAndPassword(auth, email, pw);

    // Super admin — always allow
    if (email.toLowerCase() === SUPER_ADMIN.toLowerCase() || SUPER_ADMIN.includes('__')) {
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>Redirecting…</span>';
      window.location.href = 'pages/dashboard/index.html';
      return;
    }

    // Check user status
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
      if (!snap.empty && snap.docs[0].data().status === 'disabled') {
        await signOut(auth);
        showErr('Your account has been disabled. Contact the admin.');
        return;
      }
    } catch (dbErr) { console.warn('DB check:', dbErr.message); }

    btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>Redirecting…</span>';
    window.location.href = 'pages/dashboard/index.html';

  } catch (e) {
    let m = 'Invalid email or password. Please try again.';
    if (e.code === 'auth/too-many-requests')      m = 'Too many attempts. Please wait a moment.';
    if (e.code === 'auth/network-request-failed') m = 'Network error. Check your connection.';
    if (e.code === 'auth/user-disabled')          m = 'This account has been disabled.';
    if (e.code === 'auth/invalid-credential')     m = 'Wrong email or password.';
    if (e.code === 'auth/invalid-email')          m = 'Invalid email format.';
    if (e.code === 'auth/user-not-found')         m = 'No account found with this email.';
    if (e.code === 'auth/wrong-password')         m = 'Wrong password.';
    showErr(m);
  }
});

// ── REQUEST ACCESS MODAL ──
const modal = document.getElementById('reqModal');

function openModal() {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('aName')?.focus(), 50);
}
function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('modalFormState').classList.remove('hidden');
  document.getElementById('modalSuccessState').classList.add('hidden');
  document.getElementById('reqError').classList.add('hidden');
  document.getElementById('accessForm').reset();
  const btn = document.getElementById('reqBtn');
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Request';
}

document.getElementById('openModal')?.addEventListener('click', openModal);
document.getElementById('closeModal')?.addEventListener('click', closeModal);
document.getElementById('closeModal2')?.addEventListener('click', closeModal);
document.getElementById('closeSuccess')?.addEventListener('click', closeModal);
modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
});

document.getElementById('accessForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name   = document.getElementById('aName').value.trim();
  const email  = document.getElementById('aEmail').value.trim();
  const reason = document.getElementById('aReason').value.trim();
  const btn    = document.getElementById('reqBtn');
  const err    = document.getElementById('reqError');
  const msg    = document.getElementById('reqErrorMsg');

  err.classList.add('hidden');
  if (!name || !email) { msg.textContent = 'Please fill in your name and email.'; err.classList.remove('hidden'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

  try {
    await addDoc(collection(db, 'access_requests'), {
      name, email,
      reason: reason || '(no reason provided)',
      status: 'pending',
      createdAt: serverTimestamp()
    });
    document.getElementById('modalFormState').classList.add('hidden');
    document.getElementById('modalSuccessState').classList.remove('hidden');
  } catch (e) {
    const isRulesError = e.code === 'permission-denied' || e.message?.includes('permission');
    msg.textContent = isRulesError
      ? 'Permission denied. Ask admin to update Firestore rules.'
      : 'Failed to send. Please check your connection.';
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Request';
  }
});