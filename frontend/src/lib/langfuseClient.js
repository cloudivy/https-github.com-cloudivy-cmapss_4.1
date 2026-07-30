import { Langfuse } from 'langfuse'

// Langfuse is initialized lazily so the app works even without credentials.
// Set VITE_LANGFUSE_PUBLIC_KEY (and optionally VITE_LANGFUSE_BASE_URL) in
// your .env.local to enable tracing.  When the key is absent every call is
// a no-op stub so the rest of the app is unaffected.

let _client = null

function getClient() {
  if (_client) return _client

  const publicKey = import.meta.env.VITE_LANGFUSE_PUBLIC_KEY
  if (!publicKey) return null

  _client = new Langfuse({
    publicKey,
    baseUrl: import.meta.env.VITE_LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    flushAt: 10,
    flushInterval: 5000,
    // Suppress console noise in production
    debug: import.meta.env.DEV === true,
  })

  return _client
}

// ── Thin wrappers that are safe to call even without a Langfuse key ─────────

export function createTrace(params) {
  const client = getClient()
  if (!client) return createNoopTrace()
  return client.trace(params)
}

export function flushAsync() {
  const client = getClient()
  if (!client) return Promise.resolve()
  return client.flushAsync()
}

// ── No-op trace/span stubs (used when Langfuse is not configured) ────────────

function createNoopSpan() {
  return {
    span:   () => createNoopSpan(),
    event:  () => {},
    score:  () => {},
    end:    () => {},
    update: () => {},
    id:     null,
  }
}

function createNoopTrace() {
  return {
    span:   () => createNoopSpan(),
    event:  () => {},
    score:  () => {},
    end:    () => {},
    update: () => {},
    id:     null,
  }
}

export default { createTrace, flushAsync }
