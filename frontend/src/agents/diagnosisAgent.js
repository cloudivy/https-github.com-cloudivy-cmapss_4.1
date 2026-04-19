// Diagnosis Agent — Autonomous KB-Grounded Diagnosis
// =====================================================
// ARCHITECTURE CHANGE from previous version:
//
//   BEFORE: LLM received KB thresholds in system prompt + breach flags in sensor report
//           → LLM narrated a pre-computed answer (not truly autonomous)
//
//   NOW:    LLM receives raw sensor values ONLY (no thresholds, no breach flags)
//           → LLM calls query_kb() tool to retrieve KB thresholds on demand
//           → LLM compares actual sensor values against retrieved KB thresholds
//           → LLM derives fault mode, priority, and procedure from KB responses
//           → Drift validator checks: did LLM reason correctly from what KB returned?
//
// This makes drift detection genuinely meaningful:
//   - Agent 2 ASI = C_sem (did LLM use KB-aligned fault vocabulary in its output?)
//   - The kbCallLog shows exactly which queries were made and in what order
//   - A future extension could score drift at the reasoning step level, not just output
//
// Returns: { diagnosisText: string, kbCallLog: array }
//   kbCallLog is passed to App.jsx for display and could extend drift scoring.

import OpenAI from 'openai'
import { DIAGNOSIS_SYSTEM_PROMPT } from '../data/engines.js'
import { queryKB, buildKBToolDefinition } from './kbQueryTool.js'

export async function streamDiagnosis(apiKey, engine, sensorReport, onChunk, langfuseTracer = null) {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })

  // ── Agent receives ONLY raw sensor values — NO thresholds, NO breach flags ──
  // sensorReport is now stripped of fault conclusions (see sensorAgent.js)
  // The agent must call query_kb() to discover what the thresholds are.
  const userMsg = `Engine: ${engine.name} (${engine.id})
Dataset: NASA CMAPSS ${engine.subset}
Cycle: ${engine.cycle} | RUL: ${engine.rul} cycles
Anomaly Score: ${engine.anomalyScore}/100 [${engine.anomalyLevel}]

${sensorReport}

Use the query_kb tool to retrieve KB thresholds and diagnose this engine.`

  const messages = [
    { role: 'system', content: DIAGNOSIS_SYSTEM_PROMPT },
    { role: 'user',   content: userMsg },
  ]

  // ── Start Langfuse generation span for this agent ─────────────────────────
  const langfuseGen = langfuseTracer
    ? langfuseTracer.startDiagnosisGeneration(messages)
    : null

  const tools        = [buildKBToolDefinition()]
  let full           = ''
  let kbCallLog      = []   // every KB query the agent makes
  let continueLoop   = true
  let iterationCount = 0
  const MAX_ITER     = 12   // safety cap on tool-use loop

  // ── Agentic tool-use loop ──────────────────────────────────────────────────
  // Iteration pattern:
  //   1. Agent calls query_kb (all_thresholds for HPC_DEG)
  //   2. Agent calls query_kb (all_thresholds for FAN_DEG)
  //   3. Agent calls query_kb (RUL → priority)
  //   4. Agent calls query_kb (FAULT_PRIORITY → procedure)
  //   5. Agent produces final diagnosis text
  while (continueLoop && iterationCount < MAX_ITER) {
    iterationCount++

    const response = await client.chat.completions.create({
      model:       'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',      // agent decides when to query vs when to respond
      max_tokens:  800,
      temperature: 0.2,
    })

    const choice  = response.choices[0]
    const message = choice.message

    // ── Agent is calling the KB tool ────────────────────────────────────────
    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push(message)  // add assistant message to conversation history

      for (const toolCall of message.tool_calls) {
        let args
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch {
          args = { sensor: 'unknown', fault_type: 'HPC_DEG' }
        }

        // Execute KB query — pure deterministic JS, no LLM
        const result = queryKB(args.sensor, args.fault_type)

        // Log every KB interaction for drift analysis and UI display
        kbCallLog.push({
          iteration: iterationCount,
          query:     args,
          result,
          timestamp: Date.now(),
        })

        // Build a human-readable label for the UI streaming preview
        const queryLabel =
          args.fault_type === 'all_thresholds' ? `All ${args.sensor} thresholds`
          : args.fault_type === 'priority'     ? 'RUL → Priority rules'
          : args.fault_type === 'procedure'    ? `Procedure for ${args.sensor}`
          : `${args.sensor} threshold (${args.fault_type})`

        const resultSummary = result.error
          ? `⚠️ ${result.error}`
          : result.thresholds
          ? `${result.thresholds.length} thresholds retrieved`
          : result.rules
          ? `${result.rules.length} priority rules retrieved`
          : result.procedureId
          ? `Procedure: ${result.procedureId}`
          : result.rule || 'Retrieved'

        // Stream KB query step to UI so user sees agent reasoning live
        onChunk(full + `\n\n🔍 **KB Query ${kbCallLog.length}:** ${queryLabel}\n→ *${resultSummary}*`)

        // Return KB result to agent as tool response
        messages.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          content:      JSON.stringify(result),
        })
      }
      // Loop continues — agent reasons on KB results and may query again

    // ── Agent finished — produced final diagnosis text ──────────────────────
    } else if (choice.finish_reason === 'stop') {
      const finalText = message.content || ''
      // Clear the streaming KB query preview, show final diagnosis
      full = finalText
      onChunk(full)
      continueLoop = false

      // End the Langfuse generation with the final output + token usage
      if (langfuseGen) {
        const usage = response.usage
        langfuseGen.end(full, response.model, usage)
      }

    // ── Unexpected finish (length, content_filter etc.) ─────────────────────
    } else {
      continueLoop = false
    }
  }

  // Record all KB tool calls as child spans in Langfuse
  if (langfuseTracer) langfuseTracer.recordKBCalls(kbCallLog)

  return { diagnosisText: full, kbCallLog }
}
