<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f0c1e,50:7c5cfc,100:0f0c1e&height=200&section=header&text=PreTrack&fontSize=72&fontColor=ffffff&fontAlignY=38&desc=Diecast%20Collection%20Manager&descSize=20&descAlignY=58&descColor=c4b5fd&animation=fadeIn"/>

<br/>

<img src="https://img.shields.io/badge/STATUS-LIVE-7c5cfc?style=for-the-badge&logo=vercel&logoColor=white"/>
<img src="https://img.shields.io/badge/VERSION-5.0-5b3fd4?style=for-the-badge&logoColor=white"/>
<img src="https://img.shields.io/badge/PWA-ENABLED-6d28d9?style=for-the-badge&logo=pwa&logoColor=white"/>
<img src="https://img.shields.io/badge/FIREBASE-REALTIME-FF6F00?style=for-the-badge&logo=firebase&logoColor=white"/>
<img src="https://img.shields.io/badge/ARCHITECTURE-MODULAR-22c55e?style=for-the-badge&logoColor=white"/>

<br/><br/>

<img src="https://readme-typing-svg.demolab.com?font=Outfit&weight=700&size=22&duration=2000&pause=800&color=7C5CFC&center=true&vCenter=true&width=700&lines=Track+Every+Diecast+You+Own+%F0%9F%8F%8E%EF%B8%8F;Monitor+Payments+%26+Pending+Dues+%F0%9F%92%B3;Never+Miss+an+ETA+Again+%F0%9F%93%85;Clean+Multi-File+Architecture+%E2%9C%85" />

<br/><br/>

<a href="https://dakshkohli23.github.io/Diecast-Trackings/login.html">
<img src="https://img.shields.io/badge/%F0%9F%9A%80%20%20OPEN%20DASHBOARD-%20-7c5cfc?style=for-the-badge&labelColor=0f0c1e&color=7c5cfc"/>
</a>

<br/><br/>

</div>

---

## 🏎️ What is PreTrack?

**PreTrack** is a personal diecast model car collection management dashboard. Built for collectors who want full visibility into their orders, payments, ETAs, and collection value — all in one place.

> *"Collect smarter. Track everything. Miss nothing."*

**v5.0** is a full architectural refactor — the original monolithic `app.js` + `style.css` + `index.html` has been split into a clean, maintainable multi-file structure. Every page has its own HTML, JS, and scoped CSS.

---

## ✨ Feature Highlights

<table>
<tr>
<td width="50%">

### 📦 Collection Manager
- Full order grid with image cards
- Grid & list view toggle
- Filter by brand, status, scale, sort
- Click-to-view detail modal
- Edit, delete, duplicate orders

</td>
<td width="50%">

### 💳 Payment Tracking
- Total spend per order & seller
- Paid vs pending breakdown
- Quick Pay modal per order
- Per-seller financial summary
- Running dues across all vendors

</td>
</tr>
<tr>
<td width="50%">

### 📅 ETA Calendar
- Month view with order dots
- Color-coded urgency — overdue 🔴, soon 🟠, upcoming 🟣
- Click any day to inspect orders
- Monthly stats strip
- Side panel with order detail

</td>
<td width="50%">

### 📊 Analytics
- Brand leaderboard & spend chart
- Status & scale distribution bars
- Monthly spend bar chart
- Seller reliability overview
- KPI summary cards

</td>
</tr>
<tr>
<td width="50%">

### 🏪 Sellers & Brands
- Seller cards with spend summary
- Click seller → see all their orders
- Dues vs fully paid indicator
- Brand drill-down with delivery rate
- Per-brand model list

</td>
<td width="50%">

### 🔔 Smart Dashboard
- **Greeting bar** with live stats
- Overdue ETA alerts
- Recent orders & upcoming deliveries
- Activity feed & brand leaderboard
- Collection insight strip

</td>
</tr>
</table>

---

## ⚡ Tech Stack

<div align="center">

<img src="https://skillicons.dev/icons?i=html,css,js,firebase&theme=dark"/>

<br/><br/>

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES Modules) |
| **Auth** | Firebase Authentication |
| **Database** | Cloud Firestore (real-time) |
| **Image Storage** | Supabase Storage |
| **Hosting** | GitHub Pages |
| **CI/CD** | GitHub Actions (secret injection) |
| **PWA** | Service Worker + Web Manifest |
| **Fonts** | Nunito, Lilita One (Google Fonts) |
| **Icons** | Font Awesome 6.5.0 |

</div>

---

## 🗂️ Project Structure

```
Diecast-Trackings/
│
├── 📄 index.html                      ← Root redirect (→ login)
├── 📄 login.html                      ← Authentication page
│
├── 📁 pages/
│   └── dashboard/
│       ├── index.html                 ← Dashboard home
│       ├── collection.html            ← Order grid (add/edit/delete)
│       ├── catalog.html               ← Read-only browsable catalog
│       ├── brands.html                ← Brand drill-down
│       ├── sellers.html               ← Seller hub
│       ├── add-order.html             ← Dedicated add order form
│       ├── calendar.html              ← ETA calendar
│       ├── upcoming.html              ← Overdue & upcoming deliveries
│       ├── analytics.html             ← Charts & trends
│       ├── payments.html              ← Payment tracking
│       ├── users.html                 ← User management (admin)
│       ├── access-requests.html       ← Access request review (admin)
│       ├── settings.html              ← App settings
│       └── profile.html               ← User profile & password
│
├── 📁 assets/
│   ├── css/
│   │   ├── global.css                 ← Variables, reset, sidebar, topbar, utils
│   │   ├── dashboard.css              ← All section & component styles
│   │   └── login.css                  ← Login page styles
│   │
│   └── js/
│       ├── auth/
│       │   ├── auth-guard.js          ← requireAuth() — protects all pages
│       │   ├── login.js               ← Login form & request access logic
│       │   └── logout.js              ← Sign out helper
│       │
│       ├── services/
│       │   └── firebase.js            ← Firebase + Supabase init & helpers
│       │
│       └── pages/
│           ├── dashboard-shell.js     ← Sidebar, topbar, search, toast, helpers
│           ├── dashboard.js           ← Dashboard home widgets & stats
│           ├── collection.js          ← Order grid + add/edit modal
│           ├── catalog.js             ← Catalog browse + detail modal
│           ├── brands.js              ← Brand cards + drill-down panel
│           ├── sellers.js             ← Seller cards + drill-down panel
│           ├── add-order.js           ← Full add order form page
│           ├── calendar.js            ← ETA calendar + sidebar
│           ├── upcoming.js            ← Upcoming/overdue tabs
│           ├── analytics.js           ← Charts & leaderboards
│           ├── payments.js            ← Payment table + quick pay
│           ├── users.js               ← User management (admin)
│           ├── access-requests.js     ← Access request review (admin)
│           ├── settings.js            ← Settings & danger zone
│           └── profile.js             ← Profile edit & password change
│
├── 📁 components/
│   ├── sidebar.html                   ← Sidebar nav (fetched & injected by JS)
│   └── navbar.html                    ← Topbar + global search (fetched & injected)
│
├── 📁 config/
│   └── config.js                      ← Runtime config (gitignored — real keys here)
│
├── 📁 pwa/
│   ├── manifest.json                  ← PWA manifest
│   └── sw.js                          ← Service worker
│
├── 📁 .github/
│   └── workflows/
│       └── deploy.yml                 ← CI/CD — secret injection + GitHub Pages deploy
│
├── 📄 .gitignore                      ← Excludes config/config.js & node_modules
└── 📄 README.md
```

---

## 🔐 Security Architecture

```
┌─────────────────────────────────────────────┐
│           GitHub Repository                 │
│  config/config.js has __PLACEHOLDERS__      │
│  No real keys ever stored in source         │
└────────────────┬────────────────────────────┘
                 │ push triggers
┌────────────────▼────────────────────────────┐
│           GitHub Actions                    │
│  Reads secrets from encrypted vault         │
│  Injects into config/config.js              │
│  & assets/js/services/firebase.js           │
│  Deploys to GitHub Pages                    │
└────────────────┬────────────────────────────┘
                 │ live site
┌────────────────▼────────────────────────────┐
│           GitHub Pages                      │
│  Real keys present only in deployed build   │
│  Never visible in source control            │
└─────────────────────────────────────────────┘
```

- 🔒 Firebase API key restricted to domain via Google Cloud Console  
- 🛡️ Supabase Row Level Security (RLS) enforced on all buckets  
- 🔑 All secrets in GitHub Encrypted Secrets — never in code  
- 👤 Role-based access: `viewer` → `editor` → `admin` → `super_admin`  
- 🚫 Auth guard on every dashboard page — unauthenticated users redirect to login  

---

## 🚀 Deployment

The app deploys automatically via **GitHub Actions** on every push to `main`.

```bash
Push to main
    ↓
GitHub Actions triggered
    ↓
Secrets injected into:
  • config/config.js
  • assets/js/services/firebase.js
    ↓
Deployed to GitHub Pages
    ↓
Live in ~60 seconds
```

**Required GitHub Secrets** (Settings → Secrets → Actions):

| Secret | Description |
|---|---|
| `FIREBASE_API_KEY` | Firebase project API key |
| `FIREBASE_AUTH_DOMAIN` | e.g. `project.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `FIREBASE_APP_ID` | Firebase app ID |
| `SUPER_ADMIN_EMAIL` | Email that always has super admin access |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |

**Live URL:**
```
https://dakshkohli23.github.io/Diecast-Trackings/login.html
```

---

## 🛠️ Local Development

No build tools required — pure static files.

```bash
# 1. Clone the repo
git clone https://github.com/dakshkohli23/Diecast-Trackings.git
cd Diecast-Trackings

# 2. Create your local config (gitignored)
cp config/config.js.example config/config.js
# → Edit config/config.js with your real Firebase & Supabase keys

# 3. Serve locally (any static server works)
npx serve .
# or
python3 -m http.server 8080
# or use VS Code Live Server extension

# 4. Open in browser
open http://localhost:8080/login.html
```

> ⚠️ ES Modules require a server — opening `index.html` directly as a `file://` URL will fail.

---

## 🏗️ Architecture: How Each Page Works

Every dashboard page follows the same pattern:

```js
// 1. Inject sidebar + topbar HTML components
await injectComponents();

// 2. Guard authentication — redirect to login if not signed in
const { user, role } = await requireAuth();

// 3. Boot shared shell (sidebar toggle, topbar dropdown, toast)
initSidebar();
initTopbarDropdown(user);
applyRoleVisibility(role);   // hides admin-only nav items

// 4. Load page-specific data from Firestore
const orders = await fetchOrders();

// 5. Render page content
renderAll(orders);
```

**Shared modules:**

| Module | Purpose |
|---|---|
| `services/firebase.js` | Single Firebase + Supabase init — import `db`, `auth`, `supabaseClient` |
| `auth/auth-guard.js` | `requireAuth()` — returns `{user, role, isSuperAdmin}` or redirects |
| `auth/logout.js` | `logout()` — signs out and redirects |
| `pages/dashboard-shell.js` | Sidebar, topbar dropdown, global search, toast, avatar sync |

---

## 📱 Install as App (PWA)

PreTrack works as a native-like app on any device:

| Platform | How to Install |
|---|---|
| **Android Chrome** | Tap 3-dot menu → *Install app* |
| **iPhone Safari** | Tap Share → *Add to Home Screen* |
| **Desktop Chrome** | Click install icon in address bar |

Launches fullscreen, no browser bar, feels native.

---

## 🧭 Navigation Map

```
MAIN
├── Dashboard        — Stats, widgets, greeting bar, activity feed
├── Collection       — Order grid (add / edit / delete / view)
├── Catalog          — Read-only browse with image grid
├── Brands           — Brand cards + drill-down panel
├── Sellers          — Vendor cards + drill-down panel
├── Add Order        — Dedicated full-page add form
└── Calendar         — ETA calendar with urgency color-coding

REPORTS
└── Analytics        — Spend charts, brand leaderboard, seller overview

WORKFLOW
└── Upcoming         — Overdue / this week / this month / all pending

SYSTEM
├── Payments         — Per-order payment table + Quick Pay
├── Users            — User management (admin only)
├── Access Requests  — Review & approve access (admin only)
├── Settings         — Export CSV, clear cache, PWA install, danger zone
└── Profile          — Edit display name, change avatar, change password
```

---

## 🧬 Philosophy

<div align="center">

```
COLLECT  →  TRACK  →  UNDERSTAND  →  CONTROL
```

Built for one collector. Designed to scale.  
One file per concern. Every page owns its logic.

</div>

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f0c1e,50:7c5cfc,100:0f0c1e&height=120&section=footer&text=PreTrack%20v5.0&fontSize=20&fontColor=c4b5fd&fontAlignY=65"/>

<br/>

<img src="https://img.shields.io/badge/Made%20with-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black"/>
<img src="https://img.shields.io/badge/Powered%20by-Firebase-FF6F00?style=flat-square&logo=firebase&logoColor=white"/>
<img src="https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-7c5cfc?style=flat-square&logo=github&logoColor=white"/>
<img src="https://img.shields.io/badge/Built%20for-Diecast%20Collectors-5b3fd4?style=flat-square"/>

</div>
