/**
 * PreTrack — Calendar Page
 * Month view ETA calendar with urgency color-coding.
 */

import { requireAuth }  from '../auth/auth-guard.js';
import { db }           from '../services/firebase.js';
import {
  initSidebar, initTopbarDropdown, syncTopbarAvatar,
  applyRoleVisibility, showToast, escHtml, formatDate, formatINR
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
let viewDate = new Date();

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
    showToast('Failed to load calendar data', 'error');
  }

  renderCalendar();
  initNav();
})();

function buildPageHTML() {
  document.getElementById('section-calendar').innerHTML = `
    <div class="section-header">
      <div><h2 class="section-title">ETA Calendar</h2><p class="section-sub">Delivery timeline &amp; urgency overview</p></div>
    </div>

    <div class="calendar-layout">
      <div class="calendar-main glass">
        <div class="calendar-topbar">
          <button class="btn btn-ghost btn-sm" id="calPrev"><i class="fa-solid fa-chevron-left"></i></button>
          <h3 class="calendar-month-label" id="calMonthLabel"></h3>
          <button class="btn btn-ghost btn-sm" id="calNext"><i class="fa-solid fa-chevron-right"></i></button>
          <button class="btn btn-ghost btn-sm" id="calToday" style="margin-left:.5rem">Today</button>
        </div>
        <div class="calendar-legend">
          <span><span class="leg-dot" style="background:#ef4444"></span> Overdue</span>
          <span><span class="leg-dot" style="background:#f97316"></span> &lt; 7 days</span>
          <span><span class="leg-dot" style="background:#7c5cfc"></span> Upcoming</span>
          <span><span class="leg-dot" style="background:#22c55e"></span> Delivered</span>
        </div>
        <div class="calendar-grid" id="calGrid"></div>
      </div>

      <div class="calendar-sidebar glass">
        <div class="cal-sidebar-header" id="calSidebarHeader">Select a day to see orders</div>
        <div id="calSidebarContent"><div class="empty-state"><i class="fa-solid fa-calendar-days"></i> Click any day</div></div>
      </div>
    </div>

    <!-- Monthly stats strip -->
    <div class="cal-stats-strip glass" id="calStatsStrip"></div>
  `;
}

function initNav() {
  document.getElementById('calPrev')?.addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); });
  document.getElementById('calNext')?.addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); });
  document.getElementById('calToday')?.addEventListener('click', () => { viewDate = new Date(); renderCalendar(); });
}

function renderCalendar() {
  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();

  document.getElementById('calMonthLabel').textContent =
    viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const firstDay   = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMo   = new Date(year, month + 1, 0).getDate();
  const today      = new Date().toISOString().slice(0,10);
  const monthStr   = `${year}-${String(month+1).padStart(2,'0')}`;

  // Map ETA dates to orders
  const etaMap = {};
  orders.forEach(o => {
    if (o.eta && o.eta.startsWith(monthStr)) {
      if (!etaMap[o.eta]) etaMap[o.eta] = [];
      etaMap[o.eta].push(o);
    }
  });

  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell cal-empty"></div>`;

  for (let day = 1; day <= daysInMo; day++) {
    const dateKey = `${monthStr}-${String(day).padStart(2,'0')}`;
    const isToday = dateKey === today;
    const dayOrders = etaMap[dateKey] || [];
    const dots = dayOrders.map(o => {
      const color = getDotColor(o, today);
      return `<span class="cal-dot" style="background:${color}"></span>`;
    }).join('');

    html += `
      <div class="cal-cell ${isToday?'cal-today':''} ${dayOrders.length?'cal-has-orders':''}" data-date="${dateKey}">
        <span class="cal-day-num">${day}</span>
        <div class="cal-dots">${dots}</div>
      </div>`;
  }

  const grid = document.getElementById('calGrid');
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => showDaySidebar(cell.dataset.date, etaMap[cell.dataset.date] || []));
  });

  renderMonthStats(monthStr, today);
}

function getDotColor(order, today) {
  if (order.status === 'Delivered') return '#22c55e';
  if (!order.eta) return '#7c5cfc';
  if (order.eta < today) return '#ef4444';
  const daysLeft = Math.ceil((new Date(order.eta) - new Date(today)) / 86400000);
  if (daysLeft <= 7) return '#f97316';
  return '#7c5cfc';
}

function showDaySidebar(date, dayOrders) {
  const header  = document.getElementById('calSidebarHeader');
  const content = document.getElementById('calSidebarContent');
  header.textContent = formatDate(date);

  if (!dayOrders.length) {
    content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-calendar-check"></i> No orders on this day</div>';
    return;
  }

  const today = new Date().toISOString().slice(0,10);
  content.innerHTML = dayOrders.map(o => {
    const color = getDotColor(o, today);
    const statusClass = { Ordered:'status-ordered','In Transit':'status-transit',Delivered:'status-delivered',Cancelled:'status-cancelled' }[o.status]||'';
    return `
    <div class="cal-sidebar-order">
      ${o.imageUrl ? `<img class="cal-order-img" src="${escHtml(o.imageUrl)}" />` : `<div class="cal-order-img-placeholder"><i class="fa-solid fa-car-side"></i></div>`}
      <div class="cal-order-info">
        <div class="cal-order-name">${escHtml(o.productName)}</div>
        <div class="cal-order-meta">${escHtml(o.brand||'—')} · ${escHtml(o.vendor||'—')}</div>
        <span class="status-badge ${statusClass}" style="margin-top:.3rem">${o.status||'—'}</span>
        <div class="cal-order-price">${formatINR(o.total)}</div>
        ${o.pending > 0 ? `<div style="font-size:.72rem;color:#f97316">Pending: ${formatINR(o.pending)}</div>` : ''}
      </div>
      <span class="cal-dot" style="background:${color};width:10px;height:10px;flex-shrink:0"></span>
    </div>`;
  }).join('');
}

function renderMonthStats(monthStr, today) {
  const monthOrders = orders.filter(o => o.eta && o.eta.startsWith(monthStr));
  const delivered   = monthOrders.filter(o => o.status === 'Delivered').length;
  const overdue     = monthOrders.filter(o => o.eta < today && o.status !== 'Delivered' && o.status !== 'Cancelled').length;
  const value       = monthOrders.reduce((s, o) => s + (o.total || 0), 0);

  document.getElementById('calStatsStrip').innerHTML = `
    <div class="cal-stat"><i class="fa-solid fa-calendar-days" style="color:#7c5cfc"></i><span>${monthOrders.length} scheduled</span></div>
    <div class="cal-stat"><i class="fa-solid fa-box-open" style="color:#22c55e"></i><span>${delivered} delivered</span></div>
    <div class="cal-stat"><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444"></i><span>${overdue} overdue</span></div>
    <div class="cal-stat"><i class="fa-solid fa-indian-rupee-sign" style="color:#6366f1"></i><span>${formatINR(value)} total</span></div>`;
}
