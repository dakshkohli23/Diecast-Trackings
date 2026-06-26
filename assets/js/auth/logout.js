/**
 * PreTrack — Logout
 * Handles sign-out and redirect to login page.
 */

import { auth } from '../services/firebase.js';
import { signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

/**
 * Signs the current user out and redirects to login.
 * @param {string} loginPath
 */
export async function logout(loginPath = '../../login.html') {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('Logout error:', e.message);
  }
  window.location.href = loginPath;
}

/**
 * Attach logout to a button element.
 * @param {string|HTMLElement} selectorOrEl
 * @param {string} loginPath
 */
export function attachLogout(selectorOrEl, loginPath = '../../login.html') {
  const el = typeof selectorOrEl === 'string'
    ? document.querySelector(selectorOrEl)
    : selectorOrEl;
  if (el) el.addEventListener('click', () => logout(loginPath));
}
