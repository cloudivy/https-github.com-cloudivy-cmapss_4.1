// Langfuse Observability Client
// ==============================
// Singleton wrapper that creates one Langfuse instance per session.
// Pass { publicKey, secretKey, host } to init().
// Calling init() again replaces the current instance (key change).

import Langfuse from 'langfuse'

let _client = null

export function initLangfuse({ publicKey, secretKey, host }) {
  _client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: host || 'https://cloud.langfuse.com',
    flushAt: 1,   // send each event immediately (browser context)
    flushInterval: 0,
  })
  return _client
}

export function getLangfuse() {
  return _client
}

export function langfuseReady() {
  return _client !== null
}

export function clearLangfuse() {
  _client = null
}

// ── Convenience: create a trace for one full pipeline run ────────────────────
export function createPipelineTrace(engine) {
  if (!_client) return null
  return _client.trace({
    name:     'cmapss-pipeline',
    userId:   engine.id,
    metadata: {
      engineName:   engine.name,
      subset:       engine.subset,
      cycle:        engine.cycle,
      rul:          engine.rul,
      faultMode:    engine.faultMode,
      anomalyScore: engine.anomalyScore,
      anomalyLevel: engine.anomalyLevel,
    },
    tags: [engine.faultMode, engine.anomalyLevel, engine.subset],
  })
}

// ── Build the Langfuse trace URL for the "View in Langfuse" button ───────────
export function traceUrl(traceId, host) {
  const base = host || 'https://cloud.langfuse.com'
  return `${base}/trace/${traceId}`
}
