/**
 * tracedDriftValidator.js
 *
 * Wraps validateDrift() from driftAgent.js with a Langfuse span.
 * Each SFS signal and IGS signal is logged as a named span event,
 * and the final SFS / IGS / ASI scores are recorded as span output.
 *
 * Falls back gracefully when Langfuse is not configured.
 */

import { validateDrift } from './driftAgent.js'

/**
 * @param {object} engine          - Engine record from ENGINES
 * @param {string} diagnosisText   - Output of Diagnosis Agent
 * @param {string} maintenanceText - Output of Maintenance Agent
 * @param {array}  kbCallLog       - KB query audit trail from Diagnosis Agent
 * @param {object} parentTrace     - Langfuse trace or no-op stub
 * @returns {object} driftResult (same shape as validateDrift output)
 */
export function validateDriftWithTracing(
  engine, diagnosisText, maintenanceText, kbCallLog, parentTrace
) {
  const span = parentTrace.span({
    name:  'drift-validator',
    input: {
      engine_id:          engine.id,
      kb_call_count:      kbCallLog.length,
      diagnosis_length:   diagnosisText.length,
      maintenance_length: maintenanceText.length,
    },
  })

  try {
    const driftResult = validateDrift(engine, diagnosisText, maintenanceText, kbCallLog)

    // Log individual SFS signals (Diagnosis Agent grounding checks)
    if (driftResult.agent2?.signals) {
      driftResult.agent2.signals.forEach(signal => {
        span.event({
          name:   `sfs-signal-${signal.id}-${signal.name}`,
          input:  { signal_id: signal.id, signal_name: signal.name, passed: signal.passed },
          output: { score: signal.score, detail: signal.detail },
        })
      })
    }

    // Log individual IGS signals (Maintenance Agent coordination checks)
    if (driftResult.agent3?.signals) {
      driftResult.agent3.signals.forEach(signal => {
        span.event({
          name:   `igs-signal-${signal.id}-${signal.name}`,
          input:  { signal_id: signal.id, signal_name: signal.name, passed: signal.passed },
          output: { score: signal.score, detail: signal.detail },
        })
      })
    }

    span.end({
      output: {
        sfs_score:      driftResult.SFS,
        igs_score:      driftResult.IGS,
        asi_score:      driftResult.ASI,
        drift_detected: !driftResult.passed,
        verdict:        driftResult.verdict,
      },
      level: driftResult.ASI >= 0.75 ? 'DEFAULT' : 'WARNING',
    })

    return driftResult
  } catch (error) {
    span.end({
      output: { error: error.message },
      level:  'ERROR',
    })
    throw error
  }
}
