/**
 * PreTrack — Analytics Page
 * Brand leaderboard, spend charts, status breakdown, scale distribution, month-over-month.
 */

import { requireAuth }    from '../auth/auth-guard.js';
import { db }             from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, setText, escHtml, formatINR
} from './dashboard-shell.js';
import { getDocs, collection, query, orderBy }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

async function injectComponents() {
  const [s, t] = await Promise.all([
    fetch('../../components/sidebar.html').then(r => r.text()),
    fetch('../../components/navbar.html').then(r => r.text()),
  ]);
  document.getElementById('sidebar-root').innerHTML = s;
  document.getElementById('topbar-root').innerHTML  = t;
}

let orders = [];

(async () => {
  await injectComponents();
  const { user, role } = await requireAuth();
  initSidebar();
  initTopbarDropdown(user);
  applyRoleVisibility(role);
  syncTopbarAvatar({ email: user.email, role });

  buildPageHTML();

  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    showToast('Failed to load data', 'error');
  }

  renderAll();
})();

function buildPageHTML() {
  document.getElementById('section-analytics').innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Analytics</h2>
        <p class="section-sub">Charts, trends &amp; collection insights</p>
      </div>
    </div>

    <!-- Summary KPIs -->
    <div class="analytics-kpis" id="analyticsKpis"></div>

    <!-- Row 1: Brand + Status -->
    <div class="analytics-row">
      <div class="widget glass">
        <div class="widget-header"><h3><i class="fa-solid fa-trophy"></i> Brand Leaderboard</h3></div>
        <div id="brandLeaderboard"></div>
      </div>
      <div class="widget glass">
        <div class="widget-header"><h3><i class="fa-solid fa-circle-half-stroke"></i> Status Breakdown</h3></div>
        <div id="statusBreakdown"></div>
      </div>
    </div>

    <!-- Row 2: Scale + Month spend -->
    <div class="analytics-row">
      <div class="widget glass">
        <div class="widget-header"><h3><i class="fa-solid fa-ruler"></i> Scale Distribution</h3></div>
        <div id="scaleDistribution"></div>
      </div>
      <div class="widget glass">
        <div class="widget-header"><h3><i class="fa-solid fa-chart-line"></i> Monthly Spend</h3></div>
        <div id="monthlySpend"></div>
      </div>
    </div>

    <!-- Row 3: Seller reliability -->
    <div class="widget glass" style="margin-top:1.5rem">
      <div class="widget-header"><h3><i class="fa-solid fa-store"></i> Seller Overview</h3></div>
      <div id="sellerOverview"></div>
    </div>
  `;
}

function renderAll() {
  renderKpis();
  renderBrandLeaderboard();
  renderStatusBreakdown();
  renderScaleDistribution();
  renderMonthlySpend();
  renderSellerOverview();
}

function renderKpis() {
  const total   = orders.length;
  const invest  = orders.reduce((s, o) => s + (o.total || 0), 0);
  const pending = orders.reduce((s, o) => s + (o.pending || 0), 0);
  const brands  = new Set(orders.map(o => o.brand).filter(Boolean)).size;
  const sellers = new Set(orders.map(o => o.vendor).filter(Boolean)).size;
  const delivered = orders.filter(o => o.status === 'Delivered').length;
  const deliveryRate = total ? Math.round(delivered / total * 100) : 0;

  const kpis = [
    { label: 'Total Orders',     val: total,              icon: 'hashtag',         color: '#7c5cfc' },
    { label: 'Total Invested',   val: formatINR(invest),  icon: 'indian-rupee-sign', color: '#6366f1' },
    { label: 'Amount Due',       val: formatINR(pending), icon: 'wallet',          color: '#f97316' },
    { label: 'Brands',           val: brands,             icon: 'building',        color: '#ec4899' },
    { label: 'Sellers',          val: sellers,            icon: 'store',           color: '#14b8a6' },
    { label: 'Delivery Rate',    val: deliveryRate + '%', icon: 'circle-check',    color: '#22c55e' },
  ];

  document.getElementById('analyticsKpis').innerHTML = kpis.map(k => `
    <div class="analytics-kpi glass">
      <div class="analytics-kpi-icon" style="color:${k.color}"><i class="fa-solid fa-${k.icon}"></i></div>
      <div class="analytics-kpi-val">${k.val}</div>
      <div class="analytics-kpi-label">${k.label}</div>
    </div>`).join('');
}

function renderBrandLeaderboard() {
  const map = {};
  orders.forEach(o => {
    const b = o.brand || '?';
    if (!map[b]) map[b] = { count: 0, spend: 0 };
    map[b].count++;
    map[b].spend += o.total || 0;
  });
  const sorted = Object.entries(map).sort((a, b) => b[1].count - a[1].count);
  const max = sorted[0]?.[1].count || 1;

  const colors = ['#7c5cfc','#6366f1','#ec4899','#f97316','#14b8a6','#22c55e'];
  document.getElementById('brandLeaderboard').innerHTML = sorted.length
    ? sorted.map(([brand, s], i) => `
      <div class="lb-row">
        <div class="lb-rank-num" style="color:${colors[i%colors.length]}">#${i+1}</div>
        <div class="lb-info-col">
          <div class="lb-brand-name">${escHtml(brand)}</div>
          <div class="lb-bar-track"><div class="lb-bar-fill" style="width:${(s.count/max*100).toFixed(0)}%;background:${colors[i%colors.length]}"></div></div>
        </div>
        <div class="lb-brand-stats">
          <span class="lb-brand-count">${s.count}</span>
          <span class="lb-brand-spend">${formatINR(s.spend)}</span>
        </div>
      </div>`).join('')
    : '<div class="empty-state">No data yet</div>';
}

function renderStatusBreakdown() {
  const statuses = ['Ordered','In Transit','Delivered','Cancelled'];
  const colors   = { Ordered:'#7c5cfc','In Transit':'#14b8a6',Delivered:'#22c55e',Cancelled:'#ef4444' };
  const map = {};
  statuses.forEach(s => map[s] = 0);
  orders.forEach(o => { if (map[o.status] !== undefined) map[o.status]++; });
  const total = orders.length || 1;

  document.getElementById('statusBreakdown').innerHTML = statuses.map(s => {
    const pct = Math.round(map[s] / total * 100);
    return `
    <div class="status-breakdown-row">
      <div class="sbd-label"><span class="sbd-dot" style="background:${colors[s]}"></span>${s}</div>
      <div class="sbd-bar-track"><div class="sbd-bar-fill" style="width:${pct}%;background:${colors[s]}"></div></div>
      <div class="sbd-count">${map[s]} <span class="sbd-pct">(${pct}%)</span></div>
    </div>`;
  }).join('');
}

function renderScaleDistribution() {
  const map = {};
  orders.forEach(o => { const s = o.scale||'?'; map[s] = (map[s]||0)+1; });
  const sorted = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  const total  = orders.length || 1;
  const colors = ['#7c5cfc','#6366f1','#ec4899','#f97316','#14b8a6','#22c55e'];

  document.getElementById('scaleDistribution').innerHTML = sorted.length
    ? sorted.map(([scale, count], i) => `
      <div class="sbd-row">
        <div class="sbd-label"><span class="sbd-dot" style="background:${colors[i%colors.length]}"></span>${scale}</div>
        <div class="sbd-bar-track"><div class="sbd-bar-fill" style="width:${Math.round(count/total*100)}%;background:${colors[i%colors.length]}"></div></div>
        <div class="sbd-count">${count} <span class="sbd-pct">(${Math.round(count/total*100)}%)</span></div>
      </div>`).join('')
    : '<div class="empty-state">No data yet</div>';
}

function renderMonthlySpend() {
  const map = {};
  orders.forEach(o => {
    const d = o.orderDate || o.createdAt?.seconds
      ? new Date((o.createdAt?.seconds || 0) * 1000).toISOString()
      : null;
    if (!d) return;
    const key = d.slice(0, 7); // YYYY-MM
    if (!map[key]) map[key] = 0;
    map[key] += o.total || 0;
  });

  const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const maxSpend = Math.max(...sorted.map(e => e[1]), 1);

  document.getElementById('monthlySpend').innerHTML = sorted.length
    ? `<div class="monthly-chart">${sorted.map(([month, spend]) => `
        <div class="month-bar-col">
          <div class="month-bar-val">${formatINR(spend)}</div>
          <div class="month-bar-track">
            <div class="month-bar-fill" style="height:${Math.round(spend/maxSpend*100)}%"></div>
          </div>
          <div class="month-bar-label">${month.slice(5)}<br/>${month.slice(0,4)}</div>
        </div>`).join('')}</div>`
    : '<div class="empty-state">No monthly data yet</div>';
}

function renderSellerOverview() {
  const map = {};
  orders.forEach(o => {
    const v = o.vendor || 'Unknown';
    if (!map[v]) map[v] = { total: 0, paid: 0, pending: 0, count: 0, delivered: 0 };
    map[v].total   += o.total   || 0;
    map[v].paid    += o.paid    || 0;
    map[v].pending += o.pending || 0;
    map[v].count++;
    if (o.status === 'Delivered') map[v].delivered++;
  });

  const rows = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  const el = document.getElementById('sellerOverview');
  if (!rows.length) { el.innerHTML = '<div class="empty-state">No seller data</div>'; return; }

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table class="orders-table">
        <thead><tr><th>Seller</th><th>Orders</th><th>Delivered</th><th>Total Spend</th><th>Paid</th><th>Pending</th><th>Rate</th></tr></thead>
        <tbody>${rows.map(([seller, s]) => {
          const rate = s.count ? Math.round(s.delivered / s.count * 100) : 0;
          return `<tr>
            <td><strong>${escHtml(seller)}</strong></td>
            <td>${s.count}</td>
            <td>${s.delivered}</td>
            <td>${formatINR(s.total)}</td>
            <td style="color:#22c55e">${formatINR(s.paid)}</td>
            <td style="color:${s.pending>0?'#f97316':'#22c55e'}">${formatINR(s.pending)}</td>
            <td>
              <div style="display:flex;align-items:center;gap:.5rem">
                <div style="flex:1;height:6px;background:rgba(0,0,0,0.08);border-radius:3px">
                  <div style="width:${rate}%;height:100%;background:#22c55e;border-radius:3px"></div>
                </div>
                <span style="font-size:.72rem;color:var(--text-muted)">${rate}%</span>
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}
