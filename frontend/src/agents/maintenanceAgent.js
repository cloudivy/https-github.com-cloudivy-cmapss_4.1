import OpenAI from 'openai'
import { MAINTENANCE_SYSTEM_PROMPT } from '../data/engines.js'

export async function streamMaintenance(apiKey, engine, diagnosis, onChunk, langfuseTracer = null) {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })

  const userMsg = `Engine: ${engine.name} (${engine.id})
RUL: ${engine.rul} cycles | Fault: ${engine.faultMode} | Score: ${engine.anomalyScore}/100

## Diagnosis Result
${diagnosis}

Generate the maintenance work order.`

  const messages = [
    { role: 'system', content: MAINTENANCE_SYSTEM_PROMPT },
    { role: 'user',   content: userMsg },
  ]

  // ── Start Langfuse generation span for this agent ─────────────────────────
  const langfuseGen = langfuseTracer
    ? langfuseTracer.startMaintenanceGeneration(messages)
    : null

  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
    max_tokens: 700,
    temperature: 0.2,
  })

  let full = ''
  for await (const chunk of stream) {
    full += chunk.choices[0]?.delta?.content ?? ''
    onChunk(full)
  }

  if (langfuseGen) langfuseGen.end(full, 'gpt-4o')

  return full
}
