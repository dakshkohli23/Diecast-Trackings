/**
 * PreTrack — Firebase & Supabase Service
 * Reads config from window.__PRETRACK_CONFIG__ set by config/config.js
 * which is injected with real secrets by GitHub Actions at deploy time.
 */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { createClient }   from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const _cfg = window.__PRETRACK_CONFIG__ || {};

if (!_cfg.firebase?.apiKey) {
  console.error('PreTrack: Firebase config missing. Check config/config.js is loaded and secrets are injected.');
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

export const SUPER_ADMIN       = _cfg.superAdmin  || '';
export const SUPABASE_URL      = _cfg.supabase?.url     || '';
export const SUPABASE_ANON_KEY = _cfg.supabase?.anonKey || '';
export const SUPABASE_BUCKET   = 'order-images';
export const supabaseClient    = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function uploadImageToSupabase(file) {
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `orders/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabaseClient.storage.from(SUPABASE_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data } = supabaseClient.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadAvatarToSupabase(file) {
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `avatars/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabaseClient.storage.from(SUPABASE_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(`Avatar upload failed: ${error.message}`);
  const { data } = supabaseClient.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteImageFromSupabase(imageUrl) {
  if (!imageUrl || !imageUrl.includes(SUPABASE_URL)) return;
  const marker   = `/object/public/${SUPABASE_BUCKET}/`;
  const idx      = imageUrl.indexOf(marker);
  if (idx === -1) return;
  const filePath = decodeURIComponent(imageUrl.slice(idx + marker.length).split('?')[0]);
  const { error } = await supabaseClient.storage.from(SUPABASE_BUCKET).remove([filePath]);
  if (error) console.warn('Supabase delete failed:', error.message);
}
