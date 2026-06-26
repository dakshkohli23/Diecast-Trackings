/**
 * PreTrack — Settings Page
 */

import { requireAuth }  from '../auth/auth-guard.js';
import { db }           from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast
} from './dashboard-shell.js';
import {
  getDocs, deleteDoc, collection, query, writeBatch, doc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();
  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);
  syncTopbarAvatar({ email: user.email, role });

  buildPageHTML(role);
  initActions(role);
})();

function buildPageHTML(role) {
  const isAdmin = ['admin','super_admin'].includes(role);
  document.getElementById('section-settings').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">Settings</h2><p class="section-sub">App configuration &amp; data management</p></div>
    </div>

    <div class="settings-grid">
      <!-- Theme -->
      <div class="settings-card glass">
        <div class="settings-card-icon"><i class="fa-solid fa-palette"></i></div>
        <div class="settings-card-title">Appearance</div>
        <div class="settings-card-sub">Coming soon — dark mode &amp; accent colours</div>
        <button class="btn btn-ghost" disabled style="margin-top:1rem;width:100%">Configure Theme</button>
      </div>

      <!-- Export -->
      <div class="settings-card glass">
        <div class="settings-card-icon" style="color:#22c55e"><i class="fa-solid fa-file-export"></i></div>
        <div class="settings-card-title">Export Data</div>
        <div class="settings-card-sub">Download all your orders as a CSV file</div>
        <button class="btn btn-primary" id="exportAllBtn" style="margin-top:1rem;width:100%"><i class="fa-solid fa-download"></i> Export CSV</button>
      </div>

      <!-- PWA -->
      <div class="settings-card glass">
        <div class="settings-card-icon" style="color:#6366f1"><i class="fa-solid fa-mobile-screen"></i></div>
        <div class="settings-card-title">Install App</div>
        <div class="settings-card-sub">Add PreTrack to your home screen for native-like access</div>
        <button class="btn btn-ghost" id="pwaInstallBtn" style="margin-top:1rem;width:100%"><i class="fa-solid fa-download"></i> Install PWA</button>
      </div>

      <!-- SW Reset -->
      <div class="settings-card glass">
        <div class="settings-card-icon" style="color:#f97316"><i class="fa-solid fa-rotate"></i></div>
        <div class="settings-card-title">Clear Cache</div>
        <div class="settings-card-sub">Force-refresh service worker cache if the app feels stale</div>
        <button class="btn btn-ghost" id="clearCacheBtn" style="margin-top:1rem;width:100%"><i class="fa-solid fa-broom"></i> Clear Cache</button>
      </div>

      ${isAdmin ? `
      <!-- Danger zone -->
      <div class="settings-card glass" style="border-color:rgba(239,68,68,0.3)">
        <div class="settings-card-icon" style="color:#ef4444"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="settings-card-title" style="color:#ef4444">Danger Zone</div>
        <div class="settings-card-sub">Permanently delete <strong>all orders</strong>. This cannot be undone.</div>
        <button class="btn btn-danger" id="deleteAllBtn" style="margin-top:1rem;width:100%"><i class="fa-solid fa-trash"></i> Delete All Orders</button>
      </div>` : ''}
    </div>

    <div class="settings-info glass" style="margin-top:1.5rem;padding:1.25rem 1.5rem;border-radius:14px">
      <div style="font-size:.78rem;color:var(--text-muted)">
        <strong>PreTrack v4.1 Pegasus</strong> &nbsp;·&nbsp; Firebase Firestore &nbsp;·&nbsp; GitHub Pages &nbsp;·&nbsp; PWA Enabled
      </div>
    </div>
  `;
}

function initActions(role) {
  // Export CSV
  document.getElementById('exportAllBtn')?.addEventListener('click', async () => {
    try {
      const snap = await getDocs(collection(db, 'orders'));
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!orders.length) { showToast('No orders to export', 'warning'); return; }
      const cols = ['Product Name','Brand','Status','Qty','Buy Price','Shipping','Total','Paid','Pending','ETA','Order Date','Seller','Notes'];
      const rows = orders.map(o => [o.productName,o.brand,o.status,o.qty,o.actualPrice,o.shipping,o.total,o.paid,o.pending,o.eta,o.orderDate,o.vendor,o.notes]
        .map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
      const csv  = [cols.join(','), ...rows].join('\n');
      const link = document.createElement('a');
      link.href  = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      link.download = `pretrack-export-${new Date().toISOString().slice(0,10)}.csv`;
      link.click();
      showToast('CSV exported!', 'success');
    } catch (e) { showToast('Export failed', 'error'); }
  });

  // PWA install
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
  document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      showToast(outcome === 'accepted' ? 'App installed!' : 'Installation dismissed', outcome === 'accepted' ? 'success' : 'info');
      deferredPrompt = null;
    } else {
      showToast('To install: use your browser\'s "Add to Home Screen" option', 'info');
    }
  });

  // Clear cache
  document.getElementById('clearCacheBtn')?.addEventListener('click', async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    showToast('Cache cleared! Reloading...', 'success');
    setTimeout(() => window.location.reload(true), 1000);
  });

  // Delete all (admin only)
  document.getElementById('deleteAllBtn')?.addEventListener('click', async () => {
    const confirmed = prompt('Type DELETE to confirm removing all orders:');
    if (confirmed !== 'DELETE') { showToast('Cancelled', 'info'); return; }
    try {
      const snap  = await getDocs(collection(db, 'orders'));
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(doc(db, 'orders', d.id)));
      await batch.commit();
      showToast('All orders deleted', 'success');
    } catch (e) { showToast('Failed to delete: ' + e.message, 'error'); }
  });
}
