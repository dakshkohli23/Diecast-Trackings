'use strict';
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const _cfg = (typeof window !== 'undefined' && window.__PRETRACK_CONFIG__) || {};
const firebaseConfig = {
  apiKey:            _cfg.firebase?.apiKey            || '',
  authDomain:        _cfg.firebase?.authDomain        || '',
  projectId:         _cfg.firebase?.projectId         || '',
  storageBucket:     _cfg.firebase?.storageBucket     || '',
  messagingSenderId: _cfg.firebase?.messagingSenderId || '',
  appId:             _cfg.firebase?.appId             || '',
};
let _currentUser = null;
const app           = initializeApp(firebaseConfig);
const auth          = getAuth(app);
const db            = getFirestore(app);
const secondaryApp  = initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

const SUPER_ADMIN       = _cfg.superAdmin       || 'dlaize@dlaize.com';
const SUPABASE_URL      = _cfg.supabase?.url    || '';
const SUPABASE_ANON_KEY = _cfg.supabase?.anonKey || '';
const SUPABASE_BUCKET   = 'order-images';
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase not configured in config/config.js');
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

async function uploadImageToSupabase(file) {
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `orders/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await getSupabase().storage.from(SUPABASE_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data } = getSupabase().storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function deleteImageFromSupabase(imageUrl) {
  if (!imageUrl || !imageUrl.includes(SUPABASE_URL)) return;
  const marker = `/object/public/${SUPABASE_BUCKET}/`;
  const idx    = imageUrl.indexOf(marker);
  if (idx === -1) return;
  const filePath = decodeURIComponent(imageUrl.slice(idx + marker.length).split('?')[0]);
  const { error } = await getSupabase().storage.from(SUPABASE_BUCKET).remove([filePath]);
  if (error) console.warn('Supabase delete failed:', error.message);
}

/* ══ APP STATE ══ */
let DB = { orders: [], activity: [], accessRequests: [], users: [] };
let _currentImageFile = null;
let _currentImageB64  = '';
let _authReady        = false;

/* ══════════════════════════════════════════════════════════════════
   BRAND STATE — module-level so both fetchData() and initDashboard()
   can read/write without closure issues
══════════════════════════════════════════════════════════════════ */
const BASE_BRANDS = ['Hot Wheels','Mini GT','Pop Race','Tarmac Works','Tomica','Matchbox','Kaido House','Inno64'];
let customBrands  = [];

function getAllBrands() { return [...BASE_BRANDS, ...customBrands]; }

function rebuildDropdown(selectEl, selectedVal) {
  if (!selectEl) return;
  while (selectEl.options.length) selectEl.remove(0);
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = 'Select Brand';
  selectEl.appendChild(ph);
  getAllBrands().forEach(b => {
    const o = document.createElement('option'); o.value = b; o.textContent = b;
    selectEl.appendChild(o);
  });
  const nw = document.createElement('option');
  nw.value = '__new__'; nw.textContent = '＋ Add New Brand';
  selectEl.appendChild(nw);
  if (selectedVal) selectEl.value = selectedVal;
}

function rebuildAllBrandDropdowns(selectedVal) {
  rebuildDropdown(document.getElementById('fBrandSelect'), selectedVal);
  rebuildDropdown(document.getElementById('pBrandSelect'), selectedVal);
}
function setText(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }
function escHtml(str='')  { return String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function formatDate(s)    { if(!s) return '—'; const d=new Date(s); return isNaN(d)?s:d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }

function showToast(message, type='info') {
  let t = document.getElementById('globalToast');
  if (!t) {
    t = document.createElement('div'); t.id = 'globalToast';
    Object.assign(t.style, { position:'fixed', right:'20px', bottom:'20px', zIndex:'9999',
      padding:'12px 16px', borderRadius:'12px', color:'#fff', fontSize:'14px', fontWeight:'600',
      boxShadow:'0 10px 30px rgba(0,0,0,.25)', transition:'all .25s ease',
      transform:'translateY(20px)', opacity:'0' });
    document.body.appendChild(t);
  }
  t.style.background = { success:'linear-gradient(135deg,#22c55e,#14b8a6)', warning:'linear-gradient(135deg,#f97316,#ef4444)', info:'linear-gradient(135deg,#7c5cfc,#6366f1)' }[type] || 'linear-gradient(135deg,#7c5cfc,#6366f1)';
  t.textContent = message;
  requestAnimationFrame(() => { t.style.transform='translateY(0)'; t.style.opacity='1'; });
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { t.style.transform='translateY(20px)'; t.style.opacity='0'; }, 2500);
}
function initGreeting() {
  async function getDisplayName() {
    const user = auth.currentUser; if (!user) return 'there';
    if (user.email?.toLowerCase() === SUPER_ADMIN.toLowerCase()) return 'Super Admin';
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('email', '==', user.email)));
      if (!snap.empty) { const d = snap.docs[0].data(); if (d.name?.trim()) return d.name.trim(); }
    } catch(e) { /* fallback */ }
    return (user.email || '').split('@')[0] || 'there';
  }
  function update(name) {
    const h    = new Date().getHours();
    const msgs = h < 5
      ? ['Still up? Dedication. 🌙', 'Night owl mode. 🦉', 'The collection never sleeps. 🌙']
      : h < 12
      ? ['Ready to track. ☕', 'New day, new models. 🏎️', 'Collection check time. 📦']
      : h < 17
      ? ['Keep the fleet growing. 🚗', 'Midday collection check. 📊', 'Any new arrivals? 📬']
      : h < 21
      ? ['Evening patrol. 🌆', 'End of day review. 📋', 'How\'s the collection today? 🏎️']
      : ['Night shift. 🌙', 'Late night tracking. 🔦', 'One last check. 🌙'];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];

    const gt = document.getElementById('greetingText');
    if (gt) gt.innerHTML = `<span style="color:var(--primary);font-weight:900">${escHtml(name)}</span> — ${msg}`;

    const gd = document.getElementById('greetingDate');
    if (gd) gd.textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    // Sync avatar in hero
    const saved   = JSON.parse(localStorage.getItem('pretrack_profile') || '{}');
    const avatUrl = saved.avatarUrl || '';
    const initials= name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || 'DA';
    const hImg = document.getElementById('dashHeroAvatarImg');
    const hIni = document.getElementById('dashHeroAvatarIni');
    if (avatUrl && hImg) { hImg.src=avatUrl; hImg.style.display='block'; if(hIni) hIni.style.display='none'; }
    else { if(hImg) hImg.style.display='none'; if(hIni) { hIni.style.display='flex'; hIni.textContent=initials; } }

    // Hero stats
    const fmt = v => '₹'+Number(v||0).toLocaleString('en-IN');
    const today = new Date(); today.setHours(0,0,0,0);
    const in7   = new Date(today); in7.setDate(today.getDate()+7);
    const due   = DB.orders.reduce((s,o)=>s+(o.pending||0),0);
    const week  = DB.orders.filter(o=>{
      if (!o.eta||o.status==='Delivered'||o.status==='Cancelled') return false;
      const d=new Date(o.eta); d.setHours(0,0,0,0); return d>=today&&d<=in7;
    }).length;
    setText('dhStatModels', DB.orders.length);
    setText('dhStatDue',    fmt(due));
    setText('dhStatEta',    week + ' orders');
  }
  function checkSys() {
    const ss = document.getElementById('systemStatus'); if (!ss) return;
    ss.innerHTML = `<span class="status-dot"></span> Checking systems…`; ss.className = 'system-status';
    setTimeout(() => { ss.innerHTML = `<span class="status-dot"></span> All systems live`; ss.className = 'system-status live'; }, 1200);
  }
  getDisplayName().then(name => { update(name); setInterval(() => update(name), 60000); });
  checkSys();
}

/* ══════════════════════════════════════ HERO STATS ══════════════════════════════════════ */
function updateHeroStats() {
  const fmt   = v => '₹' + Number(v||0).toLocaleString('en-IN');
  const today = new Date(); today.setHours(0,0,0,0);
  const in7   = new Date(today); in7.setDate(today.getDate()+7);
  const due   = DB.orders.reduce((s,o)=>s+(o.pending||0),0);
  const week  = DB.orders.filter(o=>{
    if(!o.eta||o.status==='Delivered'||o.status==='Cancelled') return false;
    const d=new Date(o.eta); d.setHours(0,0,0,0); return d>=today&&d<=in7;
  }).length;
  setText('dhStatModels', DB.orders.length);
  setText('dhStatDue',    fmt(due));
  setText('dhStatEta',    week + (week===1?' order':' orders'));
  // Sync avatar in hero bar
  const saved    = JSON.parse(localStorage.getItem('pretrack_profile')||'{}');
  const user     = auth.currentUser;
  const isAdmin  = user?.email?.toLowerCase()===SUPER_ADMIN.toLowerCase();
  const name     = saved.displayName||(isAdmin?'Super Admin':user?.email?.split('@')[0]||'DA');
  const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'DA';
  const hImg = document.getElementById('dashHeroAvatarImg');
  const hIni = document.getElementById('dashHeroAvatarIni');
  if(saved.avatarUrl&&hImg){hImg.src=saved.avatarUrl;hImg.style.display='block';if(hIni)hIni.style.display='none';}
  else{if(hImg)hImg.style.display='none';if(hIni){hIni.style.display='flex';hIni.textContent=initials;}}
}

/* ══════════════════════════════════════ RENDER ALL ══════════════════════════════════════ */
function renderAll() {
  renderStats();
  applyCollectionFilters();
  populateBrandFilter();
  renderRecentOrders();
  renderEtaWidget();
  renderActivityFeed();
  renderAlerts();
  renderPayments();
  renderAnalytics();
  renderBrandLeaderboard();
  renderWeekArrivals();
  if (typeof renderCatalog === 'function') renderCatalog();
  renderSellers();
  renderUpcoming();
  renderUsers();
  renderAccessRequests();
  renderCalendar();
  renderBrands();
  renderSettingsInfo();
  renderProfile();
  syncTopbarAvatar();
  updateHeroStats();
  const ss = document.getElementById('systemStatus');
  if (ss) { ss.innerHTML = `<span class="status-dot"></span> All systems live`; ss.className = 'system-status live'; }
}

function renderSettingsInfo() {
  const cnt = document.getElementById('settingsModelCount');
  if (cnt) cnt.textContent = `${DB.orders.length} model${DB.orders.length !== 1 ? 's' : ''}`;
  const user = auth.currentUser;
  const emailEl = document.getElementById('settingsUserEmail');
  if (emailEl && user) emailEl.textContent = user.email || '—';
}

/* ══════════════════════════════════════ PROFILE ══════════════════════════════════════ */
function renderProfile() {
  const user    = auth.currentUser; if (!user) return;
  const orders  = DB.orders;
  const fmt     = v => '₹' + Number(v||0).toLocaleString('en-IN');
  const isAdmin = user.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();

  // Load saved profile data
  const saved     = JSON.parse(localStorage.getItem('pretrack_profile') || '{}');
  const name      = saved.displayName || (isAdmin ? 'Super Admin' : user.email?.split('@')[0] || 'User');
  const favBrand  = saved.favBrand || '';
  const bio       = saved.bio || '';
  const avatarUrl = saved.avatarUrl || '';

  // Avatar
  const initials  = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const avatarImg = document.getElementById('profileAvatarImg');
  const avatarIni = document.getElementById('profileAvatarInitials');
  if (avatarUrl && avatarImg) {
    avatarImg.src = avatarUrl; avatarImg.style.display = 'block';
    if (avatarIni) avatarIni.style.display = 'none';
  } else {
    if (avatarImg) avatarImg.style.display = 'none';
    if (avatarIni) { avatarIni.style.display = 'flex'; avatarIni.textContent = initials; }
  }

  // Identity
  setText('profileDisplayName', name);
  setText('profileRoleBadge',   (isAdmin ? '⚡ Super Admin' : '👤 User'));
  setText('profileEmailTag',    user.email || '—');
  setText('profileSince',       user.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString('en-IN',{month:'short',year:'numeric'}) : '—');

  // Quick stats
  const delivered = orders.filter(o=>o.status==='Delivered').length;
  const pending   = orders.filter(o=>o.status!=='Delivered'&&o.status!=='Cancelled').length;
  const totalDue  = orders.reduce((s,o)=>s+(o.pending||0),0);
  setText('pStatModels',    orders.length);
  setText('pStatDelivered', delivered);
  setText('pStatPending',   pending);
  setText('pStatDue',       fmt(totalDue));

  // Form
  const nameInput  = document.getElementById('profileNameInput');
  const emailInput = document.getElementById('profileEmailInput');
  const brandInput = document.getElementById('profileFavBrand');
  const bioInput   = document.getElementById('profileBio');
  if (nameInput)  nameInput.value  = name;
  if (emailInput) emailInput.value = user.email || '—';
  if (brandInput) brandInput.value = favBrand;
  if (bioInput)   bioInput.value   = bio;

  // Account info
  setText('profileAccEmail', user.email || '—');
  setText('profileAccUid',   user.uid   || '—');
  setText('profileAccRole',  isAdmin ? 'Super Admin' : 'User');

  // Collection breakdown by status
  const statuses = ['Ordered','In Transit','Delivered','Cancelled'];
  const colors   = ['#4f46e5','#0284c7','#16a34a','#6b7280'];
  const counts   = statuses.map(s => orders.filter(o=>o.status===s).length);
  const maxCount = Math.max(...counts, 1);
  const bdEl = document.getElementById('profileBreakdown');
  if (bdEl) {
    bdEl.innerHTML = statuses.map((s,i) => `
      <div class="profile-breakdown-row">
        <span class="profile-breakdown-label">${s}</span>
        <div class="profile-breakdown-bar-wrap">
          <div class="profile-breakdown-bar" style="width:${Math.round((counts[i]/maxCount)*100)}%;background:${colors[i]}"></div>
        </div>
        <span class="profile-breakdown-count">${counts[i]}</span>
      </div>`).join('');
  }
}

function syncTopbarAvatar() {
  const saved    = JSON.parse(localStorage.getItem('pretrack_profile') || '{}');
  const user     = auth.currentUser;
  const isAdmin  = user?.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();
  const name     = saved.displayName || (isAdmin ? 'Super Admin' : user?.email?.split('@')[0] || 'User');
  const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const url      = saved.avatarUrl || '';

  // Topbar small avatar
  const img = document.getElementById('topbarAvatarImg');
  const ini = document.getElementById('topbarAvatarInitials');
  if (url && img) { img.src=url; img.style.display='block'; if(ini) ini.style.display='none'; }
  else { if(img) img.style.display='none'; if(ini) { ini.style.display='flex'; ini.textContent=initials; } }

  // Dropdown large avatar
  const ddImg = document.getElementById('topbarDdAvatarImg');
  const ddIni = document.getElementById('topbarDdInitials');
  if (url && ddImg) { ddImg.src=url; ddImg.style.display='block'; if(ddIni) ddIni.style.display='none'; }
  else { if(ddImg) ddImg.style.display='none'; if(ddIni) { ddIni.style.display='flex'; ddIni.textContent=initials; } }

  // Names
  setText('profileName',  name);
  setText('profileRole',  isAdmin ? 'Super Admin' : 'User');
  setText('topbarDdName', name);
  setText('topbarDdEmail', user?.email || '—');
}

/* ══════════════════════════════════════ GLOBAL SEARCH ══════════════════════════════════════ */
function initGlobalSearch() {
  const overlay  = document.getElementById('gsOverlay');
  const modal    = document.getElementById('gsModal');
  const input    = document.getElementById('gsInput');
  const body     = document.getElementById('gsBody');
  const trigger  = document.getElementById('gsTrigger');
  if (!overlay || !input) return;

  let activeIdx  = -1;
  let results    = [];

  function open() {
    overlay.classList.remove('hidden');
    input.value = '';
    body.innerHTML = `<div class="gs-empty"><i class="fa-solid fa-magnifying-glass"></i><span>Type to search your collection</span></div>`;
    activeIdx = -1; results = [];
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    overlay.classList.add('hidden');
    input.value = '';
    activeIdx = -1; results = [];
  }

  // Open triggers
  trigger?.addEventListener('click', open);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault(); open();
    }
    if (e.key === 'Escape') close();
  });

  // Close on overlay click (outside modal)
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Keyboard navigation inside modal
  input.addEventListener('keydown', e => {
    const rows = body.querySelectorAll('.gs-result');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, rows.length - 1);
      rows.forEach((r,i) => r.classList.toggle('gs-active', i === activeIdx));
      rows[activeIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      rows.forEach((r,i) => r.classList.toggle('gs-active', i === activeIdx));
      rows[activeIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = body.querySelector('.gs-result.gs-active');
      if (active) active.click();
      else if (rows.length) rows[0].click();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  // Search on input
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      body.innerHTML = `<div class="gs-empty"><i class="fa-solid fa-magnifying-glass"></i><span>Type to search your collection</span></div>`;
      activeIdx = -1; return;
    }
    doSearch(q);
  });

  function hl(text, q) {
    if (!q) return escHtml(text);
    const safe = escHtml(text);
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp('(' + safeQ + ')', 'gi'), '<mark>$1</mark>');
  }

  function navigateTo(section) {
    const pageMap = {
      dashboard:'index.html', orders:'collection.html', 'add-order':'add-order.html',
      catalog:'catalog.html', brands:'brands.html', sellers:'sellers.html',
      calendar:'calendar.html', upcoming:'upcoming.html', analytics:'analytics.html',
      payments:'payments.html', users:'users.html', 'access-requests':'access-requests.html',
      settings:'settings.html', profile:'profile.html'
    };
    if (pageMap[section]) { window.location.href = pageMap[section]; return; }
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');
    document.getElementById(`section-${section}`)?.classList.add('active');
    const sdw = document.getElementById('sellerDetailWrap');
    const sg  = document.getElementById('sellerGrid');
    if (sdw && sg) { sdw.classList.remove('visible'); sg.style.display = ''; }
  }

  function doSearch(q) {
    const fmt = v => '₹' + Number(v||0).toLocaleString('en-IN');
    let html  = '';

    // ── MODELS ──
    const models = DB.orders.filter(o =>
      (o.product_name||'').toLowerCase().includes(q) ||
      (o.brand||'').toLowerCase().includes(q) ||
      (o.scale||'').toLowerCase().includes(q) ||
      (o.variant||'').toLowerCase().includes(q) ||
      (o.order_number||'').toString().includes(q)
    ).slice(0, 8);

    if (models.length) {
      html += '<div class="gs-section-label"><i class="fa-solid fa-car-side"></i> Models</div>';
      html += models.map((o,i) => {
        const sc    = (o.status||'').toLowerCase().replace(/\s+/g,'-');
        const thumb = o.image
          ? `<img src="${escHtml(o.image)}" alt="" />`
          : `<i class="fa-solid fa-car-side"></i>`;
        return `<div class="gs-result" data-type="order" data-id="${o.id}">
          <div class="gs-result-thumb">${thumb}</div>
          <div class="gs-result-info">
            <div class="gs-result-name">${hl(o.product_name||'—', q)}</div>
            <div class="gs-result-sub">${escHtml(o.brand||'—')} · ${escHtml(o.scale||'1:64')}${o.vendor?' · '+escHtml(o.vendor):''}</div>
          </div>
          <div class="gs-result-right">
            <span class="badge badge-${sc} gs-result-badge">${escHtml(o.status||'Ordered')}</span>
            <span class="gs-result-price">${fmt(o.total||0)}</span>
          </div>
        </div>`;
      }).join('');
    }

    // ── SELLERS ──
    const sellers = [...new Set(DB.orders.map(o => o.vendor).filter(Boolean))]
      .filter(v => v.toLowerCase().includes(q)).slice(0, 4);

    if (sellers.length) {
      html += '<div class="gs-section-label"><i class="fa-solid fa-store"></i> Sellers</div>';
      html += sellers.map(s => {
        const ords  = DB.orders.filter(o => o.vendor === s);
        const total = ords.reduce((x,o)=>x+(o.total||0),0);
        return `<div class="gs-result" data-type="seller" data-seller="${escHtml(s)}">
          <div class="gs-result-thumb" style="background:linear-gradient(135deg,#7c5cfc,#5b3fd4);color:#fff;font-size:.8rem"><i class="fa-solid fa-store"></i></div>
          <div class="gs-result-info">
            <div class="gs-result-name">${hl(s, q)}</div>
            <div class="gs-result-sub">${ords.length} order${ords.length!==1?'s':''}</div>
          </div>
          <div class="gs-result-right">
            <span class="gs-result-price">${fmt(total)}</span>
          </div>
        </div>`;
      }).join('');
    }

    // ── BRANDS ──
    const brands = [...new Set(DB.orders.map(o => o.brand).filter(Boolean))]
      .filter(b => b.toLowerCase().includes(q)).slice(0, 4);

    if (brands.length) {
      html += '<div class="gs-section-label"><i class="fa-solid fa-tag"></i> Brands</div>';
      html += brands.map(b => {
        const ords  = DB.orders.filter(o => o.brand === b);
        const total = ords.reduce((x,o)=>x+(o.total||0),0);
        return `<div class="gs-result" data-type="brand" data-brand="${escHtml(b)}">
          <div class="gs-result-thumb" style="background:rgba(124,92,252,0.15);color:#7c5cfc;font-size:.85rem"><i class="fa-solid fa-building"></i></div>
          <div class="gs-result-info">
            <div class="gs-result-name">${hl(b, q)}</div>
            <div class="gs-result-sub">${ords.length} model${ords.length!==1?'s':''} · ${fmt(total)}</div>
          </div>
          <div class="gs-result-right">
            <span style="font-size:.68rem;color:var(--text-muted)">${ords.filter(o=>o.status==='Delivered').length} delivered</span>
          </div>
        </div>`;
      }).join('');
    }

    if (!models.length && !sellers.length && !brands.length) {
      html = `<div class="gs-no-results"><i class="fa-solid fa-circle-xmark" style="font-size:1.5rem;opacity:.2;display:block;margin-bottom:.5rem"></i>No results for "<strong>${escHtml(q)}</strong>"</div>`;
    }

    body.innerHTML = html;
    activeIdx = -1;

    // Wire up click handlers
    body.querySelectorAll('.gs-result').forEach(row => {
      row.addEventListener('click', () => {
        const type   = row.dataset.type;
        const id     = row.dataset.id;
        const seller = row.dataset.seller;
        const brand  = row.dataset.brand;
        close();
        if (type === 'order') {
          setTimeout(() => window.viewOrder?.(id), 100);
        } else if (type === 'seller') {
          navigateTo('sellers');
          setTimeout(() => window.showSellerDetail?.(seller), 150);
        } else if (type === 'brand') {
          navigateTo('brands');
          setTimeout(() => window.showBrandDetail?.(brand), 150);
        }
      });
    });
  }
}

function initTopbarDropdown() {
  const btn      = document.getElementById('topbarProfileBtn');
  const dropdown = document.getElementById('topbarDropdown');
  const chevron  = document.getElementById('topbarChevron');
  if (!btn || !dropdown) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', open);
    if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
    if (!open) syncTopbarAvatar();
  });

  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    if (chevron) chevron.style.transform = '';
  });

  document.getElementById('ddGoProfile')?.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    if (chevron) chevron.style.transform = '';
    // Navigate to profile section
    window.location.href = 'profile.html';
    renderProfile();
  });

  document.getElementById('ddGoSettings')?.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    if (chevron) chevron.style.transform = '';
    window.location.href = 'settings.html';
  });

  document.getElementById('ddLogout')?.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    document.getElementById('logoutBtn')?.click();
  });

  // Initial sync
  syncTopbarAvatar();
}

/* ══════════════════════════════════════ PROFILE FIRESTORE ══════════════════════════════════════ */
async function loadProfileFromFirestore() {
  const user = auth.currentUser; if (!user) return;
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('email','==',user.email)));
    if (!snap.empty) {
      const data   = snap.docs[0].data();
      const local  = JSON.parse(localStorage.getItem('pretrack_profile') || '{}');
      const merged = {
        ...local,
        displayName: data.displayName || local.displayName || '',
        favBrand:    data.favBrand    || local.favBrand    || '',
        bio:         data.bio         || local.bio         || '',
        avatarUrl:   data.avatarUrl   || local.avatarUrl   || '',
        _docId:      snap.docs[0].id
      };
      localStorage.setItem('pretrack_profile', JSON.stringify(merged));
    }
  } catch(e) { console.warn('loadProfileFromFirestore:', e.message); }
}

async function saveProfileToFirestore(fields) {
  const user = auth.currentUser; if (!user) return;
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('email','==',user.email)));
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, { ...fields, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, 'users'), {
        uid: user.uid, email: user.email, role: 'viewer',
        status: 'active', createdAt: serverTimestamp(), ...fields
      });
    }
  } catch(e) { console.warn('saveProfileToFirestore:', e.message); }
}

async function uploadAvatarToSupabase(file) {
  const user = auth.currentUser; if (!user) return null;
  try {
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = 'avatars/' + user.uid + '.' + ext;
    await getSupabase().storage.from(SUPABASE_BUCKET).remove([path]);
    const { error } = await getSupabase().storage.from(SUPABASE_BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: true, contentType: file.type
    });
    if (error) throw error;
    const { data } = getSupabase().storage.from(SUPABASE_BUCKET).getPublicUrl(path);
    return data.publicUrl + '?t=' + Date.now();
  } catch(e) { console.warn('uploadAvatarToSupabase:', e.message); return null; }
}

function initProfileSection() {
  // Save text fields → Firestore + localStorage
  document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
    const btn   = document.getElementById('saveProfileBtn');
    const name  = document.getElementById('profileNameInput')?.value.trim();
    const brand = document.getElementById('profileFavBrand')?.value.trim();
    const bio   = document.getElementById('profileBio')?.value.trim();
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; }
    await saveProfileToFirestore({ displayName:name, favBrand:brand, bio });
    const saved = JSON.parse(localStorage.getItem('pretrack_profile') || '{}');
    localStorage.setItem('pretrack_profile', JSON.stringify({ ...saved, displayName:name, favBrand:brand, bio }));
    syncTopbarAvatar();
    renderProfile();
    if (btn) { btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save Changes'; }
    showToast?.('Profile saved!', 'success');
  });

  // Avatar upload → Supabase + Firestore URL
  document.getElementById('profileAvatarInput')?.addEventListener('change', async function() {
    const file = this.files?.[0]; if (!file) return;
    const ini  = document.getElementById('profileAvatarInitials');
    const prev = ini?.textContent;
    if (ini) ini.textContent = '...';
    const url = await uploadAvatarToSupabase(file);
    if (url) {
      await saveProfileToFirestore({ avatarUrl: url });
      const saved = JSON.parse(localStorage.getItem('pretrack_profile') || '{}');
      localStorage.setItem('pretrack_profile', JSON.stringify({ ...saved, avatarUrl: url }));
      syncTopbarAvatar(); renderProfile();
      showToast?.('Avatar updated!', 'success');
    } else {
      // Fallback: base64 localStorage only
      const reader = new FileReader();
      reader.onload = e => {
        const b64   = e.target.result;
        const saved = JSON.parse(localStorage.getItem('pretrack_profile') || '{}');
        localStorage.setItem('pretrack_profile', JSON.stringify({ ...saved, avatarUrl: b64 }));
        syncTopbarAvatar(); renderProfile();
      };
      reader.readAsDataURL(file);
      if (ini) ini.textContent = prev;
    }
  });
}



/* ══════════════════════════════════════ STATS ══════════════════════════════════════ */
async function ensureUserProfile(user) {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', user.email)));
    if (snap.empty) {
      await addDoc(collection(db, 'users'), {
        uid: user.uid, email: user.email,
        role: 'viewer', status: 'active', createdAt: serverTimestamp()
      });
    } else {
      const d = snap.docs[0].data();
      if (!d.uid || d.uid !== user.uid) await updateDoc(snap.docs[0].ref, { uid: user.uid });
    }
  } catch(e) { console.warn('ensureUserProfile:', e.message); }
}

/* ══════════════════════════════════════ INIT DASHBOARD ══════════════════════════════════════ */
async function fetchData() {
  // Warn if secrets not injected but continue anyway
  if (firebaseConfig.apiKey.startsWith('__')) {
    console.error('WARNING: Firebase credentials not injected by GitHub Actions.');
  }

  try {
    const user = auth.currentUser;
    if (!user) return;
    const currentEmail = (user.email || '').toLowerCase().trim();
    const isAdmin      = currentEmail === SUPER_ADMIN.toLowerCase().trim();

    // Wrap each fetch individually — one failure won't kill everything
    const safeGet = async (ref) => {
      try { return await getDocs(ref); }
      catch(e) { console.warn('Fetch failed:', e.code, e.message); return { docs: [] }; }
    };

    const [ordSnap, actSnap, brnSnap] = await Promise.all([
      safeGet(collection(db, 'orders')),
      safeGet(collection(db, 'activity')),
      safeGet(collection(db, 'brands')),
    ]);

    const arsSnap = isAdmin ? await safeGet(collection(db, 'access_requests')) : { docs: [] };
    const usrSnap = isAdmin ? await safeGet(collection(db, 'users'))           : { docs: [] };

    DB.orders = ordSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    // Fix incorrect totals in memory + Firestore silently
    DB.orders.forEach(o => {
      const unit    = (parseFloat(o.actual_price) > 0 ? parseFloat(o.actual_price) : parseFloat(o.preorder_price)) || 0;
      const qty     = parseInt(o.quantity) || 1;
      const ship    = parseFloat(o.shipping) || 0;
      const paid    = parseFloat(o.paid) || 0;
      const correct = (unit * qty) + ship;
      const pend    = Math.max(0, correct - paid);
      if (Math.abs((o.total||0) - correct) > 1) {
        o.total   = correct;
        o.pending = pend;
        updateDoc(doc(db, 'orders', o.id), { total: correct, pending: pend })
          .catch(e => console.warn('Fix order:', o.id, e.message));
      }
    });

    DB.activity = actSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    customBrands = brnSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .map(b => b.name)
      .filter(Boolean);
    rebuildAllBrandDropdowns();

    DB.accessRequests = isAdmin
      ? arsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      : [];

    DB.users = isAdmin
      ? usrSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      : [];

    console.log(`fetchData: ${DB.orders.length} orders loaded`);
    renderAll();

  } catch(err) {
    console.error('fetchData fatal error:', err);
    DB = { orders: [], activity: [], accessRequests: [], users: [] };
    renderAll();
    showToast('Error loading data: ' + (err.code || err.message), 'warning');
  }
}

async function addActivity(type, msg) {
  const user = auth.currentUser;
  try {
    await addDoc(collection(db, 'activity'), {
      type, msg, time: new Date().toLocaleString(),
      createdAt:  serverTimestamp(),
      ownerUid:   user?.uid   || '',
      ownerEmail: user?.email || ''
    });
  } catch(e) { console.error('addActivity error:', e); }
}


/* ══ SHARED UI — sidebar toggle, logout, nav links ══ */
function initSharedUI() {
  const sidebar        = document.getElementById('sidebar');
  const mainWrap       = document.getElementById('mainWrap');
  const sidebarToggle  = document.getElementById('sidebarToggle');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const isMobile       = () => window.innerWidth <= 900;

  sidebarToggle?.addEventListener('click', () => {
    if (isMobile()) {
      const isOpen = sidebar.classList.contains('mobile-open');
      sidebar.classList.toggle('mobile-open', !isOpen);
      sidebarOverlay?.classList.toggle('show', !isOpen);
      document.body.style.overflow = isOpen ? '' : 'hidden';
    } else {
      sidebar.classList.toggle('collapsed');
      mainWrap?.classList.toggle('expanded');
    }
  });
  sidebarOverlay?.addEventListener('click', () => {
    sidebar.classList.remove('mobile-open');
    sidebarOverlay?.classList.remove('show');
    document.body.style.overflow = '';
  });

  const logout = async () => {
    try { await signOut(auth); window.location.href = '../../login.html'; }
    catch(e) { showToast('Logout failed', 'warning'); }
  };
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('ddLogout')?.addEventListener('click', logout);
  document.getElementById('topbarAddBtn')?.addEventListener('click', () => { window.location.href = 'add-order.html'; });
  document.getElementById('ddGoProfile')?.addEventListener('click',  () => { window.location.href = 'profile.html'; });
  document.getElementById('ddGoSettings')?.addEventListener('click', () => { window.location.href = 'settings.html'; });

  const isAdmin = auth.currentUser?.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');

  initTopbarDropdown();
  initGlobalSearch();
}

/* ══ AUTH BOOT ══ */
async function bootPage(onReady) {
  onAuthStateChanged(auth, async user => {
    if (!user) { window.location.href = '../../login.html'; return; }
    _currentUser = user;
    const isSA = user.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();
    if (isSA) {
      setText('profileName', 'Super Admin');
      setText('profileRole', 'Super Admin');
    } else {
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('email', '==', user.email)));
        if (!snap.empty) {
          const d = snap.docs[0].data();
          setText('profileName', d.name?.trim() || user.email);
          const rm = { super_admin:'Super Admin', admin:'Admin', editor:'Editor', viewer:'User' };
          setText('profileRole', rm[d.role] || 'User');
        } else {
          setText('profileName', user.email);
          setText('profileRole', 'User');
        }
      } catch(e) { setText('profileName', user.email); }
    }
    await loadProfileFromFirestore();
    initSharedUI();
    await onReady(user, isSA);
  });
}
function renderAnalytics() {
  const o   = DB.orders;
  const fmt = v => '\u20b9' + Number(v||0).toLocaleString('en-IN');
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };

  const totalInvested = o.reduce((s,x)=>s+(x.total||0),0);
  const totalPaid     = o.reduce((s,x)=>s+(x.paid||0),0);
  const totalDue      = o.reduce((s,x)=>s+(x.pending||0),0);
  const totalUnits    = o.reduce((s,x)=>s+(x.quantity||1),0);
  const avgPrice      = totalUnits>0?Math.round(totalInvested/totalUnits):0;
  const payPct        = totalInvested>0?Math.round((totalPaid/totalInvested)*100):0;

  set('anTotalInvested', fmt(totalInvested));
  set('anTotalPaid',     fmt(totalPaid));
  set('anTotalDue',      fmt(totalDue));
  set('anTotalUnits',    totalUnits);
  set('anAvgPrice',      fmt(avgPrice));

  setTimeout(()=>{
    const bp=document.getElementById('anBarPaid'); if(bp) bp.style.width=(totalInvested>0?Math.round((totalPaid/totalInvested)*100):0)+'%';
    const bd=document.getElementById('anBarDue');  if(bd) bd.style.width=(totalInvested>0?Math.round((totalDue/totalInvested)*100):0)+'%';
  },200);

  // Gauge
  const gf=document.getElementById('anGaugeFill'),gp=document.getElementById('anGaugePct');
  if(gf&&gp){setTimeout(()=>{gf.style.strokeDashoffset=283-(payPct/100)*283;},300);gp.textContent=payPct+'%';}
  const gs=document.getElementById('anGaugeStats');
  if(gs) gs.innerHTML=[{l:'Invested',v:fmt(totalInvested),c:'#7c5cfc'},{l:'Paid',v:fmt(totalPaid),c:'#16a34a'},{l:'Due',v:fmt(totalDue),c:'#f97316'}]
    .map(r=>'<div class="an-gauge-stat-row"><span class="an-gauge-stat-label"><span style="width:8px;height:8px;border-radius:50%;background:'+r.c+';display:inline-block;margin-right:.25rem"></span>'+r.l+'</span><span class="an-gauge-stat-val">'+r.v+'</span></div>').join('');

  // Status bars
  const statuses=[{k:'Ordered',c:'#4f46e5'},{k:'In Transit',c:'#0284c7'},{k:'Delivered',c:'#16a34a'},{k:'Cancelled',c:'#6b7280'}];
  const sEl=document.getElementById('anStatusBars');
  if(sEl){sEl.innerHTML=statuses.map(s=>{const cnt=o.filter(x=>x.status===s.k).length;const pct=Math.round((cnt/Math.max(o.length,1))*100);return'<div class="an-bar-row"><div class="an-bar-top"><span class="an-bar-name">'+s.k+'</span><span class="an-bar-count">'+cnt+' \xb7 '+pct+'%</span></div><div class="an-bar-track"><div class="an-bar-fill" style="width:0%;background:'+s.c+'" data-w="'+pct+'"></div></div></div>';}).join('');
  setTimeout(()=>{sEl.querySelectorAll('.an-bar-fill').forEach(el=>{el.style.width=el.dataset.w+'%';});},250);}

  // Scale bars
  const scaleMap={};o.forEach(x=>{const s=x.scale||'1:64';scaleMap[s]=(scaleMap[s]||0)+1;});
  const scEl=document.getElementById('anScaleBars');
  const sColors=['#7c5cfc','#0284c7','#16a34a','#f97316','#ec4899','#6d28d9'];
  if(scEl){const scales=Object.entries(scaleMap).sort((a,b)=>b[1]-a[1]).slice(0,6);const maxSc=Math.max(...scales.map(s=>s[1]),1);
  scEl.innerHTML=scales.map(([sc,cnt],i)=>{const pct=Math.round((cnt/Math.max(o.length,1))*100);return'<div class="an-bar-row"><div class="an-bar-top"><span class="an-bar-name">'+sc+'</span><span class="an-bar-count">'+cnt+' \xb7 '+pct+'%</span></div><div class="an-bar-track"><div class="an-bar-fill" style="width:0%;background:'+sColors[i%sColors.length]+'" data-w="'+Math.round((cnt/maxSc)*100)+'"></div></div></div>';}).join('')||'<div class="empty-state">No data</div>';
  setTimeout(()=>{scEl.querySelectorAll('.an-bar-fill').forEach(el=>{el.style.width=el.dataset.w+'%';});},300);}

  // Monthly chart
  const mEl=document.getElementById('anMonthlyChart'),mT=document.getElementById('anMonthlyTotal');
  if(mEl){const mMap={};o.forEach(x=>{const raw=x.order_date;if(!raw)return;const d=new Date(raw);if(isNaN(d))return;const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');mMap[key]=(mMap[key]||0)+(x.total||0);});
  const months=Object.keys(mMap).sort().slice(-12);const vals=months.map(m=>mMap[m]);const maxV=Math.max(...vals,1);
  if(mT)mT.textContent=fmt(vals.reduce((s,v)=>s+v,0))+' over '+months.length+' months';
  if(!months.length){mEl.innerHTML='<div class="empty-state" style="width:100%">No dated orders yet</div>';}
  else{mEl.innerHTML=months.map((m,i)=>{const h=Math.max(4,Math.round((vals[i]/maxV)*100));const lbl=m.slice(2,7).replace('-','/');const isPeak=i===vals.indexOf(maxV);return'<div class="an-month-col"><div class="an-month-bar-wrap" style="height:120px"><div class="an-month-bar" data-val="'+fmt(vals[i])+'" data-h="'+h+'" style="height:0;width:100%;background:linear-gradient(180deg,'+(isPeak?'#ec4899,#be185d':'#7c5cfc,#5b3fd4')+')"></div></div><div class="an-month-label">'+lbl+'</div></div>';}).join('');
  setTimeout(()=>{mEl.querySelectorAll('.an-month-bar').forEach(el=>{el.style.height=el.dataset.h+'%';});},300);}}

  // Brand bars
  const bMap={};o.forEach(x=>{const b=x.brand||'Unknown';bMap[b]=(bMap[b]||0)+(x.total||0);});
  const bEl=document.getElementById('anBrandBars');
  const bColors=['linear-gradient(90deg,#7c5cfc,#5b3fd4)','linear-gradient(90deg,#0284c7,#0369a1)','linear-gradient(90deg,#16a34a,#15803d)','linear-gradient(90deg,#f97316,#ea580c)','linear-gradient(90deg,#ec4899,#be185d)','linear-gradient(90deg,#6d28d9,#5b21b6)','linear-gradient(90deg,#ef4444,#dc2626)'];
  if(bEl){const brands=Object.entries(bMap).sort((a,b)=>b[1]-a[1]).slice(0,7);const maxB=brands[0]?.[1]||1;
  bEl.innerHTML=brands.map(([b,v],i)=>'<div class="an-brand-row"><span class="an-brand-rank">#'+(i+1)+'</span><div class="an-brand-info"><div class="an-brand-name">'+escHtml(b)+'</div><div class="an-brand-track"><div class="an-brand-fill" style="width:0%;background:'+bColors[i%bColors.length]+'" data-w="'+Math.round((v/maxB)*100)+'"></div></div></div><span class="an-brand-val">'+fmt(v)+'</span></div>').join('')||'<div class="empty-state">No data</div>';
  setTimeout(()=>{bEl.querySelectorAll('.an-brand-fill').forEach(el=>{el.style.width=el.dataset.w+'%';});},350);}

  // Seller bars
  const slMap={};o.forEach(x=>{const s=x.vendor||'Unknown';slMap[s]=(slMap[s]||0)+(x.total||0);});
  const slEl=document.getElementById('anSellerBars');
  if(slEl){const sellers=Object.entries(slMap).sort((a,b)=>b[1]-a[1]).slice(0,7);const maxSl=sellers[0]?.[1]||1;
  slEl.innerHTML=sellers.map(([s,v],i)=>'<div class="an-brand-row"><span class="an-brand-rank">#'+(i+1)+'</span><div class="an-brand-info"><div class="an-brand-name">'+escHtml(s)+'</div><div class="an-brand-track"><div class="an-brand-fill" style="width:0%;background:'+bColors[i%bColors.length]+'" data-w="'+Math.round((v/maxSl)*100)+'"></div></div></div><span class="an-brand-val">'+fmt(v)+'</span></div>').join('')||'<div class="empty-state">No data</div>';
  setTimeout(()=>{slEl.querySelectorAll('.an-brand-fill').forEach(el=>{el.style.width=el.dataset.w+'%';});},400);}
}


bootPage(async()=>{ await fetchData(); renderAnalytics(); });
