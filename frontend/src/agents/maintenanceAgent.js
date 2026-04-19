import OpenAI from 'openai'
import { MAINTENANCE_SYSTEM_PROMPT } from '../data/engines.js'

export async function streamMaintenance(apiKey, engine, diagnosis, onChunk, parentTrace = null) {
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

  // ── Langfuse: open a generation span before streaming ────────────────────
  const lfSpan = parentTrace
    ? parentTrace.generation({
        name:  'maintenance-agent',
        model: 'gpt-4o',
        input: messages,
        metadata: { engineId: engine.id, rul: engine.rul, faultMode: engine.faultMode },
      })
    : null

  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 700,
    temperature: 0.2,
  })

  let full   = ''
  let usage  = null
  for await (const chunk of stream) {
    full += chunk.choices[0]?.delta?.content ?? ''
    onChunk(full)
    if (chunk.usage) usage = chunk.usage
  }

  // ── Langfuse: close the generation with output + usage ───────────────────
  if (lfSpan) {
    lfSpan.end({
      output: full,
      ...(usage && {
        usage: {
          promptTokens:     usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens:      usage.total_tokens,
        },
      }),
    })
  }

  return full
}
