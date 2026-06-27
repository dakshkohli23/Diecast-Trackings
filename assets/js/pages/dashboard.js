'use strict';
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const _cfg = (typeof window !== 'undefined' && window.__PRETRACK_CONFIG__) || {};
const firebaseConfig = {
  apiKey: _cfg.firebase?.apiKey||'', authDomain: _cfg.firebase?.authDomain||'',
  projectId: _cfg.firebase?.projectId||'', storageBucket: _cfg.firebase?.storageBucket||'',
  messagingSenderId: _cfg.firebase?.messagingSenderId||'', appId: _cfg.firebase?.appId||'',
};
let _currentUser=null, _authReady=false;
const app=initializeApp(firebaseConfig), auth=getAuth(app), db=getFirestore(app);
const secondaryApp=initializeApp(firebaseConfig,'secondary'), secondaryAuth=getAuth(secondaryApp);
const SUPER_ADMIN=_cfg.superAdmin||'dlaize@dlaize.com';
const SUPABASE_URL=_cfg.supabase?.url||'', SUPABASE_ANON_KEY=_cfg.supabase?.anonKey||'', SUPABASE_BUCKET='order-images';
let _supabase=null;
function getSupabase(){if(_supabase)return _supabase;if(!SUPABASE_URL)throw new Error('Supabase not configured');_supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);return _supabase;}
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
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    document.querySelector('.nav-item[data-section="profile"]')?.classList.add('active');
    document.getElementById('section-profile')?.classList.add('active');
    renderProfile();
  });

  document.getElementById('ddGoSettings')?.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    if (chevron) chevron.style.transform = '';
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    document.querySelector('.nav-item[data-section="settings"]')?.classList.add('active');
    document.getElementById('section-settings')?.classList.add('active');
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
function initDashboard() {

function initSharedUI(){
  const sidebar=document.getElementById('sidebar'),mainWrap=document.getElementById('mainWrap');
  const sidebarToggle=document.getElementById('sidebarToggle'),sidebarOverlay=document.getElementById('sidebarOverlay');
  const isMobile=()=>window.innerWidth<=900;
  sidebarToggle?.addEventListener('click',()=>{
    if(isMobile()){const o=sidebar.classList.contains('mobile-open');sidebar.classList.toggle('mobile-open',!o);sidebarOverlay?.classList.toggle('show',!o);document.body.style.overflow=o?'':'hidden';}
    else{sidebar.classList.toggle('collapsed');mainWrap?.classList.toggle('expanded');}
  });
  sidebarOverlay?.addEventListener('click',()=>{sidebar.classList.remove('mobile-open');sidebarOverlay.classList.remove('show');document.body.style.overflow='';});
  const logout=async()=>{try{await signOut(auth);window.location.href='../../login.html';}catch(e){showToast('Logout failed','warning');}};
  document.getElementById('logoutBtn')?.addEventListener('click',logout);
  document.getElementById('ddLogout')?.addEventListener('click',logout);
  document.getElementById('topbarAddBtn')?.addEventListener('click',()=>{window.location.href='add-order.html';});
  document.getElementById('ddGoProfile')?.addEventListener('click',()=>{window.location.href='profile.html';});
  document.getElementById('ddGoSettings')?.addEventListener('click',()=>{window.location.href='settings.html';});
  const isAdmin=auth.currentUser?.email?.toLowerCase()===SUPER_ADMIN.toLowerCase();
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=isAdmin?'':'none');
  initTopbarDropdown();
  initGlobalSearch();
}

async function bootPage(onReady){
  onAuthStateChanged(auth,async user=>{
    if(!user){window.location.href='../../login.html';return;}
    _currentUser=user;
    const isSA=user.email?.toLowerCase()===SUPER_ADMIN.toLowerCase();
    if(isSA){setText('profileName','Super Admin');setText('profileRole','Super Admin');}
    else{
      try{
        const snap=await getDocs(query(collection(db,'users'),where('email','==',user.email)));
        if(!snap.empty){
          const d=snap.docs[0].data();
          setText('profileName',d.name?.trim()||user.email);
          const rm={super_admin:'Super Admin',admin:'Admin',editor:'Editor',viewer:'User'};
          setText('profileRole',rm[d.role]||'User');
        }else{setText('profileName',user.email);setText('profileRole','User');}
      }catch(e){setText('profileName',user.email);}
    }
    await loadProfileFromFirestore();
    initSharedUI();
    await onReady(user,isSA);
  });
}
function renderStats() {
  const o = DB.orders, n = o.length;
  const totalQty   = o.reduce((s,x) => s + (x.quantity||1), 0);
  const investment = o.reduce((s,x) => s + ((x.actual_price||0)*(x.quantity||1)) + (x.shipping||0), 0);
  const avgBuy     = totalQty > 0 ? Math.round(investment / totalQty) : 0;
  const pendingAmt = o.reduce((s,x) => s + (x.pending||0), 0);
  const pendingPO  = o.filter(x => x.status==='Ordered'||x.status==='In Transit').length;
  const delivered  = o.filter(x => x.status==='Delivered').length;
  const transit    = o.filter(x => x.status==='In Transit').length;
  const overdue    = o.filter(x => x.eta && new Date(x.eta)<new Date() && x.status!=='Delivered' && x.status!=='Cancelled').length;
  const bm = {}; o.forEach(x => { const k=(x.brand||x.vendor||'—').trim(); bm[k]=(bm[k]||0)+(x.quantity||1); });
  const topBrand = Object.entries(bm).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';

  setText('statTotal',      n);
  setText('statQty',        totalQty);
  setText('statAvgBuy',     avgBuy > 0 ? '₹'+avgBuy.toLocaleString('en-IN') : '₹0');
  setText('statInvestment', '₹'+investment.toLocaleString('en-IN'));
  setText('statPending',    '₹'+pendingAmt.toLocaleString('en-IN'));
  setText('statPendingPO',  pendingPO);
  setText('statDelivered',  delivered);
  setText('statTransit',    transit);
  setText('statOverdue',    overdue);
  setText('statTopBrand',   topBrand);

  const pct = x => n > 0 ? Math.min(100, Math.round((x/n)*100)) : 0;
  const sb  = (id,v) => { const el=document.getElementById(id); if(el) el.style.width=v+'%'; };
  sb('statDeliveredBar', pct(delivered));
  sb('statTransitBar',   pct(transit));
  sb('statPendingPOBar', pct(pendingPO));
  sb('statOverdueBar',   pct(overdue));
  sb('statPendingBar',   investment > 0 ? Math.min(100, Math.round((pendingAmt/investment)*100)) : 0);

  const sellerCount = new Set(DB.orders.map(o => (o.vendor||'Unknown').trim())).size;
  setText('statSellers', sellerCount);
}

/* ══════════════════════════════════════ FILTERS ══════════════════════════════════════ */
function applyCollectionFilters() {
  const q      = (document.getElementById('invSearch')?.value      || '').toLowerCase();
  const brand  = document.getElementById('invFilterBrand')?.value  || '';
  const status = document.getElementById('invFilterStatus')?.value || '';
  const scale  = document.getElementById('invFilterScale')?.value  || '';
  const sort   = document.getElementById('invSort')?.value         || 'newest';

  let items = DB.orders.filter(o => {
    const b = o.brand || o.vendor || '';
    return (!q      || (o.product_name||'').toLowerCase().includes(q) || b.toLowerCase().includes(q) || (o.series||'').toLowerCase().includes(q))
        && (!brand  || b === brand)
        && (!status || o.status === status)
        && (!scale  || o.scale  === scale);
  });

  if (sort === 'name-az')  items.sort((a,b) => (a.product_name||'').localeCompare(b.product_name||''));
  if (sort === 'name-za')  items.sort((a,b) => (b.product_name||'').localeCompare(a.product_name||''));
  if (sort === 'price-hi') items.sort((a,b) => (b.actual_price||0) - (a.actual_price||0));
  if (sort === 'price-lo') items.sort((a,b) => (a.actual_price||0) - (b.actual_price||0));

  renderTable(items);
}

function populateBrandFilter() {
  const bf = document.getElementById('invFilterBrand'); if (!bf) return;
  const cur    = bf.value;
  const brands = [...new Set(DB.orders.map(o => o.brand || o.vendor).filter(Boolean))].sort();
  bf.innerHTML = `<option value="">All Brands</option>` + brands.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');
  bf.value = cur;
}

/* ══════════════════════════════════════ TABLE ══════════════════════════════════════ */
function renderTable(orders) {
  const tbody    = document.getElementById('ordersTableBody');
  const gridView = document.getElementById('colGridView');
  const countEl  = document.getElementById('colCount');

  if (countEl) countEl.textContent = (orders?.length||0) + ' model' + ((orders?.length||0)===1?'':'s');

  const empty = '<div class="empty-state"><i class="fa-solid fa-inbox"></i> No items found</div>';

  if (!orders?.length) {
    if (gridView) gridView.innerHTML = empty;
    if (tbody)    tbody.innerHTML    = '<tr><td colspan="8" class="empty-row"><i class="fa-solid fa-inbox"></i> No items found</td></tr>';
    return;
  }

  const fmt   = function(v) { return '\u20b9' + Number(v||0).toLocaleString('en-IN'); };
  const today = new Date(); today.setHours(0,0,0,0);

  // ── CARD GRID ──
  if (gridView) {
    gridView.innerHTML = orders.map(function(o) {
      const sc    = (o.status||'').toLowerCase().replace(/\s+/g,'-');
      const thumb = o.image
        ? '<img src="' + escHtml(o.image) + '" alt="' + escHtml(o.product_name) + '" />'
        : '<i class="fa-solid fa-car-side"></i>';
      const isPaid    = (o.pending||0) <= 0;
      const isPartial = !isPaid && (o.paid||0) > 0;

      let etaHtml = '';
      if (o.eta) {
        const d = Math.ceil((new Date(o.eta) - today) / (1000*60*60*24));
        var etaCls = '', etaLbl = '';
        if (o.status==='Delivered')  { etaCls='';        etaLbl='Delivered'; }
        else if (d < 0)              { etaCls='overdue'; etaLbl=Math.abs(d)+'d overdue'; }
        else if (d === 0)            { etaCls='soon';    etaLbl='Today!'; }
        else if (d <= 7)             { etaCls='soon';    etaLbl='in '+d+'d'; }
        else                         { etaCls='';        etaLbl=formatDate(o.eta); }
        etaHtml = '<div class="col-card-eta ' + etaCls + '"><i class="fa-solid fa-calendar-days"></i> ' + etaLbl + '</div>';
      }

      const pendingLabel = isPaid ? '\u2713 Paid' : (fmt(o.pending||0) + ' due');

      return '<div class="col-card" onclick="viewOrder(\'' + o.id + '\')">'
        + '<div class="col-card-img">' + thumb
          + '<span class="col-card-badge"><span class="badge badge-' + sc + '" style="font-size:.58rem">' + escHtml(o.status||'Ordered') + '</span></span>'
          + '<div class="col-card-actions" onclick="event.stopPropagation()">'
            + '<button class="col-card-action-btn edit" onclick="editOrder(\'' + o.id + '\')" title="Edit"><i class="fa-solid fa-pen"></i></button>'
            + '<button class="col-card-action-btn del" onclick="deleteOrder(\'' + o.id + '\')" title="Delete"><i class="fa-solid fa-trash"></i></button>'
          + '</div>'
        + '</div>'
        + '<div class="col-card-body">'
          + '<div class="col-card-name">' + escHtml(o.product_name) + '</div>'
          + '<div class="col-card-meta">'
            + '<span>' + escHtml(o.brand||o.vendor||'—') + '</span>'
            + '<span class="col-card-meta-dot"></span>'
            + '<span>' + escHtml(o.scale||'1:64') + '</span>'
            + (o.variant ? '<span class="col-card-meta-dot"></span><span>' + escHtml(o.variant) + '</span>' : '')
          + '</div>'
          + etaHtml
          + '<div class="col-card-footer">'
            + '<span class="col-card-price">' + fmt(o.total||0) + '</span>'
            + '<span class="col-card-pending ' + (isPaid?'paid':'due') + '">' + pendingLabel + '</span>'
          + '</div>'
        + '</div>'
      + '</div>';
    }).join('');
  }

  // ── LIST TABLE ──
  if (tbody) {
    tbody.innerHTML = orders.map(function(o) {
      const sc    = (o.status||'').toLowerCase().replace(/\s+/g,'-');
      const thumb = o.image
        ? '<img src="' + escHtml(o.image) + '" alt="' + escHtml(o.product_name) + '" />'
        : '<i class="fa-solid fa-car-side"></i>';
      const pb = (o.pending||0)<=0 ? 'badge-paid' : ((o.paid||0)>0 ? 'badge-partial' : 'badge-pending-b');
      const pl = (o.pending||0)<=0 ? 'Paid'       : ((o.paid||0)>0 ? 'Partial'       : 'Pending');
      return '<tr>'
        + '<td><div class="order-product-cell"><div class="order-thumb">' + thumb + '</div>'
          + '<div style="min-width:0"><div class="order-product-name">' + escHtml(o.product_name) + '</div>'
          + '<div style="font-size:.7rem;opacity:.6;white-space:nowrap">' + escHtml(o.scale||'1:64')
          + (o.variant ? '<span class="variant-tag">' + escHtml(o.variant) + '</span>' : '')
          + '</div></div></div></td>'
        + '<td style="white-space:nowrap">' + escHtml(o.brand||o.vendor||'—') + '</td>'
        + '<td><span class="badge badge-' + sc + '">' + escHtml(o.status||'Ordered') + '</span></td>'
        + '<td style="text-align:center">' + (o.quantity||1) + '</td>'
        + '<td style="white-space:nowrap"><strong>' + fmt(o.total||0) + '</strong></td>'
        + '<td><span class="badge ' + pb + '" style="font-size:.68rem">' + pl + '</span></td>'
        + '<td style="font-size:.76rem;color:var(--text-muted);white-space:nowrap">' + (o.eta ? formatDate(o.eta) : '—') + '</td>'
        + '<td><div class="table-actions">'
          + '<button class="btn btn-ghost btn-icon" onclick="viewOrder(\'' + o.id + '\')" title="View"><i class="fa-solid fa-eye"></i></button>'
          + '<button class="btn btn-ghost btn-icon" onclick="editOrder(\'' + o.id + '\')" title="Edit"><i class="fa-solid fa-pen"></i></button>'
          + '<button class="btn btn-ghost btn-icon" onclick="duplicateOrder(\'' + o.id + '\')" title="Duplicate"><i class="fa-solid fa-copy"></i></button>'
          + '<button class="btn btn-danger btn-icon" onclick="deleteOrder(\'' + o.id + '\')" title="Delete"><i class="fa-solid fa-trash"></i></button>'
        + '</div></td>'
      + '</tr>';
    }).join('');
  }
}
function initCollectionViewToggle() {
  const btnGrid = document.getElementById('viewBtnGrid');
  const btnList = document.getElementById('viewBtnList');
  const gridV   = document.getElementById('colGridView');
  const listV   = document.getElementById('colListView');
  if (!btnGrid || !btnList) return;
  btnGrid.addEventListener('click', function() {
    btnGrid.classList.add('active'); btnList.classList.remove('active');
    gridV.style.display = ''; listV.style.display = 'none';
  });
  btnList.addEventListener('click', function() {
    btnList.classList.add('active'); btnGrid.classList.remove('active');
    listV.style.display = ''; gridV.style.display = 'none';
  });
}
/* ══════════════════════════════════════ WIDGETS ══════════════════════════════════════ */
/* ══════════════════════════════════════ THIS WEEK'S ARRIVALS ══════════════════════════════════════ */
function renderWeekArrivals() {
  const scrollEl = document.getElementById('insightScroll');
  const subEl    = document.getElementById('insightSub');
  if (!scrollEl) return;
  const fmt  = v => '\u20b9' + Number(v||0).toLocaleString('en-IN');
  const allO = DB.orders;
  if (!allO.length) {
    scrollEl.innerHTML = '<div style="color:var(--text-muted);font-size:.8rem;padding:.5rem 0">Add orders to see insights</div>';
    if (subEl) subEl.textContent = 'No data yet';
    return;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const in7   = new Date(today); in7.setDate(today.getDate()+7);

  const sellerMap = {};
  allO.forEach(o=>{ const s=o.vendor||'Unknown'; sellerMap[s]=(sellerMap[s]||0)+(o.total||0); });
  const topSeller = Object.entries(sellerMap).sort((a,b)=>b[1]-a[1])[0];

  const delivered = allO.filter(o=>o.status==='Delivered'&&o.order_date&&o.eta);
  const avgDays   = delivered.length ? Math.round(delivered.reduce((s,o)=>{
    const d1=new Date(o.order_date),d2=new Date(o.eta);
    return s+Math.max(0,Math.ceil((d2-d1)/(1000*60*60*24)));
  },0)/delivered.length) : null;

  const brandAvg={},brandCnt={};
  allO.forEach(o=>{const b=o.brand||'Unknown';const u=(o.actual_price>0?o.actual_price:o.preorder_price)||0;if(!u)return;brandAvg[b]=(brandAvg[b]||0)+u;brandCnt[b]=(brandCnt[b]||0)+1;});
  const bestValBrand = Object.entries(brandAvg).filter(([b])=>brandCnt[b]>=2).map(([b,t])=>([b,Math.round(t/brandCnt[b])])).sort((a,b)=>a[1]-b[1])[0];

  const biggest      = allO.reduce((mx,o)=>(o.total||0)>(mx.total||0)?o:mx,allO[0]);
  const totalInvested= allO.reduce((s,o)=>s+(o.total||0),0);
  const totalPaid    = allO.reduce((s,o)=>s+(o.paid||0),0);
  const payHealth    = totalInvested>0?Math.round((totalPaid/totalInvested)*100):0;

  const carWords={};
  allO.forEach(o=>{const name=(o.product_name||'').toUpperCase();['PORSCHE','BMW','NISSAN','FERRARI','LAMBORGHINI','MCLAREN','TOYOTA','MAZDA','HONDA','FORD','AUDI','SUPRA','RX7','GTR','GT3'].forEach(w=>{if(name.includes(w))carWords[w]=(carWords[w]||0)+1;});});
  const topCar = Object.entries(carWords).sort((a,b)=>b[1]-a[1])[0];

  const overdueOrders = allO.filter(o=>{if(!o.eta||o.status==='Delivered'||o.status==='Cancelled')return false;const d=new Date(o.eta);d.setHours(0,0,0,0);return d<today;}).sort((a,b)=>new Date(a.eta)-new Date(b.eta));

  const scaleMap={};
  allO.forEach(o=>{const s=o.scale||'1:64';scaleMap[s]=(scaleMap[s]||0)+1;});
  const topScale = Object.entries(scaleMap).sort((a,b)=>b[1]-a[1])[0];

  const arrivals = allO.filter(o=>{if(!o.eta||o.status==='Delivered'||o.status==='Cancelled')return false;const d=new Date(o.eta);d.setHours(0,0,0,0);return d>=today&&d<=in7;}).sort((a,b)=>new Date(a.eta)-new Date(b.eta));

  const cards=[];
  if(topSeller){const pct=Math.min(100,Math.round((topSeller[1]/totalInvested)*100));cards.push({color:'#7c5cfc',icon:'fa-store',label:'Top Seller',val:topSeller[0],sub:fmt(topSeller[1])+' spent \xb7 '+pct+'% of total',bar:pct,barColor:'#7c5cfc'});}
  if(avgDays!==null){const r=avgDays<=14?'Fast \ud83d\udfe2':avgDays<=30?'Avg \ud83d\udfe1':'Slow \ud83d\udd34';cards.push({color:'#0284c7',icon:'fa-clock',label:'Avg Delivery',val:avgDays+'d',sub:'From '+delivered.length+' orders \xb7 '+r,bar:Math.min(100,Math.round((avgDays/60)*100)),barColor:'#0284c7'});}
  if(bestValBrand)cards.push({color:'#16a34a',icon:'fa-tag',label:'Best Value',val:bestValBrand[0],sub:'Avg '+fmt(bestValBrand[1])+' per model',bar:null});
  cards.push({color:payHealth>=80?'#16a34a':payHealth>=50?'#f97316':'#ef4444',icon:'fa-heart-pulse',label:'Pay Health',val:payHealth+'%',sub:fmt(totalPaid)+' paid of '+fmt(totalInvested),bar:payHealth,barColor:payHealth>=80?'#16a34a':payHealth>=50?'#f97316':'#ef4444'});
  if(biggest)cards.push({color:'#ec4899',icon:'fa-trophy',label:'Biggest Order',val:fmt(biggest.total||0),sub:(biggest.product_name||'').substring(0,26)+((biggest.product_name||'').length>26?'\u2026':''),bar:null});
  if(topCar)cards.push({color:'#f97316',icon:'fa-car-side',label:'Fav Car',val:topCar[0],sub:topCar[1]+' models',bar:null});
  if(topScale){const p=Math.min(100,Math.round((topScale[1]/allO.length)*100));cards.push({color:'#6d28d9',icon:'fa-ruler',label:'Fav Scale',val:topScale[0],sub:topScale[1]+' models \xb7 '+p+'%',bar:p,barColor:'#6d28d9'});}
  if(overdueOrders.length){const days=Math.abs(Math.ceil((new Date(overdueOrders[0].eta)-today)/(1000*60*60*24)));cards.push({color:'#ef4444',icon:'fa-triangle-exclamation',label:'Overdue',val:overdueOrders.length+' late',sub:'Oldest: '+days+'d \xb7 '+(overdueOrders[0].vendor||'').substring(0,16),bar:null});}
  if(arrivals.length){cards.push({color:'#7c5cfc',icon:'fa-truck-fast',label:'This Week',val:arrivals.length+' arriving',sub:arrivals.slice(0,2).map(o=>(o.product_name||'').substring(0,18)).join(', '),bar:null});}

  scrollEl.innerHTML = cards.map(card=>
    '<div class="insight-card" style="border-top-color:'+card.color+'">'
      +'<div style="display:flex;align-items:center;gap:.5rem">'
        +'<div class="insight-card-icon" style="background:'+card.color+'22;color:'+card.color+'"><i class="fa-solid '+card.icon+'"></i></div>'
        +'<span class="insight-card-label">'+card.label+'</span>'
      +'</div>'
      +'<div class="insight-card-val'+(String(card.val).length>9?' sm':'')+'">'+card.val+'</div>'
      +'<div class="insight-card-sub">'+card.sub+'</div>'
      +(card.bar!=null?'<div class="insight-card-bar-wrap"><div class="insight-card-bar" style="width:'+card.bar+'%;background:'+card.barColor+'"></div></div>':'')
    +'</div>'
  ).join('');
  if(subEl) subEl.textContent = cards.length+' insights from '+allO.length+' models';
}

function renderRecentOrders() {
  const c = document.getElementById('recentOrdersList'); if (!c) return;
  const items = DB.orders.slice(0,10);
  if (!items.length) { c.innerHTML=`<div class="empty-state">No orders yet</div>`; return; }
  c.innerHTML = items.map(o => `
    <div class="recent-order-item">
      <div class="roi-thumb">${o.image?`<img src="${o.image}" alt="${escHtml(o.product_name)}" />`:`<i class="fa-solid fa-cube"></i>`}</div>
      <div class="roi-info">
        <div class="roi-name">${escHtml(o.product_name)}</div>
        <div class="roi-meta">${escHtml(o.brand||o.vendor||'—')} • ${escHtml(o.scale||'1:64')}</div>
      </div>
      <div class="roi-status"><span class="badge badge-${(o.status||'').toLowerCase().replace(/\s+/g,'-')}">${escHtml(o.status||'Ordered')}</span></div>
    </div>`).join('');
}

function renderEtaWidget() {
  const c = document.getElementById('etaList'); if (!c) return;
  const upcoming = DB.orders.filter(o=>o.eta&&o.status!=='Delivered'&&o.status!=='Owned').sort((a,b)=>new Date(a.eta)-new Date(b.eta)).slice(0,6);
  if (!upcoming.length) { c.innerHTML=`<div class="empty-state">No upcoming deliveries</div>`; return; }
  const today = new Date();
  c.innerHTML = upcoming.map(o => {
    const d  = Math.ceil((new Date(o.eta)-today)/(1000*60*60*24));
    let dc = 'eta-chip-ok', dl = `${d}d`;
    if (d < 0) { dc='eta-chip-overdue'; dl=`${Math.abs(d)}d overdue`; } else if (d <= 7) dc='eta-chip-soon';
    return `<div class="delivery-item">
      <div class="delivery-icon"><i class="fa-solid fa-truck"></i></div>
      <div class="delivery-info">
        <div class="delivery-name">${escHtml(o.product_name)}</div>
        <div class="delivery-meta">${escHtml(o.brand||o.vendor||'—')} • ETA ${escHtml(o.eta)}</div>
        <div class="delivery-chips">
          <span class="delivery-chip eta-chip ${dc}"><i class="fa-solid fa-calendar-days"></i> ${dl}</span>
          <span class="delivery-chip vendor-chip"><i class="fa-solid fa-store"></i> ${escHtml(o.brand||o.vendor||'—')}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderActivityFeed() {
  const c = document.getElementById('activityList'); if (!c) return;
  const items = DB.activity.slice(0,12);
  if (!items.length) { c.innerHTML=`<div class="empty-state">No recent activity</div>`; return; }
  c.innerHTML = items.map(a => `
    <div class="activity-item">
      <span class="activity-dot ${escHtml(a.type||'info')}"></span>
      <span>${escHtml(a.msg||'')}</span>
      <span class="activity-time">${escHtml(a.time||'')}</span>
    </div>`).join('');
}

function renderBrandLeaderboard() {
  const c = document.getElementById('leaderboardList'); if (!c) return;
  if (!DB.orders.length) { c.innerHTML=`<div class="empty-state">No data yet</div>`; return; }
  const bm = {};
  DB.orders.forEach(o => { const k=(o.brand||o.vendor||'Unknown').trim(); bm[k]=(bm[k]||0)+(o.quantity||1); });
  const sorted = Object.entries(bm).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const ri = i => i===0?`<div class="lb-rank-icon gold"><i class="fa-solid fa-crown"></i></div>`
                : i===1?`<div class="lb-rank-icon silver"><i class="fa-solid fa-medal"></i></div>`
                : i===2?`<div class="lb-rank-icon bronze"><i class="fa-solid fa-award"></i></div>`
                :        `<div class="lb-rank-icon"><i class="fa-solid fa-hashtag"></i></div>`;
  c.innerHTML = sorted.map(([brand,qty],i) => `
    <div class="lb-item">${ri(i)}
      <div class="lb-info"><div class="lb-name">#${i+1} ${escHtml(brand)}</div><div class="lb-sub">${qty} unit${qty!==1?'s':''} tracked</div></div>
      <span class="lb-count">${qty}</span>
    </div>`).join('');
}

function renderAlerts() {
  const c = document.getElementById('alertsPanel'); if (!c) return;
  const alerts  = [];
  const delayed = DB.orders.filter(o=>o.eta&&new Date(o.eta)<new Date()&&o.status!=='Delivered'&&o.status!=='Owned');
  const unpaid  = DB.orders.filter(o=>(o.pending||0)>0);
  if (delayed.length) alerts.push({ type:'warning', msg:`${delayed.length} delayed order(s)` });
  if (unpaid.length)  alerts.push({ type:'danger',  msg:`${unpaid.length} order(s) with pending payment` });
  if (!alerts.length) alerts.push({ type:'info',    msg:'All systems normal' });
  c.innerHTML = alerts.map(a => `<div class="alert-item ${a.type}"><i class="fa-solid fa-circle-info"></i><span>${escHtml(a.msg)}</span></div>`).join('');
}

function renderPayments() {
function renderPayments() {
  const c = document.getElementById('paymentsContent'); if (!c) return;
  if (!DB.orders.length) {
    c.innerHTML = `<div class="widget glass full-width"><div class="widget-body"><div class="empty-state">No payment data yet</div></div></div>`;
    return;
  }
  const fmt          = v => `₹${v.toLocaleString('en-IN')}`;
  const totalSpent   = DB.orders.reduce((s,o)=>s+(o.total  ||0),0);
  const totalPaid    = DB.orders.reduce((s,o)=>s+(o.paid   ||0),0);
  const totalPending = DB.orders.reduce((s,o)=>s+(o.pending||0),0);

  const rows = DB.orders.map(o => {
    const sc = (o.status||'').toLowerCase().replace(/\s+/g,'-');
    const pb = (o.pending||0)<=0 ? 'badge-paid' : ((o.paid||0)>0 ? 'badge-partial' : 'badge-pending-b');
    const pl = (o.pending||0)<=0 ? 'Paid'       : ((o.paid||0)>0 ? 'Partial'       : 'Pending');
    return `<tr>
      <td>
        <div style="font-weight:600;font-size:.85rem">${escHtml(o.product_name||'—')}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">${escHtml(o.brand||o.vendor||'—')} · ${escHtml(o.scale||'1:64')}</div>
      </td>
      <td>${fmt(o.total||0)}</td>
      <td style="color:var(--green)">${fmt(o.paid||0)}</td>
      <td style="color:${(o.pending||0)>0?'var(--orange)':'var(--green)'}">${fmt(o.pending||0)}</td>
      <td><span class="badge ${pb}">${pl}</span></td>
      <td><span class="badge badge-${sc}">${escHtml(o.status||'Ordered')}</span></td>
      <td style="font-size:.76rem;color:var(--text-muted)">${o.eta?formatDate(o.eta):'—'}</td>
    </tr>`;
  }).join('');

  const mobCards = DB.orders.map(o => {
    const sc = (o.status||'').toLowerCase().replace(/\s+/g,'-');
    const pb = (o.pending||0)<=0 ? 'badge-paid' : ((o.paid||0)>0 ? 'badge-partial' : 'badge-pending-b');
    const pl = (o.pending||0)<=0 ? 'Paid'       : ((o.paid||0)>0 ? 'Partial'       : 'Pending');
    return `<div class="pay-mob-card glass">
      <div class="pay-mob-top">
        <div class="pay-mob-name">${escHtml(o.product_name||'—')}</div>
        <span class="badge badge-${sc}">${escHtml(o.status||'Ordered')}</span>
      </div>
      <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.65rem">${escHtml(o.brand||o.vendor||'—')} · ${escHtml(o.scale||'1:64')}</div>
      <div class="pay-mob-stats">
        <div class="mob-stat"><span>Total</span><strong>${fmt(o.total||0)}</strong></div>
        <div class="mob-stat"><span>Paid</span><strong style="color:var(--green)">${fmt(o.paid||0)}</strong></div>
        <div class="mob-stat"><span>Pending</span><strong style="color:${(o.pending||0)>0?'var(--orange)':'var(--green)'}">${fmt(o.pending||0)}</strong></div>
        <div class="mob-stat"><span>Status</span><strong><span class="badge ${pb}" style="font-size:.68rem">${pl}</span></strong></div>
      </div>
      ${o.eta?`<div style="font-size:.72rem;color:var(--text-muted);margin-top:.4rem"><i class="fa-solid fa-calendar-days" style="color:var(--primary)"></i> ETA: ${formatDate(o.eta)}</div>`:''}
    </div>`;
  }).join('');

  c.innerHTML = `
    <div class="pay-summary-row">
      <div class="pay-sum-card glass">
        <div class="pay-sum-label"><i class="fa-solid fa-receipt"></i> Total Amount</div>
        <div class="pay-sum-val">${fmt(totalSpent)}</div>
      </div>
      <div class="pay-sum-card glass">
        <div class="pay-sum-label"><i class="fa-solid fa-circle-check" style="color:var(--green)"></i> Total Paid</div>
        <div class="pay-sum-val" style="color:var(--green)">${fmt(totalPaid)}</div>
      </div>
      <div class="pay-sum-card glass">
        <div class="pay-sum-label"><i class="fa-solid fa-hourglass-half" style="color:var(--orange)"></i> Total Pending</div>
        <div class="pay-sum-val" style="color:${totalPending>0?'var(--orange)':'var(--green)'}">${fmt(totalPending)}</div>
      </div>
    </div>
    <div class="widget glass full-width">
      <div class="widget-header"><h3><i class="fa-solid fa-credit-card"></i> Payment Overview</h3></div>
      <div class="table-wrap desktop-only" style="overflow-x:auto">
        <table class="orders-table">
          <thead><tr><th>Product</th><th>Total</th><th>Paid</th><th>Pending</th><th>Payment</th><th>Status</th><th>ETA</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="pay-mob-list mobile-only">${mobCards}</div>
    </div>`;
}

function renderCatalog() {
function renderCatalog() {
  const grid = document.getElementById('catalogGrid'); if (!grid) return;
  const o    = DB.orders;
  if (!o.length) { grid.innerHTML = '<div class="empty-state">No models tracked yet</div>'; return; }
  const fmt = v => '₹' + Number(v||0).toLocaleString('en-IN');
  grid.innerHTML = o.map(order => {
    const sc    = (order.status||'').toLowerCase().replace(/\s+/g,'-');
    const thumb = order.image
      ? `<img src="${escHtml(order.image)}" alt="${escHtml(order.product_name)}" />`
      : `<i class="fa-solid fa-car-side"></i>`;
    const variantTag = order.variant === 'Box'
      ? `<span style="background:#16a34a;color:#fff;padding:1px 7px;border-radius:999px;font-size:.6rem;font-weight:800">Box</span>`
      : order.variant === 'Blister'
      ? `<span style="background:#0284c7;color:#fff;padding:1px 7px;border-radius:999px;font-size:.6rem;font-weight:800">Blister</span>`
      : order.variant ? `<span class="variant-tag">${escHtml(order.variant)}</span>` : '';
    return `<div class="catalog-card cc-rich" onclick="viewOrder('${order.id}')">
      <div class="cc-img">${thumb}
        <span class="badge badge-${sc} cc-badge">${escHtml(order.status||'Ordered')}</span>
      </div>
      <div class="cc-body">
        <div class="cc-name">${escHtml(order.product_name||'—')}</div>
        <div class="cc-meta">
          <span>${escHtml(order.brand||order.vendor||'—')}</span>
          <span class="cc-dot">·</span>
          <span>${escHtml(order.scale||'1:64')}</span>
          ${variantTag}
        </div>
        <div class="cc-price">${fmt(order.total||0)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderAnalytics() {
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

function renderUpcoming() {
function renderUpcoming() {
  const grid = document.getElementById('upcomingGrid'); if (!grid) return;
  const items = DB.orders
    .filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled')
    .sort((a,b) => {
      const aE=a.eta?new Date(a.eta):null, bE=b.eta?new Date(b.eta):null, now=new Date();
      const aO=aE&&aE<now, bO=bE&&bE<now;
      if (aO&&!bO) return -1; if (!aO&&bO) return 1;
      if (aE&&bE) return aE-bE;
      if (aE&&!bE) return -1; if (!aE&&bE) return 1;
      return 0;
    });

  setText('upStatOrdered', items.filter(o=>o.status==='Ordered').length);
  setText('upStatTransit', items.filter(o=>o.status==='In Transit').length);
  setText('upStatOverdue', items.filter(o=>o.eta&&new Date(o.eta)<new Date()).length);
  setText('upStatPending', items.filter(o=>(o.pending||0)>0).length);

  const badge = document.getElementById('upcomingBadge');
  if (badge) { badge.textContent=items.length; badge.style.display=items.length>0?'inline-flex':'none'; }

  const activeTab = document.querySelector('.upcoming-tab.active')?.dataset.filter || 'all';
  let filtered = items;
  if (activeTab === 'overdue') filtered = items.filter(o => o.eta && new Date(o.eta) < new Date());
  else if (activeTab !== 'all') filtered = items.filter(o => o.status === activeTab);

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:3rem"><i class="fa-solid fa-truck-fast" style="font-size:2rem;opacity:.25"></i><p style="margin-top:.75rem">No upcoming deliveries</p></div>';
    return;
  }
  const fmt   = v => '₹' + Number(v||0).toLocaleString('en-IN');
  const today = new Date();
  grid.innerHTML = filtered.map(o => {
    const sc    = (o.status||'').toLowerCase().replace(/\s+/g,'-');
    const thumb = o.image ? `<img src="${o.image}" alt="${escHtml(o.product_name)}" />` : `<i class="fa-solid fa-car-side"></i>`;
    let etaChip = `<span class="upcoming-eta-chip eta-no-date"><i class="fa-solid fa-calendar"></i> No ETA</span>`;
    if (o.eta) {
      const d   = Math.ceil((new Date(o.eta)-today)/(1000*60*60*24));
      const cls = d < 0 ? 'eta-overdue' : d <= 7 ? 'eta-soon' : 'eta-ok';
      const lbl = d < 0 ? Math.abs(d)+'d overdue' : d === 0 ? 'Today!' : d+'d left';
      etaChip = `<span class="upcoming-eta-chip ${cls}"><i class="fa-solid fa-calendar-days"></i> ${lbl}</span>`;
    }
    const payChip    = (o.pending||0) > 0
      ? `<span class="upcoming-eta-chip eta-soon"><i class="fa-solid fa-hourglass-half"></i> ${fmt(o.pending)} due</span>`
      : `<span class="upcoming-eta-chip eta-ok"><i class="fa-solid fa-circle-check"></i> Paid</span>`;
    const vendorChip  = o.vendor  ? `<span class="upcoming-eta-chip eta-no-date"><i class="fa-solid fa-store"></i> ${escHtml(o.vendor)}</span>` : '';
    const variantChip = o.variant ? `<span class="upcoming-eta-chip" style="background:rgba(124,92,252,0.12);color:#7c5cfc"><i class="fa-solid fa-cube"></i> ${escHtml(o.variant)}</span>` : '';
    const etaFooter  = o.eta ? `<span>ETA: ${formatDate(o.eta)}</span>` : `<span style="opacity:.4">No ETA set</span>`;

    return `<div class="upcoming-card glass" onclick="viewOrder('${o.id}')">
      <div class="upcoming-card-top">
        <div class="upcoming-card-thumb">${thumb}</div>
        <div style="min-width:0;flex:1">
          <div class="upcoming-card-name">${escHtml(o.product_name)}</div>
          <div class="upcoming-card-brand">${escHtml(o.brand||o.vendor||'—')} · ${escHtml(o.scale||'1:64')}</div>
          <span class="badge badge-${sc}" style="margin-top:4px;display:inline-block;font-size:.65rem">${escHtml(o.status)}</span>
        </div>
      </div>
      <div class="upcoming-card-chips">${etaChip}${payChip}${variantChip}${vendorChip}</div>
      <div class="upcoming-card-footer">
        <span>Qty: <strong>${o.quantity||1}</strong></span>
        <span>Total: <strong>${fmt(o.total)}</strong></span>
        ${etaFooter}
      </div>
    </div>`;
  }).join('');
}
/* ══════════════════════════════════════ ETA CALENDAR ══════════════════════════════════════ */
function renderCalendar() {
function renderCalendar() {
  const wrap = document.getElementById('calendarWrap'); if (!wrap) return;
  if (!window._calState) {
    const n = new Date();
    window._calState = { year: n.getFullYear(), month: n.getMonth() };
  }
  const { year, month } = window._calState;
  const today    = new Date(); today.setHours(0,0,0,0);
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const monthLabel = firstDay.toLocaleDateString('en-IN', { month:'long', year:'numeric' });
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const fmt  = v => '\u20b9' + Number(v||0).toLocaleString('en-IN');

  // Build ETA map
  const etaMap = {};
  DB.orders.forEach(o => {
    if (!o.eta) return;
    const d = new Date(o.eta);
    const key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (!etaMap[key]) etaMap[key] = [];
    etaMap[key].push(o);
  });

  // Month stats
  const monthOrders = DB.orders.filter(o => {
    if (!o.eta) return false;
    const d = new Date(o.eta);
    return d.getFullYear()===year && d.getMonth()===month;
  });
  const mTotal     = monthOrders.length;
  const mOverdue   = monthOrders.filter(o => { const d=new Date(o.eta); return d<today && o.status!=='Delivered' && o.status!=='Cancelled'; }).length;
  const mDelivered = monthOrders.filter(o => o.status==='Delivered').length;
  const mValue     = monthOrders.reduce((s,o)=>s+(o.total||0),0);

  // Build stats strip
  let html = '<div class="cal-stats-strip">';
  html += '<div class="cal-stat-pill"><span class="cal-stat-pill-label">This Month</span><span class="cal-stat-pill-val purple">' + mTotal + '</span></div>';
  html += '<div class="cal-stat-pill"><span class="cal-stat-pill-label">Overdue</span><span class="cal-stat-pill-val red">' + mOverdue + '</span></div>';
  html += '<div class="cal-stat-pill"><span class="cal-stat-pill-label">Delivered</span><span class="cal-stat-pill-val green">' + mDelivered + '</span></div>';
  html += '<div class="cal-stat-pill"><span class="cal-stat-pill-label">Month Value</span><span class="cal-stat-pill-val" style="font-size:.82rem">' + fmt(mValue) + '</span></div>';
  html += '</div>';

  // Outer layout
  html += '<div class="cal-wrap-inner">';
  html += '<div>';

  // Header
  html += '<div class="cal-header">';
  html += '<div class="cal-nav-grp">';
  html += '<button class="btn btn-ghost btn-icon" id="calPrevBtn"><i class="fa-solid fa-chevron-left"></i></button>';
  html += '<button class="btn btn-ghost btn-icon" id="calNextBtn"><i class="fa-solid fa-chevron-right"></i></button>';
  html += '</div>';
  html += '<span class="cal-month-title">' + monthLabel + '</span>';
  html += '<div style="font-size:.7rem;color:var(--text-muted);font-weight:600">' + lastDay.getDate() + ' days</div>';
  html += '</div>';

  // DOW row
  html += '<div class="cal-grid">';
  dows.forEach(function(d) { html += '<div class="cal-dow">' + d + '</div>'; });

  // Empty offset cells
  for (let i = 0; i < startDow; i++) html += '<div class="cal-cell"></div>';

  // Day cells
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const key      = year + '-' + month + '-' + day;
    const orders   = etaMap[key] || [];
    const thisDate = new Date(year, month, day);
    const isToday  = thisDate.getTime() === today.getTime();
    const isPast   = thisDate < today && !isToday;
    const diff     = Math.ceil((thisDate - today) / (1000*60*60*24));

    let dots = '', hasOverdue=false, hasSoon=false, hasOk=false, hasDone=false, cellCls='';
    orders.forEach(function(o) {
      if (o.status==='Delivered'||o.status==='Cancelled') { hasDone=true; return; }
      if (diff < 0)     hasOverdue = true;
      else if (diff<=7) hasSoon    = true;
      else              hasOk      = true;
    });
    if (hasOverdue) { dots += '<span class="cal-dot dot-overdue"></span>'; cellCls='cal-overdue-cell'; }
    if (hasSoon)    { dots += '<span class="cal-dot dot-soon"></span>';    if(!cellCls) cellCls='cal-soon-cell'; }
    if (hasOk)      dots += '<span class="cal-dot dot-ok"></span>';
    if (hasDone)    dots += '<span class="cal-dot dot-done"></span>';

    let cls = 'cal-cell';
    if (isToday)             cls += ' cal-today';
    if (orders.length)       cls += ' cal-has-orders ' + cellCls;
    if (isPast&&!orders.length) cls += ' cal-past';

    html += '<div class="' + cls + '" id="calCell-' + key + '"' + (orders.length ? ' onclick="showCalOrders(\'' + key + '\')"' : '') + '>';
    html += '<span class="cal-day-num">' + day + '</span>';
    if (dots) html += '<div class="cal-dots">' + dots + '</div>';
    if (orders.length > 1) html += '<span class="cal-count">' + orders.length + '</span>';
    html += '</div>';
  }

  html += '</div>'; // close cal-grid

  // Legend
  html += '<div class="cal-legend">';
  html += '<span class="cal-legend-item"><span class="cal-dot dot-overdue"></span> Overdue</span>';
  html += '<span class="cal-legend-item"><span class="cal-dot dot-soon"></span> &le;7 days</span>';
  html += '<span class="cal-legend-item"><span class="cal-dot dot-ok"></span> Upcoming</span>';
  html += '<span class="cal-legend-item"><span class="cal-dot dot-done"></span> Delivered</span>';
  html += '</div>';

  html += '</div>'; // close left column

  // Side panel
  html += '<div class="cal-side-panel" id="calSidePanel">';
  html += '<div class="cal-side-empty" id="calSideEmpty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;color:var(--text-muted);font-size:.8rem;text-align:center;flex:1">';
  html += '<i class="fa-solid fa-calendar-days" style="font-size:2rem;opacity:.25"></i>';
  html += '<span>Click a day<br>to see orders</span>';
  html += '</div>';
  html += '<div id="calSideContent" style="display:none;flex:1;flex-direction:column">';
  html += '<div class="cal-side-title" style="display:flex;align-items:center;justify-content:space-between;font-size:.82rem;font-weight:800;margin-bottom:.85rem">';
  html += '<span id="calSideDateLabel"></span>';
  html += '<button id="calSideClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.85rem"><i class="fa-solid fa-xmark"></i></button>';
  html += '</div>';
  html += '<div class="cal-orders-panel" id="calOrdersPanel"></div>';
  html += '</div>';
  html += '</div>'; // close side panel

  html += '</div>'; // close cal-wrap-inner

  wrap.innerHTML = html;

  // Wire up nav buttons via addEventListener (safe after innerHTML)
  document.getElementById('calPrevBtn').addEventListener('click', function() {
    if (window._calState.month === 0) { window._calState.month = 11; window._calState.year--; }
    else { window._calState.month--; }
    renderCalendar();
  });
  document.getElementById('calNextBtn').addEventListener('click', function() {
    if (window._calState.month === 11) { window._calState.month = 0; window._calState.year++; }
    else { window._calState.month++; }
    renderCalendar();
  });
  document.getElementById('calSideClose').addEventListener('click', function() {
    document.getElementById('calSideContent').style.display = 'none';
    document.getElementById('calSideEmpty').style.display = 'flex';
    document.querySelectorAll('.cal-cell').forEach(function(c){ c.classList.remove('cal-selected'); });
  });
}
window.renderCalendar = renderCalendar;
window.closeCalSidePanel = function() {
  const c = document.getElementById('calSideContent');
  const e = document.getElementById('calSideEmpty');
  if (c) c.style.display = 'none';
  if (e) e.style.display = 'flex';
  document.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('cal-selected'));
};

window.showCalOrders = function(key) {
  const panel     = document.getElementById('calOrdersPanel');
  const content   = document.getElementById('calSideContent');
  const empty     = document.getElementById('calSideEmpty');
  const dateLabel = document.getElementById('calSideDateLabel');
  if (!panel) return;

  const [yr,mo,dy] = key.split('-').map(Number);
  const date  = new Date(yr, mo, dy);
  const today = new Date(); today.setHours(0,0,0,0);
  const fmt   = v => `₹${Number(v||0).toLocaleString('en-IN')}`;
  const orders = DB.orders.filter(o => {
    if (!o.eta) return false;
    const d = new Date(o.eta);
    return d.getFullYear()===yr && d.getMonth()===mo && d.getDate()===dy;
  });
  if (!orders.length) return;

  // Highlight selected cell
  document.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('cal-selected'));
  document.getElementById(`calCell-${key}`)?.classList.add('cal-selected');

  const dateStr = date.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  const diff    = Math.ceil((date - today) / (1000*60*60*24));

  dateLabel.innerHTML = `<span style="color:var(--text-primary)">${dateStr}</span>
    <span style="font-size:.68rem;color:var(--text-muted);font-weight:500;margin-left:.5rem">${orders.length} order${orders.length!==1?'s':''}</span>`;

  panel.innerHTML = orders.map(o => {
    const sc = (o.status||'').toLowerCase().replace(/\s+/g,'-');
    let etaCls='eta-ok', etaLbl=`${diff}d left`;
    if (o.status==='Delivered')  { etaCls='eta-ok';      etaLbl='Delivered'; }
    else if (diff<0)             { etaCls='eta-overdue';  etaLbl=`${Math.abs(diff)}d overdue`; }
    else if (diff===0)           { etaCls='eta-soon';     etaLbl='Today!'; }
    else if (diff<=7)            { etaCls='eta-soon';     etaLbl=`${diff}d left`; }
    return `
      <div class="cal-order-row" onclick="viewOrder('${o.id}')">
        <div class="cal-order-thumb">
          ${o.image?`<img src="${o.image}" alt="${escHtml(o.product_name)}" />`:`<i class="fa-solid fa-car-side"></i>`}
        </div>
        <div class="cal-order-info">
          <div class="cal-order-name">${escHtml(o.product_name)}</div>
          <div class="cal-order-sub">${escHtml(o.brand||o.vendor||'—')} · ${escHtml(o.scale||'1:64')}</div>
          <div class="cal-order-badges">
            <span class="badge badge-${sc}" style="font-size:.6rem">${escHtml(o.status||'Ordered')}</span>
            <span class="upcoming-eta-chip ${etaCls}" style="font-size:.6rem">${etaLbl}</span>
            <span style="font-size:.66rem;color:${o.pending>0?'#f97316':'#22c55e'};font-weight:700">${o.pending>0?fmt(o.pending)+' due':'Paid'}</span>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:.7rem;flex-shrink:0"></i>
      </div>`;
  }).join('');

  empty.style.display = 'none';
  content.style.display = 'block';
};

function renderSellers() {
function renderSellers() {
  const grid = document.getElementById('sellerGrid'); if (!grid) return;
  const map  = {};
  DB.orders.forEach(o => {
    const name = (o.vendor||'Unknown Seller').trim();
    if (!map[name]) map[name] = { name, orders:[], total:0, pending:0, paid:0 };
    map[name].orders.push(o);
    map[name].total   += ((o.actual_price||0)*(o.quantity||1))+(o.shipping||0);
    map[name].pending += (o.pending||0);
    map[name].paid    += (o.paid||0);
  });
  const sellers = Object.values(map).sort((a,b) => b.total-a.total);
  const fmt     = v => `₹${v.toLocaleString('en-IN')}`;

  setText('stCountAll',     sellers.length);
  setText('stCountPending', sellers.filter(s=>s.pending>0).length);
  setText('stCountPaid',    sellers.filter(s=>s.pending<=0).length);

  const activeFilter = document.querySelector('.sellers-tab.active')?.dataset.filter || 'all';
  const filtered     = activeFilter === 'pending' ? sellers.filter(s=>s.pending>0)
                     : activeFilter === 'paid'    ? sellers.filter(s=>s.pending<=0)
                     : sellers;

  if (!filtered.length) { grid.innerHTML=`<div class="empty-state">No sellers found</div>`; return; }
  grid.innerHTML = filtered.map(s => `
    <div class="seller-card" onclick="showSellerDetail('${escHtml(s.name)}')">
      <div class="seller-card-top">
        <div class="seller-avatar"><i class="fa-solid fa-store"></i></div>
        <div class="seller-info">
          <div class="seller-name">${escHtml(s.name)}</div>
          <div class="seller-meta">${s.orders.length} order${s.orders.length!==1?'s':''}</div>
        </div>
        <span class="seller-dot ${s.pending>0?'dot-due':'dot-clear'}"></span>
      </div>
      <div class="seller-stats">
        <div class="seller-stat"><span class="seller-stat-label">Total Spend</span><span class="seller-stat-val">${fmt(s.total)}</span></div>
        <div class="seller-stat"><span class="seller-stat-label">Paid</span><span class="seller-stat-val" style="color:#22c55e">${fmt(s.paid)}</span></div>
        <div class="seller-stat"><span class="seller-stat-label">Pending</span><span class="seller-stat-val" style="color:${s.pending>0?'var(--pink)':'#22c55e'}">${fmt(s.pending)}</span></div>
      </div>
      <div class="seller-models">
        ${s.orders.slice(0,4).map(o=>`<span class="seller-chip">${escHtml(o.product_name)}</span>`).join('')}
        ${s.orders.length>4?`<span class="seller-chip seller-chip-more">+${s.orders.length-4} more</span>`:''}
      </div>
    </div>`).join('');
}

/* ══════════════════════════════════════ SELLER DETAIL ══════════════════════════════════════ */
window.showSellerDetail = function(sellerName) {
  const grid       = document.getElementById('sellerGrid');
  const detailWrap = document.getElementById('sellerDetailWrap');
  const titleEl    = document.getElementById('sellerDetailTitle');
  const metaEl     = document.getElementById('sellerDetailMeta');
  const modelsGrid = document.getElementById('sellerModelsGrid');
  if (!grid || !detailWrap) return;

  const orders = DB.orders.filter(o => (o.vendor||'Unknown Seller').trim() === sellerName);
  const fmt    = v => `₹${Number(v||0).toLocaleString('en-IN')}`;
  const totalValue = orders.reduce((s,o)=>s+(o.total||0),0);
  const totalPaid  = orders.reduce((s,o)=>s+(o.paid||0),0);
  const totalPend  = orders.reduce((s,o)=>s+(o.pending||0),0);
  const delivered  = orders.filter(o=>o.status==='Delivered').length;
  const totalUnits = orders.reduce((s,o)=>s+(o.quantity||1),0);

  grid.style.display = 'none';
  document.getElementById('sellerDetailWrap').classList.add('visible');

  titleEl.textContent = sellerName;
  metaEl.innerHTML = `
    <span>${orders.length} order${orders.length!==1?'s':''}</span>
    <span>·</span><span>${totalUnits} unit${totalUnits!==1?'s':''}</span>
    <span>·</span><span>${fmt(totalValue)} total</span>
    <span>·</span><span style="color:#22c55e">${fmt(totalPaid)} paid</span>
    ${totalPend>0?`<span>·</span><span style="color:var(--pink)">${fmt(totalPend)} due</span>`:''}
    <span>·</span><span>${delivered} delivered</span>`;

  modelsGrid.innerHTML = orders.length ? orders.map(o => {
    const sc = (o.status||'').toLowerCase().replace(/\s+/g,'-');
    return `<div class="brand-model-card glass" onclick="viewOrder('${o.id}')">
      <div class="brand-model-img">
        ${o.image?`<img src="${o.image}" alt="${escHtml(o.product_name)}" />`:`<i class="fa-solid fa-car-side"></i>`}
        <span class="badge badge-${sc} brand-model-badge">${escHtml(o.status||'Ordered')}</span>
      </div>
      <div class="brand-model-info">
        <div class="brand-model-name">${escHtml(o.product_name)}</div>
        <div class="brand-model-meta">${escHtml(o.scale||'1:64')}${o.variant?` · ${escHtml(o.variant)}`:''}</div>
        <div class="brand-model-price">${fmt(o.total||0)}</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state">No orders for this seller</div>`;

  document.getElementById('sellerBackBtn').onclick = function() {
    detailWrap.classList.remove('visible');
    grid.style.display = '';
  };
};

/* ══════════════════════════════════════ BRANDS ══════════════════════════════════════ */
function renderBrands() {
function renderBrands() {
  const grid = document.getElementById('brandsGrid'); if (!grid) return;

  const brandColors = ['#7c5cfc','#14b8a6','#f97316','#22c55e','#6366f1','#e8458f','#0ea5e9','#a855f7','#eab308','#ef4444'];
  const brandMap = {};

  DB.orders.forEach(o => {
    const b = (o.brand || o.vendor || 'Unknown').trim();
    if (!brandMap[b]) brandMap[b] = { name:b, orders:[], total:0, paid:0, pending:0, delivered:0 };
    brandMap[b].orders.push(o);
    brandMap[b].total    += o.total   || 0;
    brandMap[b].paid     += o.paid    || 0;
    brandMap[b].pending  += o.pending || 0;
    if (o.status === 'Delivered') brandMap[b].delivered++;
  });

  const sort = document.getElementById('brandsSortSelect')?.value || 'count';
  let brands = Object.values(brandMap);
  if      (sort === 'count') brands.sort((a,b) => b.orders.length - a.orders.length);
  else if (sort === 'value') brands.sort((a,b) => b.total - a.total);
  else                       brands.sort((a,b) => a.name.localeCompare(b.name));

  if (!brands.length) { grid.innerHTML = `<div class="empty-state">No brands yet</div>`; return; }

  const fmt = v => `₹${Number(v||0).toLocaleString('en-IN')}`;

  grid.innerHTML = brands.map((b, i) => {
    const color    = brandColors[i % brandColors.length];
    const initial  = b.name.charAt(0).toUpperCase();
    const imgOrder = b.orders.find(o => o.image);
    const pct      = b.orders.length > 0 ? Math.min(100, Math.round((b.delivered / b.orders.length) * 100)) : 0;
    const totalQty = b.orders.reduce((s,o) => s+(o.quantity||1), 0);

    return `<div class="brand-card glass" onclick="showBrandDetail('${escHtml(b.name)}')">
      <div class="brand-card-top">
        <div class="brand-initial" style="background:${color}18;color:${color};border:1.5px solid ${color}35">
          ${imgOrder ? `<img src="${imgOrder.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : initial}
        </div>
        <div style="flex:1;min-width:0">
          <div class="brand-card-name">${escHtml(b.name)}</div>
          <div class="brand-card-count">${b.orders.length} model${b.orders.length!==1?'s':''} · ${totalQty} unit${totalQty!==1?'s':''}</div>
        </div>
        <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:.72rem;flex-shrink:0"></i>
      </div>

      <div class="brand-card-stats">
        <div class="brand-stat"><span>Value</span><strong>${fmt(b.total)}</strong></div>
        <div class="brand-stat"><span>Paid</span><strong style="color:var(--green,#22c55e)">${fmt(b.paid)}</strong></div>
        <div class="brand-stat"><span>Due</span><strong style="color:${b.pending>0?'var(--orange,#f97316)':'var(--green,#22c55e)'}">${fmt(b.pending)}</strong></div>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;font-size:.62rem;color:var(--text-muted);margin-bottom:.25rem">
          <span>Delivered</span><span>${pct}%</span>
        </div>
        <div class="brand-bar-track">
          <div class="brand-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    </div>`;
  }).join('');

  // hide detail panel when re-rendering
  document.getElementById('brandDetailWrap')?.classList.add('hidden');
}

window.showBrandDetail = function(brandName) {
  const grid       = document.getElementById('brandsGrid');
  const detailWrap = document.getElementById('brandDetailWrap');
  const titleEl    = document.getElementById('brandDetailTitle');
  const metaEl     = document.getElementById('brandDetailMeta');
  const modelsGrid = document.getElementById('brandModelsGrid');
  if (!grid || !detailWrap) return;

  const orders = DB.orders.filter(o => (o.brand||o.vendor||'Unknown').trim() === brandName);
  const fmt    = v => `₹${Number(v||0).toLocaleString('en-IN')}`;

  const totalValue  = orders.reduce((s,o) => s+(o.total||0), 0);
  const totalUnits  = orders.reduce((s,o) => s+(o.quantity||1), 0);
  const totalPaid   = orders.reduce((s,o) => s+(o.paid||0), 0);
  const totalPend   = orders.reduce((s,o) => s+(o.pending||0), 0);
  const delivered   = orders.filter(o => o.status==='Delivered').length;

  grid.style.display       = 'none';
  detailWrap.classList.remove('hidden');
  titleEl.textContent      = brandName;
  metaEl.innerHTML         = `
    <span>${orders.length} models</span> &nbsp;·&nbsp;
    <span>${totalUnits} units</span> &nbsp;·&nbsp;
    <span>${fmt(totalValue)} total</span> &nbsp;·&nbsp;
    <span style="color:var(--green,#22c55e)">${fmt(totalPaid)} paid</span>
    ${totalPend > 0 ? `&nbsp;·&nbsp;<span style="color:var(--orange,#f97316)">${fmt(totalPend)} due</span>` : ''}
    &nbsp;·&nbsp; <span>${delivered} delivered</span>`;

  modelsGrid.innerHTML = orders.length ? orders.map(o => {
    const sc = (o.status||'').toLowerCase().replace(/\s+/g,'-');
    return `<div class="brand-model-card glass" onclick="viewOrder('${o.id}')">
      <div class="brand-model-img">
        ${o.image ? `<img src="${o.image}" alt="${escHtml(o.product_name)}" />` : `<i class="fa-solid fa-car-side"></i>`}
        <span class="badge badge-${sc} brand-model-badge">${escHtml(o.status||'Ordered')}</span>
      </div>
      <div class="brand-model-info">
        <div class="brand-model-name">${escHtml(o.product_name)}</div>
        <div class="brand-model-meta">${escHtml(o.scale||'1:64')}${o.variant?` · ${escHtml(o.variant)}`:''}</div>
        <div class="brand-model-price">${fmt(o.total||0)}</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state">No models for this brand</div>`;
};

/* ══════════════════════════════════════ USERS ══════════════════════════════════════ */
function renderUsers() {
function renderUsers() {
  const tbody      = document.getElementById('usersTableBody');
  const mobileList = document.getElementById('mobileUserList');
  if (!tbody && !mobileList) return;

  const users = DB.users || [];

  if (!users.length) {
    if (tbody)      tbody.innerHTML      = `<tr><td colspan="4" class="empty-row"><i class="fa-solid fa-inbox"></i> No users found</td></tr>`;
    if (mobileList) mobileList.innerHTML = `<div class="empty-state">No users found</div>`;
    return;
  }

  /* ── DESKTOP TABLE (4 columns: Name/Email, Role, Status, Actions) ── */
  if (tbody) {
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:.75rem">
            <div class="user-mobile-avatar"><i class="fa-solid fa-user"></i></div>
            <div>
              <div style="font-weight:700">${escHtml(u.name||u.email)}</div>
              <div style="font-size:.75rem;color:var(--text-muted)">${escHtml(u.email)}</div>
            </div>
          </div>
        </td>
        <td><span class="role-pill">${escHtml(formatRole(u.role))}</span></td>
        <td>
          <span class="status-pill-sm ${u.status==='disabled'?'disabled':'active'}">
            ${u.status==='disabled'?'Disabled':'Active'}
          </span>
        </td>
        <td>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="editUser('${u.id}')">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button class="btn btn-ghost btn-sm"
                    onclick="toggleUserStatus('${u.id}','${u.status||'active'}')">
              ${u.status==='disabled'
                ? '<i class="fa-solid fa-unlock"></i> Enable'
                : '<i class="fa-solid fa-ban"></i> Disable'}
            </button>
            <button class="btn btn-danger btn-sm"
                    onclick="removeUser('${u.id}','${escHtml(u.email)}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`).join('');
  }

  /* ── MOBILE CARDS ── */
  if (mobileList) {
    mobileList.innerHTML = users.map(u => `
      <div class="user-mobile-card glass">
        <div class="user-mobile-top">
          <div class="user-mobile-avatar"><i class="fa-solid fa-user"></i></div>
          <div class="user-mobile-meta">
            <div class="user-mobile-name">${escHtml(u.name||u.email)}</div>
            <div class="user-mobile-email">${escHtml(u.email)}</div>
          </div>
        </div>
        <div class="user-mobile-grid">
          <div class="user-mobile-field">
            <div class="user-mobile-label">Role</div>
            <div class="user-mobile-value">${escHtml(formatRole(u.role))}</div>
          </div>
          <div class="user-mobile-field">
            <div class="user-mobile-label">Status</div>
            <div class="user-mobile-value">
              <span class="status-pill-sm ${u.status==='disabled'?'disabled':'active'}">
                ${u.status==='disabled'?'Disabled':'Active'}
              </span>
            </div>
          </div>
        </div>
        <div class="user-mobile-actions">
          <button class="btn btn-ghost btn-sm" onclick="editUser('${u.id}')">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
          <button class="btn btn-ghost btn-sm"
                  onclick="toggleUserStatus('${u.id}','${u.status||'active'}')">
            ${u.status==='disabled'
              ? '<i class="fa-solid fa-unlock"></i> Enable'
              : '<i class="fa-solid fa-ban"></i> Disable'}
          </button>
          <button class="btn btn-danger btn-sm"
                  onclick="removeUser('${u.id}','${escHtml(u.email)}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`).join('');
  }
}

function formatRole(role) {
  return { super_admin:'Super Admin', admin:'Admin', editor:'Editor', viewer:'User' }[role] || 'User';
}

/* ══════════════════════════════════════ ACCESS REQUESTS ══════════════════════════════════════ */
function renderAccessRequests() {
function renderAccessRequests() {
  const list       = document.getElementById('accessRequestsList');
  const badge      = document.getElementById('accessRequestsBadge');
  const pendingEl  = document.getElementById('arCountPending');
  const approvedEl = document.getElementById('arCountApproved');
  const rejectedEl = document.getElementById('arCountRejected');
  if (!list) return;

  const user    = auth.currentUser;
  const isAdmin = user?.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();
  if (!isAdmin) {
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-lock"></i> Admin only</div>`;
    if (badge) badge.style.display = 'none';
    return;
  }

  const activeTab = document.querySelector('.ar-tab.active')?.dataset.filter || 'all';
  let requests    = [...(DB.accessRequests||[])];

  const pendingCount  = requests.filter(r=>(r.status||'pending').toLowerCase()==='pending').length;
  const approvedCount = requests.filter(r=>(r.status||'').toLowerCase()==='approved').length;
  const rejectedCount = requests.filter(r=>(r.status||'').toLowerCase()==='rejected').length;

  if (pendingEl)  pendingEl.textContent  = pendingCount;
  if (approvedEl) approvedEl.textContent = approvedCount;
  if (rejectedEl) rejectedEl.textContent = rejectedCount;
  if (badge) { badge.style.display=pendingCount>0?'inline-flex':'none'; badge.textContent=pendingCount; }

  if (activeTab !== 'all') requests = requests.filter(r=>(r.status||'pending').toLowerCase()===activeTab);
  if (!requests.length) { list.innerHTML=`<div class="empty-state"><i class="fa-solid fa-inbox"></i> No access requests found</div>`; return; }

  list.innerHTML = requests.map(r => {
    const status     = (r.status||'pending').toLowerCase();
    const badgeCls   = status==='approved'?'ar-badge-approved':status==='rejected'?'ar-badge-rejected':'ar-badge-pending';
    const reqAt      = r.createdAt?.seconds ? new Date(r.createdAt.seconds*1000).toLocaleString('en-IN') : '—';
    const displayName= r.name||r.fullName||(r.email?r.email.split('@')[0]:'Unknown User');
    const reason     = r.reason||r.message||r.note||'';
    return `
      <div class="ar-row">
        <div class="ar-avatar"><i class="fa-solid fa-user"></i></div>
        <div class="ar-info">
          <div class="ar-name">
            ${escHtml(displayName)}
            <span class="${badgeCls}" style="margin-left:8px">${escHtml(status.toUpperCase())}</span>
          </div>
          <div class="ar-email">${escHtml(r.email||'No email')}</div>
          ${reason?`<div class="ar-reason">${escHtml(reason)}</div>`:''}
        </div>
        <div class="ar-time">${reqAt}</div>
        <div class="ar-actions" style="visibility:${status==='pending'?'visible':'hidden'}">
          <button class="btn btn-sm btn-ar-approve" onclick="approveAccessRequest('${r.id}')"><i class="fa-solid fa-check"></i></button>
          <button class="btn btn-sm btn-ar-reject"  onclick="rejectAccessRequest('${r.id}')"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>`;
  }).join('');
}

window.approveAccessRequest = async function(id) {
  try {
    const req = DB.accessRequests.find(x => x.id === id); if (!req) return;
    await updateDoc(doc(db,'access_requests',id), { status:'approved', updatedAt:serverTimestamp() });
    const existing = await getDocs(query(collection(db,'users'), where('email','==',req.email)));
    if (existing.empty) {
      await addDoc(collection(db,'users'), {
        email:req.email, uid:req.uid||'',
        name:req.name||req.fullName||'',
        role:'viewer', status:'active', createdAt:serverTimestamp()
      });
    } else {
      await updateDoc(existing.docs[0].ref, { status:'active', updatedAt:serverTimestamp() });
    }
    showToast(`Approved ${req.email}`, 'success');
    await fetchData();
  } catch(err) { console.error(err); showToast('Approve failed: '+err.message,'warning'); }
};

window.rejectAccessRequest = async function(id) {
  try {
    const req = DB.accessRequests.find(x => x.id === id); if (!req) return;
    await updateDoc(doc(db,'access_requests',id), { status:'rejected', updatedAt:serverTimestamp() });
    showToast(`Rejected ${req.email}`, 'warning');
    await fetchData();
  } catch(err) { console.error(err); showToast('Reject failed: '+err.message,'warning'); }
};

/* ══════════════════════════════════════ HELPERS ══════════════════════════════════════ */
  const cnt = document.getElementById('settingsModelCount');
  if (cnt) cnt.textContent = `${DB.orders.length} model${DB.orders.length !== 1 ? 's' : ''}`;
  const user = auth.currentUser;
  const emailEl = document.getElementById('settingsUserEmail');
  if (emailEl && user) emailEl.textContent = user.email || '—';
}

function initDashboard() {
  const sidebar        = document.getElementById('sidebar');
  const mainWrap       = document.getElementById('mainWrap');
  const sidebarToggle  = document.getElementById('sidebarToggle');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const orderModal     = document.getElementById('orderModal');
  const isMobile       = () => window.innerWidth <= 900;

  sidebarToggle?.addEventListener('click', () => {
    if (isMobile()) {
      const isOpen = sidebar.classList.contains('mobile-open');
      sidebar.classList.toggle('mobile-open', !isOpen);
      sidebarOverlay?.classList.toggle('show', !isOpen);
      document.body.style.overflow = isOpen ? '' : 'hidden';
    } else {
      sidebar.classList.toggle('collapsed');
      mainWrap.classList.toggle('expanded');
    }
  });

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    sidebarOverlay?.classList.remove('show');
    document.body.style.overflow = '';
  }
  sidebarOverlay?.addEventListener('click', closeMobileSidebar);

  initGreeting();

  /* ── ADMIN GATE ── */
  const isAdmin = auth.currentUser?.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();
  if (isAdmin) {
    document.querySelector('.nav-item[data-section="users"]')?.style.setProperty('display', '');
    document.querySelector('.nav-item[data-section="access-requests"]')?.style.setProperty('display', '');
    document.getElementById('openAddUserBtn')?.style.setProperty('display', '');
    document.getElementById('clearDataBtn')?.style.setProperty('display', '');
  } else {
    document.querySelector('.nav-item[data-section="users"]')?.style.setProperty('display', 'none');
    document.querySelector('.nav-item[data-section="access-requests"]')?.style.setProperty('display', 'none');
    document.getElementById('openAddUserBtn')?.style.setProperty('display', 'none');
    document.getElementById('clearDataBtn')?.style.setProperty('display', 'none');
  }

  /* ── NAV ── */
  function navigateTo(section) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');
    document.getElementById(`section-${section}`)?.classList.add('active');
    // reset detail views on navigation
    const sdw = document.getElementById('sellerDetailWrap');
    const sg  = document.getElementById('sellerGrid');
    if (sdw && sg) { sdw.classList.remove('visible'); sg.style.display = ''; }
  }
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.section);
      if (isMobile()) { closeMobileSidebar(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  });
  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.goto); });
  });

  document.getElementById('brandBackBtn')?.addEventListener('click', () => {
  document.getElementById('brandsGrid').style.display = '';
  document.getElementById('brandDetailWrap')?.classList.add('hidden');
});
document.getElementById('brandsSortSelect')?.addEventListener('change', renderBrands);

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try { await signOut(auth); window.location.href = 'login.html'; }
    catch(e) { showToast('Logout failed', 'warning'); }
  });

  /* ═══════════════════════════════════════
     ADD USER MODAL
     FIX: calls fetchData() after creation
          so DB.users actually refreshes
  ═══════════════════════════════════════ */
  document.getElementById('openAddUserBtn')?.addEventListener('click', () => {
    document.getElementById('addUserModal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });

  function closeAddUserModal() {
    document.getElementById('addUserModal')?.classList.add('hidden');
    document.body.style.overflow = '';
    ['newUserEmail','newUserPassword','newUserName'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const e = document.getElementById('addUserErr'); if (e) e.textContent = '';
  }
  document.getElementById('addUserModalClose')?.addEventListener('click', closeAddUserModal);
  document.getElementById('addUserCancelBtn')?.addEventListener('click',  closeAddUserModal);

  document.getElementById('addUserConfirmBtn')?.addEventListener('click', async () => {
    const adminCheck = (auth.currentUser?.email || '').toLowerCase().trim() === SUPER_ADMIN.toLowerCase().trim();
    if (!adminCheck) { showToast('Admin only', 'warning'); return; }

    const email    = document.getElementById('newUserEmail')?.value.trim();
    const password = document.getElementById('newUserPassword')?.value;
    const name     = document.getElementById('newUserName')?.value.trim() || '';
    const role     = document.getElementById('newUserRole')?.value || 'viewer';
    const errEl    = document.getElementById('addUserErr');
    const btn      = document.getElementById('addUserConfirmBtn');

    if (errEl) errEl.textContent = '';
    if (!email || !password) { if (errEl) errEl.textContent = 'Email and password are required'; return; }
    if (password.length < 6)  { if (errEl) errEl.textContent = 'Password must be at least 6 characters'; return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await secondaryAuth.signOut();
      await addDoc(collection(db, 'users'), {
        uid: cred.user.uid, email, name, role,
        status: 'active', createdAt: serverTimestamp()
      });
      showToast(`User ${email} created!`, 'success');
      closeAddUserModal();
      await fetchData(); // ← FIXED: was renderUsers() — DB.users never updated
    } catch (err) {
      const msg = err.code === 'auth/email-already-in-use' ? 'Email already in use'
                : err.code === 'auth/invalid-email'        ? 'Invalid email address'
                : err.code === 'auth/weak-password'        ? 'Password is too weak (min 6 chars)'
                : err.message;
      if (errEl) errEl.textContent = msg;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create User';
    }
  });

  /* ── TABS ── */
  document.querySelectorAll('.sellers-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sellers-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active'); renderSellers();
    });
  });
  document.querySelectorAll('.upcoming-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.upcoming-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active'); renderUpcoming();
    });
  });
  document.querySelectorAll('.ar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active'); renderAccessRequests();
    });
  });

  document.getElementById('refreshAccessRequestsBtn')?.addEventListener('click', async () => {
    await fetchData(); showToast('Access requests refreshed', 'info');
  });

  /* ── GLOBAL SEARCH ── */
  document.getElementById('globalSearch')?.addEventListener('input', e => {
    const q = e.target.value.trim();
    if (q.length > 0) {
      navigateTo('orders');
      const s = document.getElementById('invSearch');
      if (s) { s.value = q; applyCollectionFilters(); }
    }
  });

  /* ── COLLECTION FILTERS ── */
  ['invSearch','invFilterBrand','invFilterStatus','invFilterScale','invSort'].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  applyCollectionFilters);
    document.getElementById(id)?.addEventListener('change', applyCollectionFilters);
  });
  initCollectionViewToggle();
  initProfileSection();
  initTopbarDropdown();
  initGlobalSearch();
  document.getElementById('invClearFilters')?.addEventListener('click', () => {
    ['invSearch','invFilterBrand','invFilterStatus','invFilterScale'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const sort = document.getElementById('invSort'); if (sort) sort.value = 'newest';
    applyCollectionFilters();
  });

  /* ── BRAND STORE ── */
  async function loadBrandsFromFirestore() {
    const user         = auth.currentUser;
    const currentEmail = (user?.email || '').toLowerCase().trim();
    const isAdm        = currentEmail === SUPER_ADMIN.toLowerCase().trim();
    try {
      const snap = await getDocs(collection(db, 'brands'));
      customBrands = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => {
          const ou = (b.ownerUid   || '').trim();
          const oe = (b.ownerEmail || '').toLowerCase().trim();
          if (ou === user?.uid || oe === currentEmail) return true;
          if (!ou && !oe && isAdm) return true;
          return false;
        })
        .map(b => b.name).filter(Boolean);
    } catch(e) {
      customBrands = JSON.parse(localStorage.getItem('pretrack_brands') || '[]');
    }
    rebuildAllBrandDropdowns();
  }

  async function addCustomBrand(name) {
    if (!name) return false;
    const normalized = name.trim();
    if (getAllBrands().map(x => x.toLowerCase().trim()).includes(normalized.toLowerCase())) return false;
    try {
      await addDoc(collection(db, 'brands'), {
        name: normalized, createdAt: serverTimestamp(),
        ownerUid:   auth.currentUser?.uid   || '',
        ownerEmail: auth.currentUser?.email || ''
      });
      customBrands.push(normalized);
    } catch(e) {
      customBrands.push(normalized);
      localStorage.setItem('pretrack_brands', JSON.stringify(customBrands));
    }
    return true;
  }

  loadBrandsFromFirestore();

  /* ── MODAL BRAND DROPDOWN ── */
  const brandSelect  = document.getElementById('fBrandSelect');
  const newBrandRow  = document.getElementById('newBrandRow');
  const fNewBrand    = document.getElementById('fNewBrand');
  const fBrandHidden = document.getElementById('fBrand');

  brandSelect?.addEventListener('change', () => {
    if (brandSelect.value === '__new__') {
      newBrandRow?.classList.remove('hidden'); fNewBrand?.focus();
      if (fBrandHidden) fBrandHidden.value = '';
      brandSelect.value = '';
    } else {
      newBrandRow?.classList.add('hidden');
      if (fBrandHidden) fBrandHidden.value = brandSelect.value;
    }
  });

  document.getElementById('confirmNewBrand')?.addEventListener('click', async () => {
    const name = fNewBrand?.value.trim();
    if (!name) { showToast('Enter a brand name', 'warning'); return; }
    const btn = document.getElementById('confirmNewBrand');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    const added = await addCustomBrand(name);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Add'; }
    if (added) {
      rebuildAllBrandDropdowns(name);
      if (fBrandHidden) fBrandHidden.value = name;
      if (brandSelect)  brandSelect.value  = name;
      showToast(`Brand "${name}" saved!`, 'success');
    } else {
      showToast(`"${name}" already exists`, 'warning');
      if (brandSelect)  brandSelect.value  = name;
      if (fBrandHidden) fBrandHidden.value = name;
    }
    newBrandRow?.classList.add('hidden');
    if (fNewBrand) fNewBrand.value = '';
  });

  document.getElementById('cancelNewBrand')?.addEventListener('click', () => {
    newBrandRow?.classList.add('hidden');
    if (fNewBrand)    fNewBrand.value    = '';
    if (brandSelect)  brandSelect.value  = '';
    if (fBrandHidden) fBrandHidden.value = '';
  });

  /* ── STATUS PILLS ── */
  document.querySelectorAll('#orderModal .status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#orderModal .status-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const r = pill.querySelector('input[type="radio"]');
      if (r) { r.checked = true; const fs = document.getElementById('fStatus'); if (fs) fs.value = r.value; }
    });
  });
  document.querySelector('#orderModal .status-pill')?.classList.add('active');

  /* ── ORDER MODAL OPEN/CLOSE ── */
  function openModal() {
    orderModal?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    orderModal?.classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('orderForm')?.reset();
    const eid = document.getElementById('editOrderId'); if (eid) eid.value = '';
    const ip  = document.getElementById('imagePreview');
    if (ip) ip.innerHTML = '<i class="fa-solid fa-camera"></i><p>Click to upload photo</p><span>JPG, PNG, WEBP · max 5MB</span>';
    const fi = document.getElementById('fImage'); if (fi) fi.value = '';
    _currentImageFile = null; _currentImageB64 = '';
    rebuildDropdown(document.getElementById('fBrandSelect'));
    document.getElementById('newBrandRow')?.classList.add('hidden');
    const fb = document.getElementById('fBrand'); if (fb) fb.value = '';
    document.querySelectorAll('#orderModal .status-pill').forEach(p => p.classList.remove('active'));
    document.querySelector('#orderModal .status-pill')?.classList.add('active');
    const fs = document.getElementById('fStatus'); if (fs) fs.value = 'Ordered';
    const td = document.getElementById('fTotalDisplay');   if (td) td.textContent = '₹0';
    const pd = document.getElementById('fPendingDisplay'); if (pd) { pd.textContent = '₹0'; pd.classList.remove('fg-calc-overdue'); pd.style.color = ''; }
  }

  /* ── PAYMENT CALC ── */
  ['fPreorderPrice','fActualPrice','fShipping','fPaid','fQty'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcTotals);
  });
  function calcTotals() {
    const price = parseFloat(document.getElementById('fActualPrice')?.value) || 0;
    const qty   = parseInt(document.getElementById('fQty')?.value)           || 1;
    const ship  = parseFloat(document.getElementById('fShipping')?.value)    || 0;
    const paid  = parseFloat(document.getElementById('fPaid')?.value)        || 0;
    const total = (price * qty) + ship;
    const diff  = total - paid;
    const pend  = Math.max(0, diff);
    const fmt   = v => `₹${v.toLocaleString('en-IN')}`;
    const td    = document.getElementById('fTotalDisplay');
    if (td) { td.textContent = fmt(total); td.title = `(₹${price.toLocaleString('en-IN')} × ${qty}) + ₹${ship.toLocaleString('en-IN')} shipping`; }
    const pd = document.getElementById('fPendingDisplay');
    if (pd) {
      if (diff < 0) {
        pd.textContent = `+₹${Math.abs(diff).toLocaleString('en-IN')}`;
        pd.classList.remove('fg-calc-overdue'); pd.style.color = 'var(--green, #22c55e)';
        pd.title = `Overpaid by ₹${Math.abs(diff).toLocaleString('en-IN')}`;
      } else {
        pd.textContent = fmt(pend); pd.style.color = '';
        pd.classList.toggle('fg-calc-overdue', pend > 0); pd.title = '';
      }
    }
    const ftEl = document.getElementById('fTotal');   if (ftEl) ftEl.value = total;
    const fpEl = document.getElementById('fPending'); if (fpEl) fpEl.value = pend;
  }

  ['addOrderBtn','quickAddBtn','qaAddOrder','sidebarAddOrder','topbarAddBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      document.getElementById('modalTitle').textContent = 'Add New Model'; openModal();
    });
  });
  document.getElementById('modalClose')?.addEventListener('click',  closeModal);
  document.getElementById('modalCancel')?.addEventListener('click', closeModal);
  orderModal?.addEventListener('click', e => { if (e.target === orderModal) closeModal(); });

  const viewModal = document.getElementById('viewModal');
  document.getElementById('viewModalClose')?.addEventListener('click', () => {
    viewModal?.classList.add('hidden'); document.body.style.overflow = '';
  });
  viewModal?.addEventListener('click', e => {
    if (e.target === viewModal) { viewModal.classList.add('hidden'); document.body.style.overflow = ''; }
  });

  /* ── IMAGE UPLOAD ── */
  document.getElementById('imageUploadArea')?.addEventListener('click', () => document.getElementById('fImage')?.click());
  document.getElementById('fImage')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5MB)', 'warning'); return; }
    _currentImageFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      _currentImageB64 = ev.target.result;
      const p = document.getElementById('imagePreview');
      if (p) p.innerHTML = `<img src="${_currentImageB64}" alt="preview" />`;
    };
    reader.readAsDataURL(file);
  });

  /* ── SAVE ORDER (modal) ── */
  document.getElementById('orderForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const saveBtn = document.getElementById('modalSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; }
    const editId   = document.getElementById('editOrderId')?.value || '';
    const price    = parseFloat(document.getElementById('fActualPrice')?.value) || 0;
    const qty      = parseInt(document.getElementById('fQty')?.value)           || 1;
    const ship     = parseFloat(document.getElementById('fShipping')?.value)    || 0;
    const paid     = parseFloat(document.getElementById('fPaid')?.value)        || 0;
    const total    = (price * qty) + ship;
    const pending  = Math.max(0, total - paid);
    const existing = DB.orders.find(o => o.id === editId);
    try {
      let imageUrl = existing?.image || '';
      if (_currentImageFile) {
        if (existing?.image) await deleteImageFromSupabase(existing.image);
        imageUrl = await uploadImageToSupabase(_currentImageFile);
      }
      const order = {
        product_name:   document.getElementById('fProductName')?.value.trim()  || '',
        order_number:   document.getElementById('fOrderNumber')?.value.trim()  || '',
        brand:          document.getElementById('fBrand')?.value.trim()        || '',
        series:         document.getElementById('fSeries')?.value?.trim()      || '',
        scale:          document.getElementById('fScale')?.value               || '1:64',
        condition:      document.getElementById('fCondition')?.value           || 'Mint',
        vendor:         document.getElementById('fVendor')?.value?.trim()      || '',
        location:       document.getElementById('fLocation')?.value?.trim()    || '',
        variant:        document.getElementById('fVariant')?.value             || '',
        notes:          document.getElementById('fNotes')?.value?.trim()       || '',
        quantity: qty, order_date: document.getElementById('fOrderDate')?.value || '',
        eta:            document.getElementById('fEta')?.value                 || '',
        status:         document.getElementById('fStatus')?.value              || 'Ordered',
        preorder_price: parseFloat(document.getElementById('fPreorderPrice')?.value) || 0,
        actual_price: price, shipping: ship, paid, pending, total, image: imageUrl,
        updatedAt: serverTimestamp(),
        ownerUid:  auth.currentUser?.uid   || '',
        ownerEmail:auth.currentUser?.email || ''
      };
      if (editId) {
        await updateDoc(doc(db, 'orders', editId), order);
        try { await addActivity('info', `Updated — ${order.product_name}`); } catch(e) { console.warn(e); }
        showToast('Order updated!', 'success');
      } else {
        await addDoc(collection(db, 'orders'), { ...order, createdAt: serverTimestamp() });
        try { await addActivity('success', `Added — ${order.product_name}`); } catch(e) { console.warn(e); }
        showToast('Order added!', 'success');
      }
      await fetchData(); closeModal();
    } catch(err) {
      console.error(err); showToast('Failed to save: ' + err.message, 'warning');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; }
    }
  });

  /* ── QUICK ACTIONS ── */
  document.getElementById('qaExport')?.addEventListener('click', exportCSV);
  document.getElementById('qaAnalytics')?.addEventListener('click', () => navigateTo('analytics'));
  document.getElementById('qaDelayed')?.addEventListener('click', () => {
    navigateTo('orders');
    const delayed = DB.orders.filter(o => o.eta && new Date(o.eta) < new Date() && o.status !== 'Delivered');
    delayed.length === 0
      ? showToast('No delayed orders!', 'info')
      : (renderTable(delayed), showToast(`${delayed.length} delayed shown`, 'warning'));
  });
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);

  /* ── ADD ORDER PAGE FORM ── */
  const pageForm     = document.getElementById('addOrderPageForm');
  const pBrandSelect = document.getElementById('pBrandSelect');
  const pNewBrandRow = document.getElementById('pNewBrandRow');
  const pNewBrandIn  = document.getElementById('pNewBrand');
  const pBrandHidden = document.getElementById('pBrand');
  let _pageImageFile = null;

  rebuildDropdown(pBrandSelect);

  pBrandSelect?.addEventListener('change', () => {
    if (pBrandSelect.value === '__new__') {
      pNewBrandRow?.classList.remove('hidden'); pNewBrandIn?.focus();
      if (pBrandHidden) pBrandHidden.value = ''; pBrandSelect.value = '';
    } else {
      pNewBrandRow?.classList.add('hidden');
      if (pBrandHidden) pBrandHidden.value = pBrandSelect.value;
    }
  });

  document.getElementById('pConfirmNewBrand')?.addEventListener('click', async () => {
    const name = pNewBrandIn?.value.trim();
    if (!name) { showToast('Enter a brand name', 'warning'); return; }
    const btn = document.getElementById('pConfirmNewBrand');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    const added = await addCustomBrand(name);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Add'; }
    if (added) {
      rebuildAllBrandDropdowns(name);
      if (pBrandHidden) pBrandHidden.value = name;
      if (pBrandSelect) pBrandSelect.value = name;
      showToast(`Brand "${name}" saved!`, 'success');
    } else {
      showToast(`"${name}" already exists`, 'warning');
      if (pBrandSelect) pBrandSelect.value = name;
      if (pBrandHidden) pBrandHidden.value = name;
    }
    pNewBrandRow?.classList.add('hidden');
    if (pNewBrandIn) pNewBrandIn.value = '';
  });

  document.getElementById('pCancelNewBrand')?.addEventListener('click', () => {
    pNewBrandRow?.classList.add('hidden');
    if (pNewBrandIn)  pNewBrandIn.value  = '';
    if (pBrandSelect) pBrandSelect.value = '';
    if (pBrandHidden) pBrandHidden.value = '';
  });

  document.querySelectorAll('#pStatusPillGroup .status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#pStatusPillGroup .status-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const r = pill.querySelector('input[type="radio"]');
      if (r) { r.checked = true; const ps = document.getElementById('pStatus'); if (ps) ps.value = r.value; }
    });
  });

  document.getElementById('pImageUploadArea')?.addEventListener('click', () => document.getElementById('pImage')?.click());
  document.getElementById('pImage')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5MB)', 'warning'); return; }
    _pageImageFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = document.getElementById('pImagePreview');
      if (prev) prev.innerHTML = `<img src="${ev.target.result}" alt="preview" />`;
    };
    reader.readAsDataURL(file);
  });

  ['pActualPrice','pQty','pShipping','pPaid'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcPageTotals);
  });
  function calcPageTotals() {
    const price = parseFloat(document.getElementById('pActualPrice')?.value) || 0;
    const qty   = parseInt(document.getElementById('pQty')?.value)           || 1;
    const ship  = parseFloat(document.getElementById('pShipping')?.value)    || 0;
    const paid  = parseFloat(document.getElementById('pPaid')?.value)        || 0;
    const total = (price * qty) + ship;
    const diff  = total - paid;
    const pend  = Math.max(0, diff);
    const fmt   = v => `₹${v.toLocaleString('en-IN')}`;
    const td    = document.getElementById('pTotalDisplay'); if (td) td.textContent = fmt(total);
    const pd    = document.getElementById('pPendingDisplay');
    if (pd) {
      if (diff < 0) {
        pd.textContent = `+₹${Math.abs(diff).toLocaleString('en-IN')}`;
        pd.classList.remove('fg-calc-overdue'); pd.style.color = 'var(--green, #22c55e)';
        pd.title = `Overpaid by ₹${Math.abs(diff).toLocaleString('en-IN')}`;
      } else {
        pd.textContent = fmt(pend); pd.style.color = '';
        pd.classList.toggle('fg-calc-overdue', pend > 0); pd.title = '';
      }
    }
    const ptEl = document.getElementById('pTotal');   if (ptEl) ptEl.value = total;
    const ppEl = document.getElementById('pPending'); if (ppEl) ppEl.value = pend;
  }

  function resetPageForm() {
    pageForm?.reset();
    rebuildDropdown(pBrandSelect);
    if (pBrandHidden) pBrandHidden.value = '';
    pNewBrandRow?.classList.add('hidden');
    document.querySelectorAll('#pStatusPillGroup .status-pill').forEach(p => p.classList.remove('active'));
    document.querySelector('#pStatusPillGroup .status-pill')?.classList.add('active');
    const ps = document.getElementById('pStatus'); if (ps) ps.value = 'Ordered';
    ['pTotalDisplay','pPendingDisplay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '₹0'; el.classList.remove('fg-calc-overdue'); el.style.color = ''; }
    });
    const prev = document.getElementById('pImagePreview');
    if (prev) prev.innerHTML = '<i class="fa-solid fa-camera"></i><p>Click to upload photo</p><span>JPG, PNG, WEBP · max 5MB</span>';
    const pi = document.getElementById('pImage'); if (pi) pi.value = '';
    _pageImageFile = null;
  }

  document.getElementById('addOrderPageClear')?.addEventListener('click', resetPageForm);

  pageForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const saveBtn = document.getElementById('addOrderPageSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; }
    const price   = parseFloat(document.getElementById('pActualPrice')?.value) || 0;
    const qty     = parseInt(document.getElementById('pQty')?.value)           || 1;
    const ship    = parseFloat(document.getElementById('pShipping')?.value)    || 0;
    const paid    = parseFloat(document.getElementById('pPaid')?.value)        || 0;
    const total   = (price * qty) + ship;
    const pending = Math.max(0, total - paid);
    try {
      let imageUrl = '';
      if (_pageImageFile) imageUrl = await uploadImageToSupabase(_pageImageFile);
      const order = {
        product_name:   document.getElementById('pProductName')?.value.trim() || '',
        brand:          (document.getElementById('pBrand')?.value.trim() || document.getElementById('pBrandSelect')?.value || '').replace('__new__',''),
        order_number:   document.getElementById('pOrderNumber')?.value.trim() || '',
        scale:          document.getElementById('pScale')?.value              || '1:64',
        variant:        document.getElementById('pVariant')?.value            || '',
        notes:          document.getElementById('pNotes')?.value?.trim()      || '',
        quantity: qty,  order_date: document.getElementById('pOrderDate')?.value || '',
        eta:            document.getElementById('pEta')?.value                || '',
        status:         document.getElementById('pStatus')?.value             || 'Ordered',
        preorder_price: parseFloat(document.getElementById('pPreorderPrice')?.value) || 0,
        actual_price: price, shipping: ship, paid, pending, total, image: imageUrl,
        series: '', condition: 'Mint',
        vendor:   document.getElementById('pVendor')?.value?.trim()   || '',
        location: document.getElementById('pLocation')?.value?.trim() || '',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        ownerUid:  auth.currentUser?.uid   || '',
        ownerEmail:auth.currentUser?.email || ''
      };
      if (!order.brand) { showToast('Please select a brand', 'warning'); return; }
      await addDoc(collection(db, 'orders'), order);
      try { await addActivity('success', `Added — ${order.product_name}`); } catch(e) { console.warn(e); }
      showToast('Order saved! 🎉', 'success');
      await fetchData(); resetPageForm(); navigateTo('orders');
    } catch(err) {
      console.error(err); showToast('Failed to save: ' + err.message, 'warning');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Order'; }
    }
  });

  function exportCSV() {
    if (!DB.orders.length) { showToast('No orders to export', 'warning'); return; }
    const headers = ['ID','Product','Brand','Series','Scale','Condition','Order#','Vendor','Location','Variant','Qty','Buy Price','Market Value','Shipping','Paid','Pending','Total','Status','ETA','Order Date'];
    const rows    = DB.orders.map(o => [o.id,o.product_name,o.brand,o.series,o.scale,o.condition,o.order_number,o.vendor,o.location,o.variant,o.quantity,o.actual_price,o.preorder_price,o.shipping,o.paid,o.pending,o.total,o.status,o.eta,o.order_date]);
    const csv     = [headers,...rows].map(r => r.map(c => `"${c??''}"`).join(',')).join('\n');
    const a       = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type:'text/csv' })),
      download: `pretrack_${Date.now()}.csv`
    });
    a.click(); showToast('CSV exported!', 'success');
  }

  /* ── CLEAR DATA ── */
  document.getElementById('clearDataBtn')?.addEventListener('click', () => {
    document.getElementById('clearDataModal')?.classList.remove('hidden');
    document.getElementById('clearDataPw')?.focus();
  });

  function closeClearModal() {
    document.getElementById('clearDataModal')?.classList.add('hidden');
    const pw  = document.getElementById('clearDataPw');   if (pw)  pw.value = '';
    const err = document.getElementById('clearDataPwErr');if (err) err.textContent = '';
  }
  document.getElementById('clearDataCancelBtn')?.addEventListener('click', closeClearModal);
  document.getElementById('clearDataCancelBtnFooter')?.addEventListener('click', closeClearModal);

  document.getElementById('clearDataConfirmBtn')?.addEventListener('click', async () => {
    const pw    = document.getElementById('clearDataPw')?.value || '';
    const pwErr = document.getElementById('clearDataPwErr');
    if (!pw) { if (pwErr) pwErr.textContent = 'Enter your password'; return; }
    const user = auth.currentUser;
    if (!user) { if (pwErr) pwErr.textContent = 'Not logged in'; return; }
    try {
      // FIX: use already-imported signInWithEmailAndPassword — no dynamic import needed
      await signInWithEmailAndPassword(auth, user.email, pw);
      closeClearModal();
      await Promise.all(DB.orders.map(o => o.image ? deleteImageFromSupabase(o.image) : Promise.resolve()));
      await Promise.all(DB.orders.map(o => deleteDoc(doc(db, 'orders', o.id))));
      await addActivity('warning', 'All orders cleared');
      await fetchData(); showToast('All data cleared', 'info');
    } catch(e) {
      if (pwErr) pwErr.textContent = 'Incorrect password. Try again.';
    }
  });

  /* ═══════════════════════════════════════
     ORDER ACTIONS (exposed on window so
     inline onclick="" in renderTable works)
  ═══════════════════════════════════════ */
  window.editOrder = function(id) {
    const o = DB.orders.find(x => x.id === id); if (!o) return;
    document.getElementById('modalTitle').textContent = 'Edit Model';
    [
      ['editOrderId','id'],['fProductName','product_name'],['fOrderNumber','order_number'],
      ['fSeries','series'],['fScale','scale'],['fCondition','condition'],
      ['fVendor','vendor'],['fLocation','location'],['fVariant','variant'],['fNotes','notes'],
      ['fQty','quantity'],['fOrderDate','order_date'],['fEta','eta'],
      ['fPreorderPrice','preorder_price'],['fActualPrice','actual_price'],['fShipping','shipping']
    ].forEach(([fieldId, key]) => {
      const el = document.getElementById(fieldId);
      if (el) el.value = key === 'id' ? o.id : (o[key] ?? '');
    });
    const paidEl = document.getElementById('fPaid'); if (paidEl) paidEl.value = o.paid || 0;

    const brand = o.brand || o.vendor || '';
    if (brand && !getAllBrands().includes(brand)) customBrands.push(brand);
    rebuildDropdown(document.getElementById('fBrandSelect'), brand);
    const fBH = document.getElementById('fBrand'); if (fBH) fBH.value = brand;

    const status = o.status || 'Ordered';
    document.querySelectorAll('#orderModal .status-pill').forEach(p => {
      p.classList.remove('active');
      const r = p.querySelector('input[type="radio"]');
      if (r && r.value === status) { p.classList.add('active'); r.checked = true; }
    });
    const fSt = document.getElementById('fStatus'); if (fSt) fSt.value = status;

    _currentImageFile = null; _currentImageB64 = '';
    const fi = document.getElementById('fImage'); if (fi) fi.value = '';
    const ip = document.getElementById('imagePreview');
    if (ip) ip.innerHTML = o.image
      ? `<img src="${o.image}" alt="preview" />`
      : '<i class="fa-solid fa-camera"></i><p>Click to upload photo</p><span>JPG, PNG, WEBP · max 5MB</span>';

    const p2 = parseFloat(o.actual_price)||0, q2 = parseInt(o.quantity)||1,
          s2 = parseFloat(o.shipping)||0,     pa2 = parseFloat(o.paid)||0;
    const t2 = (p2*q2)+s2, d2 = t2-pa2, pe2 = Math.max(0,d2);
    const fmt = v => `₹${v.toLocaleString('en-IN')}`;
    const td = document.getElementById('fTotalDisplay');
    if (td) { td.textContent = fmt(t2); td.title = `(₹${p2.toLocaleString('en-IN')} × ${q2}) + ₹${s2.toLocaleString('en-IN')} shipping`; }
    const pd = document.getElementById('fPendingDisplay');
    if (pd) {
      if (d2 < 0) {
        pd.textContent = `+₹${Math.abs(d2).toLocaleString('en-IN')}`;
        pd.classList.remove('fg-calc-overdue'); pd.style.color = 'var(--green, #22c55e)';
        pd.title = `Overpaid by ₹${Math.abs(d2).toLocaleString('en-IN')}`;
      } else {
        pd.textContent = fmt(pe2); pd.style.color = '';
        pd.classList.toggle('fg-calc-overdue', pe2 > 0); pd.title = '';
      }
    }
    const ftEl = document.getElementById('fTotal');   if (ftEl) ftEl.value = t2;
    const fpEl = document.getElementById('fPending'); if (fpEl) fpEl.value = pe2;
    openModal();
  };

  window.deleteOrder = async function(id) {
    if (!confirm('Delete this order?')) return;
    try {
      const o = DB.orders.find(x => x.id === id);
      if (o?.image) await deleteImageFromSupabase(o.image);
      await deleteDoc(doc(db, 'orders', id));
      await addActivity('warning', `Deleted — ${o?.product_name || id}`);
      showToast('Order deleted', 'success'); await fetchData();
    } catch(e) { showToast('Failed to delete: ' + e.message, 'warning'); }
  };

  window.duplicateOrder = async function(id) {
    const o = DB.orders.find(x => x.id === id); if (!o) return;
    try {
      const { id: _id, createdAt, updatedAt, ...copy } = o;
      await addDoc(collection(db, 'orders'), {
        ...copy, product_name: copy.product_name + ' (Copy)',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await addActivity('info', `Duplicated — ${o.product_name}`);
      showToast('Order duplicated!', 'success'); await fetchData();
    } catch(e) { showToast('Failed to duplicate', 'warning'); }
  };

  window.viewOrder = function(id) {
  const o = DB.orders.find(x => x.id === id); if (!o) return;
  const modal = document.getElementById('viewModal');
  const box   = document.getElementById('viewModalBox');
  if (!modal || !box) return;

  const sc    = (o.status||'').toLowerCase().replace(/\s+/g,'-');
  const fmt   = v => `₹${Number(v||0).toLocaleString('en-IN')}`;
  const paid  = o.paid||0, total = o.total||0, pending = o.pending||0;
  const pct   = total > 0 ? Math.min(100, Math.round((paid/total)*100)) : 100;
  const barClr = pending > 0 ? 'linear-gradient(90deg,#f97316,#fbbf24)' : '#22c55e';

  // ETA banner
  let etaBanner = `<div class="vm-eta-banner vm-eta-none"><i class="fa-solid fa-calendar fa-lg"></i><div><div style="font-weight:600">No ETA set</div></div></div>`;
  if (o.eta) {
    const today = new Date(); today.setHours(0,0,0,0);
    const eta   = new Date(o.eta);
    const diff  = Math.ceil((eta - today) / (1000*60*60*24));
    if (o.status === 'Delivered') {
      etaBanner = `<div class="vm-eta-banner vm-eta-done"><i class="fa-solid fa-box-open fa-lg"></i><div><div style="font-weight:700">Delivered</div><div style="font-size:.73rem;opacity:.8">ETA was ${formatDate(o.eta)}</div></div></div>`;
    } else if (diff < 0) {
      etaBanner = `<div class="vm-eta-banner vm-eta-overdue"><i class="fa-solid fa-triangle-exclamation fa-lg"></i><div><div class="vm-eta-days">${Math.abs(diff)}d overdue</div><div style="font-size:.73rem;opacity:.8">Was due ${formatDate(o.eta)}</div></div></div>`;
    } else if (diff === 0) {
      etaBanner = `<div class="vm-eta-banner vm-eta-soon"><i class="fa-solid fa-bell fa-lg"></i><div><div style="font-weight:700">Due today!</div><div style="font-size:.73rem;opacity:.8">ETA: ${formatDate(o.eta)}</div></div></div>`;
    } else if (diff <= 7) {
      etaBanner = `<div class="vm-eta-banner vm-eta-soon"><i class="fa-solid fa-truck-moving fa-lg"></i><div><div class="vm-eta-days">${diff}d</div><div style="font-size:.73rem;opacity:.8">left · ETA ${formatDate(o.eta)}</div></div></div>`;
    } else {
      etaBanner = `<div class="vm-eta-banner vm-eta-ok"><i class="fa-solid fa-calendar-days fa-lg"></i><div><div class="vm-eta-days">${diff}d</div><div style="font-size:.73rem;opacity:.8">to go · ETA ${formatDate(o.eta)}</div></div></div>`;
    }
  }

  // Details rows — only show non-empty values
  const details = [
    { icon:'fa-building',        label:'Brand',     val: o.brand||o.vendor },
    { icon:'fa-ruler',           label:'Scale',     val: o.scale },
    { icon:'fa-cube',            label:'Variant',   val: o.variant },
    { icon:'fa-star-half-stroke',label:'Condition', val: o.condition },
    { icon:'fa-store',           label:'Seller',    val: o.vendor },
    { icon:'fa-barcode',         label:'Order #',   val: o.order_number },
    { icon:'fa-calendar-plus',   label:'Ordered',   val: o.order_date ? formatDate(o.order_date) : '' },
    { icon:'fa-boxes-stacked',   label:'Quantity',  val: o.quantity||1 },
    { icon:'fa-map-pin',         label:'Location',  val: o.location },
    { icon:'fa-layer-group',     label:'Series',    val: o.series },
  ].filter(d => d.val && d.val !== '' && d.val !== '—');

  // Hero background
  const heroStyle = o.image
    ? ''
    : 'background:linear-gradient(135deg,#1a1035,#2d2270 55%,#1d3a5f);';

  box.innerHTML = `
    <div class="vm-hero" style="${heroStyle}">
      ${o.image ? `<div class="vm-blur-bg" style="background-image:url('${o.image}')"></div><img class="vm-hero-img" src="${o.image}" alt="${escHtml(o.product_name)}" />` : `<div class="vm-no-img-icon"><i class="fa-solid fa-car-side"></i></div>`}
      <div class="vm-hero-overlay">
        <button class="vm-close-btn" id="vmClose"><i class="fa-solid fa-xmark"></i></button>
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-bottom:.3rem">
          <span class="badge badge-${sc}">${escHtml(o.status||'Ordered')}</span>
          ${o.variant  ? `<span style="background:rgba(255,255,255,.18);color:#fff;padding:2px 9px;border-radius:20px;font-size:.65rem;font-weight:700">${escHtml(o.variant)}</span>` : ''}
          ${o.scale    ? `<span style="background:rgba(255,255,255,.18);color:#fff;padding:2px 9px;border-radius:20px;font-size:.65rem;font-weight:700">${escHtml(o.scale)}</span>` : ''}
          ${o.quantity > 1 ? `<span style="background:rgba(124,92,252,.7);color:#fff;padding:2px 9px;border-radius:20px;font-size:.65rem;font-weight:700">×${o.quantity}</span>` : ''}
        </div>
        <div class="vm-hero-name">${escHtml(o.product_name||'—')}</div>
        <div class="vm-hero-brand"><i class="fa-solid fa-building"></i> ${escHtml(o.brand||o.vendor||'—')}</div>
      </div>
    </div>

    <div class="vm-body">
      ${etaBanner}

      <div>
        <div class="vm-section-title"><i class="fa-solid fa-wallet"></i> Payment</div>
        <div class="vm-pay-row">
          <div class="vm-pay-card">
            <div class="vm-pay-label">Total</div>
            <div class="vm-pay-val" style="color:#1e1b4b">${fmt(total)}</div>
          </div>
          <div class="vm-pay-card" style="border-color:#bbf7d0">
            <div class="vm-pay-label" style="color:#16a34a">Paid</div>
            <div class="vm-pay-val" style="color:#16a34a">${fmt(paid)}</div>
          </div>
          <div class="vm-pay-card" style="border-color:${pending>0?'#fed7aa':'#bbf7d0'}">
            <div class="vm-pay-label" style="color:${pending>0?'#c2410c':'#16a34a'}">${pending>0?'Due':'Cleared'}</div>
            <div class="vm-pay-val" style="color:${pending>0?'#c2410c':'#16a34a'}">${fmt(pending)}</div>
          </div>
        </div>
        <div class="vm-progress-wrap">
          <div style="display:flex;justify-content:space-between;font-size:.68rem;color:#64748b;font-weight:600">
            <span>Payment progress</span><span style="color:${pct>=100?'#16a34a':'#7c5cfc'};font-weight:800">${pct}% paid</span>
          </div>
          <div class="vm-progress-track">
            <div class="vm-progress-fill" style="width:${pct}%;background:${barClr}"></div>
          </div>
          <div style="font-size:.66rem;color:#94a3b8;margin-top:.2rem">
            ${fmt(o.actual_price||0)} × ${o.quantity||1}${o.shipping>0?` + ${fmt(o.shipping)} shipping`:''}
          </div>
        </div>
      </div>

      ${details.length ? `
      <div>
        <div class="vm-section-title"><i class="fa-solid fa-circle-info"></i> Details</div>
        <div class="vm-details-grid">
          ${details.map(d => `
            <div class="vm-detail-item">
              <div class="vm-detail-label"><i class="fa-solid ${d.icon}"></i> ${d.label}</div>
              <div class="vm-detail-val">${escHtml(String(d.val))}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      ${o.notes ? `
      <div>
        <div class="vm-section-title"><i class="fa-solid fa-note-sticky"></i> Notes</div>
        <div class="vm-notes">${escHtml(o.notes)}</div>
      </div>` : ''}

      <div class="vm-actions">
        <button class="btn btn-ghost" style="border:1.5px solid #ede9fe;color:#5b21b6;background:#fff" onclick="document.getElementById('viewModal').classList.add('hidden');document.body.style.overflow='';editOrder('${o.id}')">
          <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button class="btn btn-danger" style="background:linear-gradient(135deg,#dc2626,#be123c);border:none" onclick="document.getElementById('viewModal').classList.add('hidden');document.body.style.overflow='';deleteOrder('${o.id}')">
          <i class="fa-solid fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;

  document.getElementById('vmClose')?.addEventListener('click', () => {
    modal.classList.add('hidden'); document.body.style.overflow = '';
  });
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

} // ← end initDashboard()

/* ══════════════════════════════════════════════════════════════════
   EDIT USER MODAL
   Injected into DOM on first use — no HTML changes required.
   Features: edit name, role, status + send password reset email.
══════════════════════════════════════════════════════════════════ */
function ensureEditUserModal() {
  if (document.getElementById('editUserModal')) return;
  const modal = document.createElement('div');
  modal.id        = 'editUserModal';
  modal.className = 'modal-overlay hidden';
  modal.innerHTML = `
    <div class="modal-box glass" style="max-width:480px;width:100%">
      <div class="modal-header">
        <h2 style="display:flex;align-items:center;gap:.5rem">
          <i class="fa-solid fa-user-pen"></i> Edit User
        </h2>
        <button class="modal-close-btn" id="euClose"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:1.5rem;display:flex;flex-direction:column;gap:1.1rem">
        <input type="hidden" id="euId" />

        <div class="form-group">
          <label class="form-label">Display Name</label>
          <input type="text" id="euName" class="form-control" placeholder="Full name" />
        </div>

        <div class="form-group">
          <label class="form-label">
            Email
            <span style="color:var(--text-muted);font-size:.75rem;font-weight:400">(read-only)</span>
          </label>
          <input type="email" id="euEmail" class="form-control"
                 disabled style="opacity:.55;cursor:not-allowed" />
        </div>

        <div class="form-group">
          <label class="form-label">Role</label>
          <select id="euRole" class="form-control">
            <option value="viewer">User — view only</option>
            <option value="editor">Editor — add &amp; edit</option>
            <option value="admin">Admin — full access</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <p id="euRoleDesc" style="font-size:.75rem;color:var(--text-muted);margin-top:.35rem"></p>
        </div>

        <div class="form-group">
          <label class="form-label">Account Status</label>
          <select id="euStatus" class="form-control">
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        <div style="border-top:1px solid var(--border,rgba(255,255,255,.1));padding-top:1.1rem">
          <label class="form-label" style="margin-bottom:.6rem;display:flex;align-items:center;gap:.4rem">
            <i class="fa-solid fa-key" style="color:var(--primary)"></i> Password Reset
          </label>
          <button id="euResetBtn" class="btn btn-ghost" style="width:100%;justify-content:center">
            <i class="fa-solid fa-envelope"></i>&nbsp; Send Password Reset Email
          </button>
          <p style="font-size:.73rem;color:var(--text-muted);margin-top:.4rem;text-align:center">
            A secure reset link will be emailed to the user. You cannot set passwords directly from the client.
          </p>
        </div>

        <div id="euFeedback" style="font-size:.82rem;min-height:1.2rem;text-align:center"></div>
      </div>
      <div class="modal-footer" style="display:flex;gap:.75rem;justify-content:flex-end;
                                        padding:.9rem 1.5rem;
                                        border-top:1px solid var(--border,rgba(255,255,255,.1))">
        <button class="btn btn-ghost" id="euCancel">Cancel</button>
        <button class="btn btn-primary" id="euSave">
          <i class="fa-solid fa-floppy-disk"></i> Save Changes
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  /* role description helper */
  const roleDescs = {
    viewer:      '👁 Can only view orders — no add/edit',
    editor:      '✏️ Can add and edit orders',
    admin:       '⚙️ Full access, cannot manage users',
    super_admin: '👑 Full access including user management'
  };
  document.getElementById('euRole').addEventListener('change', e => {
    document.getElementById('euRoleDesc').textContent = roleDescs[e.target.value] || '';
  });

  function setFeedback(msg, isError = false) {
    const el = document.getElementById('euFeedback');
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = isError ? 'var(--red,#ef4444)' : 'var(--green,#22c55e)';
  }

  function closeEditModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    setFeedback('');
  }

  document.getElementById('euClose').addEventListener('click',  closeEditModal);
  document.getElementById('euCancel').addEventListener('click', closeEditModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeEditModal(); });

  /* Send password reset email */
  document.getElementById('euResetBtn').addEventListener('click', async () => {
    const email = document.getElementById('euEmail').value;
    if (!email) return;
    const btn = document.getElementById('euResetBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
    setFeedback('');
    try {
      await sendPasswordResetEmail(auth, email);
      setFeedback(`✓ Reset email sent to ${email}`);
      showToast('Password reset email sent!', 'success');
    } catch(e) {
      setFeedback('Could not send reset email: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-envelope"></i>&nbsp; Send Password Reset Email';
    }
  });

  /* Save name / role / status */
  document.getElementById('euSave').addEventListener('click', async () => {
    const docId  = document.getElementById('euId').value;
    const name   = document.getElementById('euName').value.trim();
    const role   = document.getElementById('euRole').value;
    const status = document.getElementById('euStatus').value;
    const btn    = document.getElementById('euSave');
    if (!docId) return;
    setFeedback('');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      await updateDoc(doc(db, 'users', docId), { name, role, status, updatedAt: serverTimestamp() });
      /* optimistic local update so re-render is instant */
      const lu = DB.users.find(u => u.id === docId);
      if (lu) { lu.name = name; lu.role = role; lu.status = status; }
      showToast('User updated!', 'success');
      closeEditModal();
      await fetchData();
    } catch(e) {
      setFeedback('Failed to save: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }
  });
}

window.editUser = function(docId) {
  ensureEditUserModal();
  const user = DB.users.find(u => u.id === docId);
  if (!user) { showToast('User not found', 'warning'); return; }
  document.getElementById('euId').value     = user.id;
  document.getElementById('euName').value   = user.name   || '';
  document.getElementById('euEmail').value  = user.email  || '';
  document.getElementById('euRole').value   = user.role   || 'viewer';
  document.getElementById('euStatus').value = user.status || 'active';
  document.getElementById('euFeedback').textContent = '';
  const roleDescs = {
    viewer:'👁 Can only view orders — no add/edit', editor:'✏️ Can add and edit orders',
    admin:'⚙️ Full access, cannot manage users',   super_admin:'👑 Full access including user management'
  };
  const rd = document.getElementById('euRoleDesc');
  if (rd) rd.textContent = roleDescs[user.role || 'viewer'] || '';
  document.getElementById('editUserModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

/* ═══════════════════════════════════════════
   USER STATUS / DELETE — window-exposed
   FIX: currentStatus now properly received;
        local DB.users updated immediately;
        deleteUser alias added
═══════════════════════════════════════════ */
window.toggleUserStatus = async function(docId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
  try {
    await updateDoc(doc(db, 'users', docId), { status: newStatus, updatedAt: serverTimestamp() });
    const u = DB.users.find(x => x.id === docId);
    if (u) u.status = newStatus; // optimistic local update
    showToast(`User ${newStatus === 'active' ? 'enabled' : 'disabled'}`, 'success');
    renderUsers();
  } catch(e) { showToast('Failed to update status: ' + e.message, 'warning'); }
};

window.removeUser = async function(docId, email) {
  if (!confirm(`Remove ${email} from PreTrack?\n\nThis removes their profile. Their Firebase Auth account stays.`)) return;
  try {
    await deleteDoc(doc(db, 'users', docId));
    DB.users = DB.users.filter(u => u.id !== docId); // optimistic local update
    showToast('User removed', 'success');
    renderUsers();
  } catch(e) { showToast('Failed to remove user: ' + e.message, 'warning'); }
};

window.deleteUser = window.removeUser; // ← alias: HTML that calls deleteUser() still works

/* ══════════════════════════════════════ FIRESTORE ══════════════════════════════════════ */

/* ══ BOOT — dashboard home ══ */
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = '../../login.html'; return; }
  _currentUser = user;
  const isSA = user.email?.toLowerCase() === SUPER_ADMIN.toLowerCase();
  if (isSA) { setText('profileName','Super Admin'); setText('profileRole','Super Admin'); }
  else {
    try {
      const snap = await getDocs(query(collection(db,'users'), where('email','==',user.email)));
      if (!snap.empty) {
        const d = snap.docs[0].data();
        setText('profileName', d.name?.trim()||user.email);
        const rm = {super_admin:'Super Admin',admin:'Admin',editor:'Editor',viewer:'User'};
        setText('profileRole', rm[d.role]||'User');
      } else { setText('profileName',user.email); setText('profileRole','User'); }
    } catch(e) { setText('profileName',user.email); }
  }
  if (user.email !== SUPER_ADMIN) await ensureUserProfile(user);
  await loadProfileFromFirestore();
  initDashboard();
  await fetchData();
});
