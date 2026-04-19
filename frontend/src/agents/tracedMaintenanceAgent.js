// Traced Maintenance Agent — wraps maintenanceAgent with Langfuse span tracing
// =============================================================================
// The underlying streamMaintenance() is NOT modified.
// This wrapper adds observability only.
//
// If no parentTrace is supplied the function falls back to the untraced
// original so that the app continues to work without a Langfuse key.

import { streamMaintenance } from './maintenanceAgent.js'

/**
 * streamMaintenanceWithTracing
 *
 * @param {string}   apiKey        — OpenAI API key
 * @param {object}   engine        — engine object from ENGINES data
 * @param {string}   diagnosisText — output from Diagnosis Agent
 * @param {Function} onChunk       — streaming callback (same as streamMaintenance)
 * @param {object}   parentTrace   — Langfuse trace object (optional)
 * @returns {string} maintenance work-order text
 */
export async function streamMaintenanceWithTracing(
  apiKey,
  engine,
  diagnosisText,
  onChunk,
  parentTrace,
) {
  // ── No tracing if Langfuse is not configured ──────────────────────────────
  if (!parentTrace) {
    return streamMaintenance(apiKey, engine, diagnosisText, onChunk)
  }

  const span = parentTrace.span({
    name:  'maintenance_agent',
    input: {
      engine_id:        engine.id,
      engine_name:      engine.name,
      rul:              engine.rul,
      diagnosis_length: diagnosisText.length,
    },
  })

  try {
    let charsStreamed = 0

    const result = await streamMaintenance(apiKey, engine, diagnosisText, (chunk) => {
      charsStreamed += chunk.length
      onChunk(chunk)
    })

    span.end({
      output: {
        maintenance_length: result.length,
        chars_streamed:     charsStreamed,
      },
    })

    return result
  } catch (error) {
    span.end({
      output: { error: error.message },
      level:  'ERROR',
    })
    throw error
  }
}
