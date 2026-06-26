/**
 * PreTrack — Firebase & Supabase Service
 * Single source of truth for all backend connections.
 * Import this wherever Firebase or Supabase access is needed.
 */

import { initializeApp }    from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth }          from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore }     from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { createClient }     from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/* ── Config: injected by GitHub Actions, else falls back to config.js ── */
const _cfg = (typeof window !== 'undefined' && window.__PRETRACK_CONFIG__) || {};

const firebaseConfig = {
  apiKey:            "__FIREBASE_API_KEY__"            !== '__FIREBASE_API_KEY__'            ? "__FIREBASE_API_KEY__"            : (_cfg.firebase?.apiKey            || ''),
  authDomain:        "__FIREBASE_AUTH_DOMAIN__"        !== '__FIREBASE_AUTH_DOMAIN__'        ? "__FIREBASE_AUTH_DOMAIN__"        : (_cfg.firebase?.authDomain        || ''),
  projectId:         "__FIREBASE_PROJECT_ID__"         !== '__FIREBASE_PROJECT_ID__'         ? "__FIREBASE_PROJECT_ID__"         : (_cfg.firebase?.projectId         || ''),
  storageBucket:     "__FIREBASE_STORAGE_BUCKET__"     !== '__FIREBASE_STORAGE_BUCKET__'     ? "__FIREBASE_STORAGE_BUCKET__"     : (_cfg.firebase?.storageBucket     || ''),
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__"!== '__FIREBASE_MESSAGING_SENDER_ID__'? "__FIREBASE_MESSAGING_SENDER_ID__": (_cfg.firebase?.messagingSenderId  || ''),
  appId:             "__FIREBASE_APP_ID__"             !== '__FIREBASE_APP_ID__'             ? "__FIREBASE_APP_ID__"             : (_cfg.firebase?.appId             || ''),
};

/* ── Firebase init ── */
export const firebaseApp    = initializeApp(firebaseConfig);
export const auth           = getAuth(firebaseApp);
export const db             = getFirestore(firebaseApp);

/* Secondary app for creating users without signing out current user */
export const secondaryApp   = initializeApp(firebaseConfig, 'secondary');
export const secondaryAuth  = getAuth(secondaryApp);

/* ── Supabase ── */
export const SUPER_ADMIN       = "__SUPER_ADMIN_EMAIL__" !== '__SUPER_ADMIN_EMAIL__' ? "__SUPER_ADMIN_EMAIL__" : (_cfg.superAdmin || 'dlaize@dlaize.com');
export const SUPABASE_URL      = "__SUPABASE_URL__"      !== '__SUPABASE_URL__'      ? "__SUPABASE_URL__"      : (_cfg.supabase?.url     || '');
export const SUPABASE_ANON_KEY = "__SUPABASE_ANON_KEY__" !== '__SUPABASE_ANON_KEY__' ? "__SUPABASE_ANON_KEY__" : (_cfg.supabase?.anonKey  || '');
export const SUPABASE_BUCKET   = 'order-images';
export const supabaseClient    = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── Supabase helpers ── */
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
  const marker = `/object/public/${SUPABASE_BUCKET}/`;
  const idx    = imageUrl.indexOf(marker);
  if (idx === -1) return;
  const filePath = decodeURIComponent(imageUrl.slice(idx + marker.length).split('?')[0]);
  const { error } = await supabaseClient.storage.from(SUPABASE_BUCKET).remove([filePath]);
  if (error) console.warn('Supabase delete failed:', error.message);
}
