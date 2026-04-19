// Langfuse client — singleton initialised once per app session
// ================================================================
// Reads credentials from Vite environment variables (prefix VITE_).
// If keys are not set the client is still created but operates in
// an offline / no-op mode; traces will be logged to the console
// instead of being sent to the cloud.
//
// Required env vars (set in frontend/.env.local):
//   VITE_LANGFUSE_PUBLIC_KEY  — pk_…
//   VITE_LANGFUSE_SECRET_KEY  — sk_…  (optional in browser but needed for flush)
//   VITE_LANGFUSE_BASE_URL    — https://cloud.langfuse.com  (default)

import { Langfuse } from 'langfuse'

const publicKey = import.meta.env.VITE_LANGFUSE_PUBLIC_KEY  || ''
const secretKey = import.meta.env.VITE_LANGFUSE_SECRET_KEY  || ''
const baseUrl   = import.meta.env.VITE_LANGFUSE_BASE_URL    || 'https://cloud.langfuse.com'

const langfuse = new Langfuse({
  publicKey,
  secretKey,
  baseUrl,
  // Flush automatically in the browser; fall back to manual flushAsync() call
  flushAt: 1,
  flushInterval: 0,
})

export default langfuse
