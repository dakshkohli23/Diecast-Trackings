// PreTrack Runtime Config
// Fallback if GitHub Actions secret injection fails.
// Protected by Firebase domain restriction on Google Cloud Console.
window.__PRETRACK_CONFIG__ = {
  firebase: {
    apiKey:            "__FIREBASE_API_KEY__",
    authDomain:        "__FIREBASE_AUTH_DOMAIN__",
    projectId:         "__FIREBASE_PROJECT_ID__",
    storageBucket:     "__FIREBASE_STORAGE_BUCKET__",
    messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
    appId:             "__FIREBASE_APP_ID__"
  },
  superAdmin: "__SUPER_ADMIN_EMAIL__",
  supabase: {
    url:     "__SUPABASE_URL__",
    anonKey: "__SUPABASE_ANON_KEY__"
  }
};
