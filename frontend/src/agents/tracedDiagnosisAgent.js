/**
 * tracedDiagnosisAgent.js
 *
 * Wraps streamDiagnosis() from diagnosisAgent.js with a Langfuse span so
 * every KB query and streaming checkpoint is recorded in the trace.
 *
 * Falls back gracefully when Langfuse is not configured (parentTrace is a
 * no-op stub with the same interface).
 */

import { streamDiagnosis } from './diagnosisAgent.js'

/**
 * @param {string}   apiKey       - OpenAI API key
 * @param {object}   engine       - Engine record from ENGINES
 * @param {string}   sensorReport - Output of generateSensorReport()
 * @param {function} onChunk      - Streaming callback (chunk string)
 * @param {object}   parentTrace  - Langfuse trace or no-op stub
 * @returns {Promise<{diagnosisText: string, kbCallLog: array}>}
 */
export async function streamDiagnosisWithTracing(
  apiKey, engine, sensorReport, onChunk, parentTrace
) {
  const span = parentTrace.span({
    name:  'diagnosis-agent',
    input: {
      engine_id:          engine.id,
      engine_name:        engine.name,
      rul:                engine.rul,
      anomaly_score:      engine.anomalyScore,
      sensor_report_size: sensorReport.length,
    },
  })

  try {
    let charsSoFar = 0

    const result = await streamDiagnosis(apiKey, engine, sensorReport, chunk => {
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

    const { diagnosisText, kbCallLog = [] } = result

    // Log every KB query the Diagnosis Agent made as a named span event
    kbCallLog.forEach((call, idx) => {
      const q = call.query || {}
      const label =
        q.fault_type === 'all_thresholds' ? `All ${q.sensor} thresholds`
        : q.fault_type === 'priority'     ? 'RUL → Priority rules'
        : q.fault_type === 'procedure'    ? `Procedure for ${q.sensor}`
        : `${q.sensor} (${q.fault_type})`

      span.event({
        name:   `kb-query-${idx + 1}`,
        input:  { query: q, iteration: call.iteration, label },
        output: { result: call.result },
      })
    })

    span.end({
      output: {
        diagnosis_length: diagnosisText.length,
        kb_call_count:    kbCallLog.length,
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
