/**
 * PreTrack — Firebase & Supabase Service
 * Reads config from window.__PRETRACK_CONFIG__ set by config/config.js
 * Supabase is lazy-initialised — only created when image upload is needed.
 */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const _cfg = window.__PRETRACK_CONFIG__ || {};

if (!_cfg.firebase?.apiKey) {
  console.error('PreTrack: Firebase config missing. Check config/config.js is loaded.');
}

const firebaseConfig = {
  apiKey:            _cfg.firebase?.apiKey            || '',
  authDomain:        _cfg.firebase?.authDomain        || '',
  projectId:         _cfg.firebase?.projectId         || '',
  storageBucket:     _cfg.firebase?.storageBucket     || '',
  messagingSenderId: _cfg.firebase?.messagingSenderId || '',
  appId:             _cfg.firebase?.appId             || '',
};

export const firebaseApp   = initializeApp(firebaseConfig);
export const auth          = getAuth(firebaseApp);
export const db            = getFirestore(firebaseApp);
export const secondaryApp  = initializeApp(firebaseConfig, 'secondary');
export const secondaryAuth = getAuth(secondaryApp);

export const SUPER_ADMIN       = _cfg.superAdmin      || '';
export const SUPABASE_URL      = _cfg.supabase?.url   || '';
export const SUPABASE_ANON_KEY = _cfg.supabase?.anonKey || '';
export const SUPABASE_BUCKET   = 'order-images';

/* ── Lazy Supabase — only inits when image upload/delete is called ── */
let _supabase = null;
async function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to config/config.js');
  }
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm");
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

export async function uploadImageToSupabase(file) {
  const client = await getSupabase();
  const ext    = file.name.split('.').pop() || 'jpg';
  const path   = `orders/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage.from(SUPABASE_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadAvatarToSupabase(file, uid) {
  const client = await getSupabase();
  const ext    = file.name.split('.').pop() || 'jpg';
  const path   = `avatars/${uid}.${ext}`;
  await client.storage.from(SUPABASE_BUCKET).remove([path]);
  const { error } = await client.storage.from(SUPABASE_BUCKET).upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });
  if (error) throw new Error(`Avatar upload failed: ${error.message}`);
  const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return data.publicUrl + '?t=' + Date.now();
}

export async function deleteImageFromSupabase(imageUrl) {
  if (!imageUrl || !SUPABASE_URL || !imageUrl.includes(SUPABASE_URL)) return;
  const client   = await getSupabase();
  const marker   = `/object/public/${SUPABASE_BUCKET}/`;
  const idx      = imageUrl.indexOf(marker);
  if (idx === -1) return;
  const filePath = decodeURIComponent(imageUrl.slice(idx + marker.length).split('?')[0]);
  const { error } = await client.storage.from(SUPABASE_BUCKET).remove([filePath]);
  if (error) console.warn('Supabase delete failed:', error.message);
}
