# PreTrack v5 — Complete Setup Guide

This guide walks you through everything: GitHub repo setup, Firebase config, Supabase config, GitHub Secrets, and first deploy.

---

## Prerequisites

- A GitHub account
- A Firebase project (free Spark plan works)
- A Supabase project (free tier works)
- Git installed on your machine

---

## Step 1 — Create the GitHub Repository

1. Go to **github.com → New repository**
2. Name it exactly: `Diecast-Trackings`
3. Set to **Public** (required for free GitHub Pages)
4. Do **not** initialise with README or .gitignore (we have our own)
5. Click **Create repository**

---

## Step 2 — Push the Project Files

```bash
# Clone or unzip the project, then:
cd Diecast-Trackings

git init
git add .
git commit -m "feat: initial PreTrack v5 modular architecture"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/Diecast-Trackings.git
git push -u origin main
```

> Replace `YOUR_USERNAME` with your GitHub username.

---

## Step 3 — Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **GitHub Actions**
3. Click **Save**

That's it — the workflow will deploy automatically on every push.

---

## Step 4 — Firebase Setup

### 4a. Create a Firebase Project

1. Go to **console.firebase.google.com**
2. Click **Add project** → name it (e.g. `diecast-trackings`)
3. Disable Google Analytics (optional) → **Create project**

### 4b. Add a Web App

1. In your Firebase project → click the **`</>`** (Web) icon
2. App nickname: `PreTrack`
3. **Do not** enable Firebase Hosting (we use GitHub Pages)
4. Click **Register app**
5. Copy the config values — you'll need them in Step 6:

```js
apiKey:            "AIza..."
authDomain:        "your-project.firebaseapp.com"
projectId:         "your-project-id"
storageBucket:     "your-project.appspot.com"
messagingSenderId: "123456789"
appId:             "1:123:web:abc..."
```

### 4c. Enable Authentication

1. Firebase console → **Authentication → Get started**
2. Sign-in method tab → **Email/Password → Enable → Save**

### 4d. Create Firestore Database

1. Firebase console → **Firestore Database → Create database**
2. Choose **Start in production mode**
3. Select a region close to you → **Done**

### 4d. Set Firestore Security Rules

Go to **Firestore → Rules** and paste:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Orders — authenticated users can read/write
    match /orders/{orderId} {
      allow read, write: if request.auth != null;
    }

    // Users — authenticated users can read; only owner or admin can write
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    // Access requests — anyone can create; only authenticated can read
    match /access_requests/{reqId} {
      allow create: if true;
      allow read, write: if request.auth != null;
    }

    // Activity feed
    match /activity/{actId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Click **Publish**.

### 4e. Restrict the Firebase API Key (important)

1. Go to **console.cloud.google.com → APIs & Services → Credentials**
2. Click your **Browser key (auto created by Firebase)**
3. Under **Application restrictions** → select **HTTP referrers**
4. Add these referrers:
   ```
   https://YOUR_USERNAME.github.io/*
   http://localhost:*/*
   ```
5. Click **Save**

---

## Step 5 — Supabase Setup

### 5a. Create a Supabase Project

1. Go to **supabase.com → New project**
2. Name: `diecast-trackings` · choose a region · set a strong DB password
3. Wait for the project to finish provisioning (~2 min)

### 5b. Create a Storage Bucket

1. Supabase dashboard → **Storage → New bucket**
2. Name: `order-images`
3. **Public bucket: ON**
4. Click **Save**

### 5c. Set Storage Policies (RLS)

Go to **Storage → Policies** → for the `order-images` bucket, add these policies:

**Policy 1 — Allow authenticated uploads:**
```sql
-- Policy name: allow_authenticated_uploads
CREATE POLICY "allow_authenticated_uploads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'order-images');
```

**Policy 2 — Allow public reads:**
```sql
-- Policy name: allow_public_reads
CREATE POLICY "allow_public_reads"
ON storage.objects FOR SELECT
USING (bucket_id = 'order-images');
```

**Policy 3 — Allow authenticated deletes:**
```sql
-- Policy name: allow_authenticated_deletes
CREATE POLICY "allow_authenticated_deletes"
ON storage.objects FOR DELETE
USING (bucket_id = 'order-images');
```

> Alternatively: enable **Row Level Security OFF** on the bucket for simple personal use.

### 5c. Get Your Supabase Keys

Go to **Settings → API**:
- **Project URL** → e.g. `https://abcxyz.supabase.co`
- **anon / public key** → the long `eyJ...` token

---

## Step 6 — Add GitHub Secrets

This is the most important step. Secrets are injected into the code at deploy time — they are **never stored in the repository**.

1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**
2. Click **New repository secret** for each of the following:

| Secret Name | Where to find it |
|---|---|
| `FIREBASE_API_KEY` | Firebase project settings → `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | Firebase project settings → `authDomain` |
| `FIREBASE_PROJECT_ID` | Firebase project settings → `projectId` |
| `FIREBASE_STORAGE_BUCKET` | Firebase project settings → `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase project settings → `messagingSenderId` |
| `FIREBASE_APP_ID` | Firebase project settings → `appId` |
| `SUPER_ADMIN_EMAIL` | Your email — this account always has super admin access |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public key |

---

## Step 7 — Create Your Admin Account

The app has no public sign-up. You create accounts manually.

**Option A — Use your SUPER_ADMIN_EMAIL directly:**

Firebase Auth automatically lets this email in because it matches `SUPER_ADMIN_EMAIL`. Just:

1. Go to **Firebase console → Authentication → Users → Add user**
2. Enter your email and a strong password
3. Click **Add user**

You can now sign in at your live URL.

**Option B — Create accounts from inside the app:**

Once you're logged in as super admin, go to **Users → Add User** in the dashboard.

---

## Step 8 — Trigger First Deploy

After adding all secrets:

```bash
# Make any small change and push to trigger the workflow
git commit --allow-empty -m "chore: trigger first deploy"
git push
```

Or go to your repo → **Actions → Deploy PreTrack to GitHub Pages → Run workflow**.

Watch the workflow complete in ~60 seconds.

---

## Step 9 — Access Your Dashboard

Your live URL will be:

```
https://YOUR_USERNAME.github.io/Diecast-Trackings/login.html
```

Sign in with the admin account you created in Step 7.

---

## Local Development

No build tools needed. Any static file server works:

```bash
cd Diecast-Trackings

# Option 1 — npx serve
npx serve .

# Option 2 — Python
python3 -m http.server 8080

# Option 3 — VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

For local dev, you need real keys in `config/config.js`. This file is gitignored so your keys stay safe:

```js
// config/config.js  ← already gitignored
window.__PRETRACK_CONFIG__ = {
  firebase: {
    apiKey:            "YOUR_REAL_KEY",
    authDomain:        "your-project.firebaseapp.com",
    projectId:         "your-project-id",
    storageBucket:     "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId:             "1:123:web:abc..."
  },
  superAdmin: "you@email.com",
  supabase: {
    url:     "https://abcxyz.supabase.co",
    anonKey: "eyJ..."
  }
};
```

Then open `http://localhost:8080/login.html`.

> ⚠️ ES Modules won't work over `file://` — you must use a local server.

---

## Firestore Data Structure

PreTrack uses these collections:

```
firestore/
├── orders/           ← All diecast order documents
│   └── {orderId}
│       ├── productName, brand, scale, variant
│       ├── qty, orderDate, eta, status
│       ├── actualPrice, shipping, preorderPrice
│       ├── total, paid, pending
│       ├── vendor, orderNumber, notes
│       ├── imageUrl
│       └── createdAt, updatedAt
│
├── users/            ← User profiles & roles
│   └── {userId}
│       ├── uid, name, email
│       ├── role (viewer | editor | admin | super_admin)
│       ├── status (active | disabled)
│       ├── avatarUrl
│       └── createdAt
│
├── access_requests/  ← Login access requests from login page
│   └── {reqId}
│       ├── name, email, reason
│       ├── status (pending | approved | denied)
│       └── createdAt
│
└── activity/         ← Activity feed entries
    └── {actId}
        ├── type (add | edit | delete | deliver)
        ├── message
        └── timestamp
```

---

## Troubleshooting

**"FAILED: placeholder still in config/config.js"** in GitHub Actions
→ One or more GitHub Secrets are missing. Check Settings → Secrets → Actions and add the missing ones.

**Blank page / JS errors after deploy**
→ Check browser console. Usually means the Firebase config is wrong. Verify your secret values match exactly what's in Firebase project settings.

**Images not uploading**
→ Check Supabase bucket name is exactly `order-images` and the RLS policies are set correctly.

**Login works locally but not on the live site**
→ Your Firebase API key is restricted to the wrong domain. Go to Google Cloud Console → Credentials → add `https://YOUR_USERNAME.github.io/*` to the allowed referrers.

**"Permission denied" when accessing Firestore**
→ Your Firestore security rules don't allow the operation. Re-apply the rules from Step 4d.

**Service worker showing stale content**
→ Go to Settings page in the app → click **Clear Cache**. Or in Chrome DevTools → Application → Service Workers → Unregister.

---

## File Reference

| File | Purpose |
|---|---|
| `config/config.js` | Runtime Firebase & Supabase config (gitignored) |
| `assets/js/services/firebase.js` | All Firebase/Supabase init — import `db`, `auth` from here |
| `assets/js/auth/auth-guard.js` | `requireAuth()` — every dashboard page calls this first |
| `assets/js/pages/dashboard-shell.js` | Sidebar, topbar, toast, global search — shared by all pages |
| `components/sidebar.html` | Sidebar nav markup — fetched and injected by JS at runtime |
| `components/navbar.html` | Topbar markup — fetched and injected by JS at runtime |
| `.github/workflows/deploy.yml` | CI/CD — injects secrets and deploys to GitHub Pages |
| `pwa/sw.js` | Service worker — caches static assets, skips secrets |
| `pwa/manifest.json` | PWA manifest — name, icons, theme colour |
