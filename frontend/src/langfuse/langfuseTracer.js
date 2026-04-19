// Langfuse Tracer — Evaluation & Observability for the CMAPSS Agent Pipeline
// ===========================================================================
// Wraps each pipeline run in a Langfuse trace with:
//   - A span per agent step (Sensor, Diagnosis, Maintenance, Drift Validator)
//   - A generation node per GPT-4o call (Diagnosis + Maintenance)
//   - A nested span per autonomous KB tool call made by the Diagnosis Agent
//   - Three numeric scores sent after each run: SFS, IGS, ASI
//
// Usage:
//   import { initLangfuse, createPipelineTrace, ... } from './langfuseTracer.js'
//
//   initLangfuse({ publicKey, secretKey, baseUrl })
//
//   const tracer = createPipelineTrace(engine)
//   const diagCtx = tracer.startDiagnosisGeneration(messages)
//   diagCtx.end(diagnosisText, model, usage)
//   tracer.recordKBCall(kbCallLog)
//   const maintCtx = tracer.startMaintenanceGeneration(messages)
//   maintCtx.end(maintenanceText, model, usage)
//   tracer.sendScores(driftResult)
//   await tracer.flush()

import Langfuse from 'langfuse'

// ── Module-level singleton ────────────────────────────────────────────────────
let _client = null

/**
 * Initialise (or re-initialise) the Langfuse client.
 * Safe to call multiple times — re-creates the client when credentials change.
 *
 * @param {object} opts
 * @param {string} opts.publicKey  Langfuse public key  (pk-lf-…)
 * @param {string} opts.secretKey  Langfuse secret key  (sk-lf-…)
 * @param {string} [opts.baseUrl]  Langfuse host — defaults to cloud
 */
export function initLangfuse({ publicKey, secretKey, baseUrl }) {
  _client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: baseUrl || 'https://cloud.langfuse.com',
    // Flush promptly so scores arrive before the user navigates away
    flushAt:       1,
    flushInterval: 500,
  })
}

/**
 * Returns true when the client has been initialised with credentials.
 */
export function isLangfuseEnabled() {
  return _client !== null
}

/**
 * Create a top-level trace for one full pipeline run (one engine analysis).
 * Returns a tracer object whose methods wrap each pipeline step.
 *
 * @param {object} engine  Engine data object from engines.js
 * @returns {PipelineTracer}
 */
export function createPipelineTrace(engine) {
  if (!_client) return _noopTracer()

  const trace = _client.trace({
    name:     'cmapss-agent-pipeline',
    userId:   engine.id,
    input: {
      engineId:     engine.id,
      engineName:   engine.name,
      subset:       engine.subset,
      cycle:        engine.cycle,
      rul:          engine.rul,
      anomalyScore: engine.anomalyScore,
      anomalyLevel: engine.anomalyLevel,
      faultMode:    engine.faultMode,
    },
    metadata: {
      dataset:    'NASA CMAPSS FD001',
      framework:  'Multi-Agent AI — SFS + IGS Drift Validation',
    },
    tags: ['cmapss', engine.faultMode, engine.anomalyLevel],
  })

  // ── Sensor Agent span ─────────────────────────────────────────────────────
  let _sensorSpan = null

  function startSensorStep(sensorReport) {
    _sensorSpan = trace.span({
      name:  'sensor-agent',
      input: { engineId: engine.id, cycle: engine.cycle, rul: engine.rul },
    })
    _sensorSpan.end({ output: { sensorReport } })
  }

  // ── Diagnosis Agent generation ────────────────────────────────────────────
  let _diagGen   = null
  let _diagStart = null

  function startDiagnosisGeneration(messages) {
    _diagStart = Date.now()
    _diagGen   = trace.generation({
      name:      'diagnosis-agent',
      model:     'gpt-4o',
      input:     messages,
      startTime: new Date(_diagStart),
      metadata:  { agentType: 'agentic-kb-loop' },
    })

    return {
      /**
       * @param {string}  outputText   Final diagnosis text
       * @param {string}  model        Model name reported by API
       * @param {object}  [usage]      { promptTokens, completionTokens, totalTokens }
       */
      end(outputText, model, usage) {
        if (!_diagGen) return
        _diagGen.end({
          output:  outputText,
          model:   model || 'gpt-4o',
          endTime: new Date(),
          usage: usage ? {
            input:  usage.prompt_tokens     || usage.promptTokens     || 0,
            output: usage.completion_tokens || usage.completionTokens || 0,
            total:  usage.total_tokens      || usage.totalTokens      || 0,
          } : undefined,
        })
      },
    }
  }

  // ── KB tool-call spans (one per entry in kbCallLog) ───────────────────────
  function recordKBCalls(kbCallLog) {
    if (!kbCallLog || !_diagGen) return

    for (const entry of kbCallLog) {
      const kbSpan = trace.span({
        name:      'kb-query',
        parentObservationId: _diagGen.id,
        input:     entry.query,
        startTime: new Date(entry.timestamp),
        metadata:  { iteration: entry.iteration },
      })
      kbSpan.end({
        output:  entry.result,
        endTime: new Date(entry.timestamp + 1), // deterministic, ~instant
      })
    }
  }

  // ── Maintenance Agent generation ──────────────────────────────────────────
  let _maintGen = null

  function startMaintenanceGeneration(messages) {
    _maintGen = trace.generation({
      name:      'maintenance-agent',
      model:     'gpt-4o',
      input:     messages,
      startTime: new Date(),
      metadata:  { agentType: 'streaming' },
    })

    return {
      end(outputText, model, usage) {
        if (!_maintGen) return
        _maintGen.end({
          output:  outputText,
          model:   model || 'gpt-4o',
          endTime: new Date(),
          usage: usage ? {
            input:  usage.prompt_tokens     || usage.promptTokens     || 0,
            output: usage.completion_tokens || usage.completionTokens || 0,
            total:  usage.total_tokens      || usage.totalTokens      || 0,
          } : undefined,
        })
      },
    }
  }

  // ── Drift Validator span + scores ─────────────────────────────────────────
  function sendDriftResults(driftResult) {
    if (!driftResult) return

    // Span for the deterministic drift validator step
    const driftSpan = trace.span({
      name:  'drift-validator',
      input: {
        diagFault:    driftResult.diagFault,
        diagPriority: driftResult.diagPriority,
      },
    })
    driftSpan.end({
      output: {
        ASI:        driftResult.ASI,
        SFS:        driftResult.SFS,
        IGS:        driftResult.IGS,
        driftScore: driftResult.driftScore,
        verdict:    driftResult.verdict,
      },
    })

    // Attach scores to the trace for Langfuse evaluation view
    _client.score({ traceId: trace.id, name: 'SFS', value: driftResult.SFS,
      comment: `Semantic Fidelity Score — ${driftResult.agent2.verdict}` })

    _client.score({ traceId: trace.id, name: 'IGS', value: driftResult.IGS,
      comment: `Inter-Agent Grounding Score — ${driftResult.agent3.verdict}` })

    _client.score({ traceId: trace.id, name: 'ASI', value: driftResult.ASI,
      comment: `Agent Stability Index — ${driftResult.verdict} (τ=0.75)` })

    _client.score({ traceId: trace.id, name: 'DriftScore', value: driftResult.driftScore / 100,
      comment: `Drift score 0=grounded 1=full drift — ${driftResult.driftScore}/100` })

    // Per-signal scores for fine-grained evaluation
    for (const sig of driftResult.agent2.signals) {
      _client.score({ traceId: trace.id, name: sig.id, value: sig.score,
        comment: sig.agentDid })
    }
    for (const sig of driftResult.agent3.signals) {
      _client.score({ traceId: trace.id, name: sig.id, value: sig.score,
        comment: sig.agentDid })
    }

    // Update trace output with the final results
    trace.update({ output: {
      ASI:       driftResult.ASI,
      SFS:       driftResult.SFS,
      IGS:       driftResult.IGS,
      verdict:   driftResult.verdict,
      diagFault: driftResult.diagFault,
    }})
  }

  // ── Flush all buffered events to Langfuse ─────────────────────────────────
  async function flush() {
    try {
      await _client.flushAsync()
    } catch (_) {
      // Non-fatal — tracing should never break the main pipeline
    }
  }

  return {
    traceId: trace.id,
    startSensorStep,
    startDiagnosisGeneration,
    recordKBCalls,
    startMaintenanceGeneration,
    sendDriftResults,
    flush,
  }
}

// ── No-op tracer returned when Langfuse is disabled ──────────────────────────
// All methods are safe no-ops so callers need no guard clauses.
function _noopTracer() {
  const noop    = () => {}
  const noopCtx = { end: noop }
  return {
    traceId:                    null,
    startSensorStep:            noop,
    startDiagnosisGeneration:   () => noopCtx,
    recordKBCalls:              noop,
    startMaintenanceGeneration: () => noopCtx,
    sendDriftResults:           noop,
    flush:                      async () => {},
  }
}
