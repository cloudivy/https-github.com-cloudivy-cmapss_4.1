/**
 * tracedMaintenanceAgent.js
 *
 * Wraps streamMaintenance() from maintenanceAgent.js with a Langfuse span
 * so streaming progress is recorded and the final work-order length is
 * captured as span output.
 *
 * Falls back gracefully when Langfuse is not configured.
 */

import { streamMaintenance } from './maintenanceAgent.js'

/**
 * @param {string}   apiKey        - OpenAI API key
 * @param {object}   engine        - Engine record from ENGINES
 * @param {string}   diagnosisText - Output of Diagnosis Agent
 * @param {function} onChunk       - Streaming callback (chunk string)
 * @param {object}   parentTrace   - Langfuse trace or no-op stub
 * @returns {Promise<string>} Full maintenance plan text
 */
export async function streamMaintenanceWithTracing(
  apiKey, engine, diagnosisText, onChunk, parentTrace
) {
  const span = parentTrace.span({
    name:  'maintenance-agent',
    input: {
      engine_id:        engine.id,
      engine_name:      engine.name,
      diagnosis_length: diagnosisText.length,
    },
  })

  try {
    let charsSoFar = 0

    const maintenanceText = await streamMaintenance(apiKey, engine, diagnosisText, chunk => {
      charsSoFar += chunk.length
      onChunk(chunk)

      // Log a streaming checkpoint every ~500 characters
      if (charsSoFar % 500 < chunk.length) {
        span.event({
          name:  'streaming-checkpoint',
          input: { chars_streamed: charsSoFar },
        })
      }
    })

    span.end({
      output: {
        maintenance_length: maintenanceText.length,
      },
    })

    return maintenanceText
  } catch (error) {
    span.end({
      output: { error: error.message },
      level:  'ERROR',
    })
    throw error
  }
}
