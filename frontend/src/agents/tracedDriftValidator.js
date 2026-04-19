// Traced Drift Validator — wraps driftAgent.validateDrift with Langfuse tracing
// ==============================================================================
// The underlying validateDrift() is NOT modified.
// This wrapper adds observability:
//   • SFS, IGS, ASI sent as custom Langfuse scores on the parent trace
//   • Individual SFS/IGS signals logged as span events
//
// If no parentTrace is supplied the function falls back to the untraced
// original so that the app continues to work without a Langfuse key.

import { validateDrift } from './driftAgent.js'

/**
 * validateDriftWithTracing
 *
 * @param {object} engine          — engine object from ENGINES data
 * @param {string} diagnosisText   — output from Diagnosis Agent
 * @param {string} maintenanceText — output from Maintenance Agent
 * @param {Array}  kbCallLog       — KB query audit trail from Diagnosis Agent
 * @param {object} parentTrace     — Langfuse trace object (optional)
 * @returns {object} drift result (same shape as validateDrift())
 */
export function validateDriftWithTracing(
  engine,
  diagnosisText,
  maintenanceText,
  kbCallLog,
  parentTrace,
) {
  // ── No tracing if Langfuse is not configured ──────────────────────────────
  if (!parentTrace) {
    return validateDrift(engine, diagnosisText, maintenanceText, kbCallLog)
  }

  const span = parentTrace.span({
    name:  'drift_validator',
    input: {
      engine_id:          engine.id,
      kb_call_count:      kbCallLog.length,
      diagnosis_length:   diagnosisText.length,
      maintenance_length: maintenanceText.length,
    },
  })

  try {
    const drift = validateDrift(engine, diagnosisText, maintenanceText, kbCallLog)

    // ── Send SFS/IGS/ASI as named scores on the root trace ────────────────
    parentTrace.score({ name: 'SFS', value: drift.SFS })
    parentTrace.score({ name: 'IGS', value: drift.IGS })
    parentTrace.score({ name: 'ASI', value: drift.ASI })

    // ── Log SFS signal details as span events ─────────────────────────────
    if (drift.agent2?.signals) {
      drift.agent2.signals.forEach((signal) => {
        span.event({
          name:   `sfs_signal_${signal.id}`,
          input:  { signal_id: signal.id, passed: signal.passed },
          output: { score: signal.score, detail: signal.detail ?? signal.agentDid },
        })
      })
    }

    // ── Log IGS signal details as span events ─────────────────────────────
    if (drift.agent3?.signals) {
      drift.agent3.signals.forEach((signal) => {
        span.event({
          name:   `igs_signal_${signal.id}`,
          input:  { signal_id: signal.id, passed: signal.passed },
          output: { score: signal.score, detail: signal.detail ?? signal.agentDid },
        })
      })
    }

    span.end({
      output: {
        sfs_score:      drift.SFS,
        igs_score:      drift.IGS,
        asi_score:      drift.ASI,
        drift_score:    drift.driftScore,
        verdict:        drift.verdict,
        drift_detected: !drift.passed,
      },
      level: drift.ASI >= 0.75 ? 'DEFAULT' : 'WARNING',
    })

    return drift
  } catch (error) {
    span.end({
      output: { error: error.message },
      level:  'ERROR',
    })
    throw error
  }
}
