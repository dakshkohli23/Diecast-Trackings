/**
 * PreTrack — Dashboard Home Page
 * Handles: stats, widgets, greeting, recent orders, activity feed, brand leaderboard
 */

import { requireAuth }     from '../auth/auth-guard.js';
import { db }              from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, initGlobalSearch,
  syncTopbarAvatar, applyRoleVisibility, showToast, setText, escHtml, formatDate, formatINR
} from './dashboard-shell.js';
import {
  getDocs, collection, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// ── Inject sidebar & topbar HTML ──
// ── App State ──
let DB = { orders: [], activity: [] };

// ── Boot ──
(async () => {
  const { user, role, isSuperAdmin } = await requireAuth();

  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);

  // Load profile from Firestore
  let profile = { email: user.email, role };
  try {
    const snap = await getDocs(collection(db, 'users'));
    const match = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .find(u => u.email === user.email);
    if (match) profile = { ...profile, ...match };
  } catch (e) { /* ignore */ }

  if (isSuperAdmin) profile.name = 'Super Admin';
  syncTopbarAvatar(profile);
  setText('profileName', profile.name || profile.displayName || user.email);
  setText('profileRole', isSuperAdmin ? 'Super Admin' : ({ admin:'Admin', editor:'Editor', viewer:'User' }[role] || 'User'));

  await fetchData();
  initGlobalSearch(() => DB.orders);
  initGreeting(profile);

  // CSV export
  document.getElementById('qaExport')?.addEventListener('click', exportCSV);
})();

// ── Fetch Data ──
async function fetchData() {
  try {
    const [ordersSnap, activitySnap] = await Promise.all([
      getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(20))),
    ]);
    DB.orders   = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    DB.activity = activitySnap.docs.map(d => ({ id: d.id, ...d.data() }));
    setText('systemStatus', '🟢 Live');
  } catch (e) {
    console.error('fetchData:', e);
    setText('systemStatus', '🔴 Offline');
    showToast('Failed to load data', 'error');
    return;
  }
  renderStats();
  renderInsights();
  renderRecentOrders();
  renderEtaWidget();
  renderActivityFeed();
  renderBrandLeaderboard();
  renderAlerts();
}

// ── Greeting ──
function initGreeting(profile) {
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const name = profile?.name || profile?.displayName || 'there';
  setText('greetingText', `${greeting}, ${name}! 👋`);
  setText('greetingDate', new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
}

// ── Stats ──
function renderStats() {
  const o = DB.orders;
  const total      = o.length;
  const qty        = o.reduce((s, x) => s + (x.qty || 1), 0);
  const investment = o.reduce((s, x) => s + (x.total || 0), 0);
  const pending    = o.reduce((s, x) => s + (x.pending || 0), 0);
  const delivered  = o.filter(x => x.status === 'Delivered').length;
  const transit    = o.filter(x => x.status === 'In Transit').length;
  const pendingPO  = o.filter(x => ['Ordered','In Transit'].includes(x.status)).length;
  const today      = new Date().toISOString().slice(0,10);
  const overdue    = o.filter(x => x.eta && x.eta < today && x.status !== 'Delivered' && x.status !== 'Cancelled').length;

  // Top brand by qty
  const brandMap = {};
  o.forEach(x => { brandMap[x.brand||'?'] = (brandMap[x.brand||'?'] || 0) + (x.qty || 1); });
  const topBrand = Object.entries(brandMap).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
  const avgBuy   = total ? Math.round(o.reduce((s,x) => s + (x.actualPrice||0), 0) / total) : 0;

  setText('statTotal', total);
  setText('statQty', qty);
  setText('statInvestment', formatINR(investment));
  setText('statPending', formatINR(pending));
  setText('statPendingPO', pendingPO);
  setText('statDelivered', delivered);
  setText('statTransit', transit);
  setText('statOverdue', overdue);
  setText('statTopBrand', topBrand);
  setText('statAvgBuy', formatINR(avgBuy));

  // Hero stats
  setText('dhStatModels', total);
  setText('dhStatDue', formatINR(pending));
  const weekAhead = new Date(); weekAhead.setDate(weekAhead.getDate() + 7);
  const weekKey   = weekAhead.toISOString().slice(0,10);
  const thisWeek  = o.filter(x => x.eta && x.eta >= today && x.eta <= weekKey && x.status !== 'Delivered').length;
  setText('dhStatEta', thisWeek);

  // Progress bars
  if (total > 0) {
    setBar('statPendingBar',   (pending / investment * 100));
    setBar('statPendingPOBar', (pendingPO / total * 100));
    setBar('statDeliveredBar', (delivered / total * 100));
    setBar('statTransitBar',   (transit / total * 100));
    setBar('statOverdueBar',   (overdue / total * 100));
  }
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
}

// ── Insights Strip ──
function renderInsights() {
  const o = DB.orders;
  if (!o.length) { setText('insightSub', 'Add some orders to see insights'); return; }

  const today   = new Date().toISOString().slice(0,10);
  const overdue = o.filter(x => x.eta && x.eta < today && x.status !== 'Delivered' && x.status !== 'Cancelled').length;
  const pending = o.reduce((s, x) => s + (x.pending || 0), 0);
  const paidPct = o.reduce((s, x) => s + (x.total || 0), 0);
  const healthPct = paidPct > 0 ? Math.round((1 - pending/paidPct) * 100) : 100;

  const brandMap = {};
  o.forEach(x => { brandMap[x.brand||'?'] = (brandMap[x.brand||'?']||0)+1; });
  const brands = Object.keys(brandMap).length;
  const topBrand = Object.entries(brandMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';

  setText('insightSub', `${o.length} models tracked`);

  const insights = [
    { icon: 'fa-heart-pulse',          color: '#7c5cfc', label: 'Payment Health', val: healthPct+'%' },
    { icon: 'fa-triangle-exclamation', color: '#ef4444', label: 'Overdue',        val: overdue },
    { icon: 'fa-building',             color: '#6366f1', label: 'Brands',         val: brands },
    { icon: 'fa-crown',                color: '#f97316', label: 'Top Brand',      val: topBrand },
    { icon: 'fa-circle-check',         color: '#22c55e', label: 'Delivered',      val: o.filter(x=>x.status==='Delivered').length },
    { icon: 'fa-truck-moving',         color: '#14b8a6', label: 'In Transit',     val: o.filter(x=>x.status==='In Transit').length },
    { icon: 'fa-indian-rupee-sign',    color: '#ec4899', label: 'Total Due',      val: formatINR(pending) },
  ];

  const scroll = document.getElementById('insightScroll');
  if (scroll) {
    scroll.innerHTML = insights.map(i => `
      <div class="insight-chip glass">
        <div class="insight-chip-icon" style="color:${i.color}"><i class="fa-solid ${i.icon}"></i></div>
        <div class="insight-chip-label">${i.label}</div>
        <div class="insight-chip-val" style="color:${i.color}">${i.val}</div>
      </div>`).join('');
  }
}

// ── Recent Orders ──
function renderRecentOrders() {
  const list = document.getElementById('recentOrdersList');
  if (!list) return;
  const recent = DB.orders.slice(0, 5);
  if (!recent.length) { list.innerHTML = '<div class="empty-state">No orders yet</div>'; return; }
  list.innerHTML = recent.map(o => `
    <div class="recent-order-row">
      <div class="ro-thumb">
        ${o.imageUrl ? `<img src="${escHtml(o.imageUrl)}" />` : `<i class="fa-solid fa-car-side"></i>`}
      </div>
      <div class="ro-info">
        <div class="ro-name">${escHtml(o.productName)}</div>
        <div class="ro-meta">${escHtml(o.brand||'—')} · ${escHtml(o.status||'—')}</div>
      </div>
      <div class="ro-price">${formatINR(o.total)}</div>
    </div>`).join('');
}

// ── ETA Widget ──
function renderEtaWidget() {
  const list  = document.getElementById('etaList');
  if (!list) return;
  const today = new Date().toISOString().slice(0,10);
  const week  = new Date(); week.setDate(week.getDate() + 14);
  const wKey  = week.toISOString().slice(0,10);
  const items = DB.orders
    .filter(o => o.eta && o.eta >= today && o.eta <= wKey && o.status !== 'Delivered' && o.status !== 'Cancelled')
    .sort((a,b) => a.eta.localeCompare(b.eta))
    .slice(0, 5);
  if (!items.length) { list.innerHTML = '<div class="empty-state">No upcoming in 2 weeks</div>'; return; }
  list.innerHTML = items.map(o => `
    <div class="eta-row">
      <div class="eta-row-left">
        <div class="eta-name">${escHtml(o.productName)}</div>
        <div class="eta-meta">${escHtml(o.brand||'—')}</div>
      </div>
      <div class="eta-date">${formatDate(o.eta)}</div>
    </div>`).join('');
}

// ── Activity Feed ──
function renderActivityFeed() {
  const list = document.getElementById('activityList');
  if (!list) return;
  if (!DB.activity.length) { list.innerHTML = '<div class="empty-state">No recent activity</div>'; return; }
  list.innerHTML = DB.activity.slice(0, 8).map(a => {
    const icons = { add:'circle-plus', edit:'pen', delete:'trash', deliver:'box-open' };
    const colors = { add:'#22c55e', edit:'#7c5cfc', delete:'#ef4444', deliver:'#14b8a6' };
    const type = a.type || 'add';
    return `<div class="activity-item">
      <div class="activity-icon" style="color:${colors[type]||'#7c5cfc'}">
        <i class="fa-solid fa-${icons[type]||'circle-info'}"></i>
      </div>
      <div class="activity-text">${escHtml(a.message||'—')}</div>
      <div class="activity-time">${formatDate(a.timestamp?.seconds ? new Date(a.timestamp.seconds*1000).toISOString() : '')}</div>
    </div>`;
  }).join('');
}

// ── Brand Leaderboard ──
function renderBrandLeaderboard() {
  const list = document.getElementById('leaderboardList');
  if (!list) return;
  const brandMap = {};
  DB.orders.forEach(o => {
    const b = o.brand || '?';
    if (!brandMap[b]) brandMap[b] = { count: 0, spend: 0 };
    brandMap[b].count++;
    brandMap[b].spend += o.total || 0;
  });
  const sorted = Object.entries(brandMap).sort((a,b) => b[1].count - a[1].count).slice(0, 6);
  if (!sorted.length) { list.innerHTML = '<div class="empty-state">No data yet</div>'; return; }
  const maxCount = sorted[0][1].count;
  list.innerHTML = sorted.map(([brand, stats], i) => `
    <div class="leaderboard-row">
      <div class="lb-rank">#${i+1}</div>
      <div class="lb-info">
        <div class="lb-name">${escHtml(brand)}</div>
        <div class="lb-bar-wrap"><div class="lb-bar" style="width:${(stats.count/maxCount*100).toFixed(0)}%"></div></div>
      </div>
      <div class="lb-stats">
        <span class="lb-count">${stats.count}</span>
        <span class="lb-spend">${formatINR(stats.spend)}</span>
      </div>
    </div>`).join('');
}

// ── Alerts ──
function renderAlerts() {
  const panel = document.getElementById('alertsPanel');
  if (!panel) return;
  const today   = new Date().toISOString().slice(0,10);
  const overdue = DB.orders.filter(o => o.eta && o.eta < today && o.status !== 'Delivered' && o.status !== 'Cancelled');
  const pendingPayments = DB.orders.filter(o => (o.pending || 0) > 0);
  const alerts = [];
  if (overdue.length)         alerts.push({ icon: 'triangle-exclamation', color: '#ef4444', msg: `${overdue.length} overdue order${overdue.length>1?'s':''}` });
  if (pendingPayments.length) alerts.push({ icon: 'wallet',               color: '#f97316', msg: `${pendingPayments.length} orders with pending payment` });
  panel.innerHTML = alerts.map(a => `
    <div class="alert-item">
      <i class="fa-solid fa-${a.icon}" style="color:${a.color}"></i>
      <span>${a.msg}</span>
    </div>`).join('');
}

// ── CSV Export ──
function exportCSV() {
  if (!DB.orders.length) { showToast('No orders to export', 'warning'); return; }
  const cols = ['Product Name','Brand','Status','Qty','Buy Price','Shipping','Total','Paid','Pending','ETA','Order Date','Seller','Notes'];
  const rows = DB.orders.map(o => [
    o.productName, o.brand, o.status, o.qty,
    o.actualPrice, o.shipping, o.total, o.paid, o.pending,
    o.eta, o.orderDate, o.vendor, o.notes
  ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  const csv = [cols.join(','), ...rows].join('\n');
  const link = document.createElement('a');
  link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  link.download = `pretrack-export-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  showToast('CSV exported!', 'success');
}
