/**
 * PreTrack — Auth Guard
 * Import at the top of any dashboard page to enforce authentication.
 * Redirects to login if user is not signed in.
 */

import { auth, db, SUPER_ADMIN } from '../services/firebase.js';
import { onAuthStateChanged }    from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

/**
 * Guard a dashboard page. Resolves with the user object if authenticated,
 * or redirects to login. Also loads the user's role from Firestore.
 * @param {string} loginPath - Path to login page (default: '../../login.html')
 * @returns {Promise<{user, role, isSuperAdmin}>}
 */
export function requireAuth(loginPath = '../../login.html') {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = loginPath;
        return;
      }

      const isSuperAdmin = user.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();
      let role = isSuperAdmin ? 'super_admin' : 'viewer';

      if (!isSuperAdmin) {
        try {
          const snap = await getDocs(query(collection(db, 'users'), where('email', '==', user.email)));
          if (!snap.empty) {
            const data = snap.docs[0].data();
            role = data.role || 'viewer';
            // Check if account disabled
            if (data.status === 'disabled') {
              const { signOut } = await import("https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js");
              await signOut(auth);
              window.location.href = loginPath + '?reason=disabled';
              return;
            }
          }
        } catch (e) {
          console.warn('Auth guard: failed to load user role', e.message);
        }
      }

      resolve({ user, role, isSuperAdmin });
    });
  });
}

/** Check if the current user has at least the given role level. */
export function hasRole(userRole, requiredRole) {
  const LEVELS = { viewer: 0, editor: 1, admin: 2, super_admin: 3 };
  return (LEVELS[userRole] ?? 0) >= (LEVELS[requiredRole] ?? 0);
}
