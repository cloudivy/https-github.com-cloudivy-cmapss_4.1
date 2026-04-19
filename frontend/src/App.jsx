import { useState, useCallback } from 'react'
import { ENGINES } from './data/engines.js'
import { generateSensorReport } from './agents/sensorAgent.js'
import { streamDiagnosis } from './agents/diagnosisAgent.js'
import { streamMaintenance } from './agents/maintenanceAgent.js'
import { validateDrift, saveRunToMemory, getEngineMemory } from './agents/driftAgent.js'
import { initLangfuse, isLangfuseEnabled, createPipelineTrace } from './langfuse/langfuseTracer.js'
import Sidebar from './components/Sidebar.jsx'
import Chat from './components/Chat.jsx'
import DriftPanel from './components/DriftPanel.jsx'

let msgId = 0
const newId = () => ++msgId

export default function App() {
  const [apiKey, setApiKey]           = useState('')
  const [keyInput, setKeyInput]       = useState('')
  const [messages, setMessages]       = useState([{
    id: newId(), role: 'system',
    content: `👋 Welcome to the **NASA CMAPSS Predictive Maintenance AI** — Autonomous Agent Edition.

Select an engine and click **"Analyse"** to run the full pipeline:

1. 📡 **Sensor Monitor** — reads raw sensor values (no fault flags)
2. 🧠 **Diagnosis Agent (GPT-4o)** — autonomously queries the KB for thresholds, compares values, diagnoses
3. 🔧 **Maintenance Planner (GPT-4o)** — generates work order from KB-grounded diagnosis
4. 📊 **Drift Validator** — measures SFS (Semantic Fidelity) and IGS (Inter-Agent Grounding)

Watch the **🔍 KB Query** steps appear live as the Diagnosis Agent retrieves thresholds autonomously.`,
    streaming: false,
  }])
  const [driftResult, setDriftResult]   = useState(null)
  const [runHistory, setRunHistory]     = useState([])
  const [running, setRunning]           = useState(false)
  const [activeEngine, setActiveEngine] = useState(null)

  // ── Langfuse state ───────────────────────────────────────────────────────
  const [lfPublicKey, setLfPublicKey]   = useState('')
  const [lfSecretKey, setLfSecretKey]   = useState('')
  const [lfBaseUrl, setLfBaseUrl]       = useState('')
  const [lfInput, setLfInput]           = useState({ pub: '', sec: '', url: '' })
  const [lfEnabled, setLfEnabled]       = useState(false)
  const [showLfConfig, setShowLfConfig] = useState(false)

  const applyLangfuseKeys = useCallback(() => {
    if (!lfInput.pub || !lfInput.sec) return
    initLangfuse({ publicKey: lfInput.pub, secretKey: lfInput.sec, baseUrl: lfInput.url || undefined })
    setLfPublicKey(lfInput.pub)
    setLfSecretKey(lfInput.sec)
    setLfBaseUrl(lfInput.url)
    setLfEnabled(true)
    setShowLfConfig(false)
  }, [lfInput])

  // ── Message helpers ──────────────────────────────────────────────────────
  const addMsg = useCallback((role, content, label = '') => {
    const id = newId()
    setMessages(prev => [...prev, { id, role, content, label, streaming: false }])
    return id
  }, [])

  const addStreaming = useCallback((role, label = '') => {
    const id = newId()
    setMessages(prev => [...prev, { id, role, content: '', label, streaming: true }])
    return id
  }, [])

  const updateMsg = useCallback((id, content) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, content } : m))
  }, [])

  const finishMsg = useCallback((id) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streaming: false } : m))
  }, [])

  // ── Run full pipeline for an engine ─────────────────────────────────────
  const analyseEngine = useCallback(async (engine) => {
    if (running) return
    if (!apiKey) { addMsg('system', '⚠️ Please enter your OpenAI API key first.'); return }

    setRunning(true)
    setActiveEngine(engine.id)
    setDriftResult(null)
    setRunHistory(getEngineMemory(engine.id))

    addMsg('user',
      `Analyse engine **${engine.name}** (${engine.id}) — RUL: ${engine.rul} cycles, Score: ${engine.anomalyScore}/100`
    )

    // ── Create Langfuse trace for this pipeline run (no-op if not enabled) ──
    const tracer = createPipelineTrace(engine)

    // ── Step 1 — Sensor Agent (pure JS, instant) ──────────────────────────
    addMsg('agent', '⏳ Running Sensor Monitor…', '📡 Sensor Monitor')
    const sensorReport = generateSensorReport(engine)
    setMessages(prev => {
      const last = [...prev]
      last[last.length - 1] = { ...last[last.length - 1], content: sensorReport }
      return last
    })
    tracer.startSensorStep(sensorReport)

    // ── Step 2 — Diagnosis Agent (agentic KB query loop) ─────────────────
    const diagId = addStreaming('agent', '🧠 Diagnosis Agent (GPT-4o) — Querying KB…')
    let diagnosisText = ''
    let kbCallLog     = []
    try {
      const result  = await streamDiagnosis(apiKey, engine, sensorReport, txt => updateMsg(diagId, txt), tracer)
      diagnosisText = result.diagnosisText
      kbCallLog     = result.kbCallLog || []
      finishMsg(diagId)
    } catch (e) {
      updateMsg(diagId, `❌ API Error: ${e.message}`)
      finishMsg(diagId)
      setRunning(false)
      return
    }

    // ── Step 2b — KB Query Log ────────────────────────────────────────────
    if (kbCallLog.length > 0) {
      const queryLines = kbCallLog.map((c, i) => {
        const q = c.query
        const label =
          q.fault_type === 'all_thresholds' ? `All ${q.sensor} thresholds`
          : q.fault_type === 'priority'     ? 'RUL → Priority rules'
          : q.fault_type === 'procedure'    ? `Procedure for ${q.sensor}`
          : `${q.sensor} (${q.fault_type})`
        const summary = c.result.error          ? `⚠️ ${c.result.error}`
          : c.result.thresholds ? `${c.result.thresholds.length} thresholds`
          : c.result.rules      ? `${c.result.rules.length} rules`
          : c.result.procedureId ? c.result.procedureId
          : 'retrieved'
        return `${i + 1}. **${label}** → ${summary}`
      })
      addMsg('system',
        `🔍 **Autonomous KB Call Log — ${kbCallLog.length} query(s) made by Diagnosis Agent:**\n\n` +
        queryLines.join('\n') +
        `\n\nAgent retrieved these values from the KB before making any diagnostic claim.`,
        '📚 KB Query Log'
      )
    }

    // ── Step 3 — Maintenance Agent (streaming) ────────────────────────────
    const maintId = addStreaming('agent', '🔧 Maintenance Planner (GPT-4o)')
    let maintenanceText = ''
    try {
      maintenanceText = await streamMaintenance(apiKey, engine, diagnosisText, txt => updateMsg(maintId, txt), tracer)
      finishMsg(maintId)
    } catch (e) {
      updateMsg(maintId, `❌ API Error: ${e.message}`)
      finishMsg(maintId)
      setRunning(false)
      return
    }

    // ── Step 4 — Drift Validation ─────────────────────────────────────────
    // kbCallLog passed here — this is the KEY CHANGE
    // driftAgent.js uses kbCallLog as audit trail instead of re-diagnosing
    const drift = validateDrift(engine, diagnosisText, maintenanceText, kbCallLog)
    saveRunToMemory(drift)
    setRunHistory(getEngineMemory(engine.id))
    setDriftResult(drift)

    // ── Send all evaluation scores to Langfuse ────────────────────────────
    tracer.sendDriftResults(drift)
    await tracer.flush()

    // ── Step 4b — SFS Result (Diagnosis Agent) ────────────────────────────
    const sfsIcon = drift.SFS >= 0.75 ? '✅'
      : drift.SFS >= 0.5 ? '🟡' : '🔴'
    addMsg('system',
      `${sfsIcon} **SFS (Semantic Fidelity Score): ${drift.SFS.toFixed(3)} — ${drift.agent2.verdict}**\n\n` +
      drift.agent2.signals.map(s =>
        `${s.passed ? '✅' : '❌'} **${s.name}**\n` +
        `  ${s.agentDid}`
      ).join('\n\n'),
      '📐 SFS — Semantic Fidelity'
    )

    // ── Step 4c — IGS Result (Maintenance Agent) ─────────────────────────
    const igsIcon = drift.IGS >= 0.75 ? '✅'
      : drift.IGS >= 0.5 ? '🟡' : '🔴'
    addMsg('system',
      `${igsIcon} **IGS (Inter-Agent Grounding Score): ${drift.IGS.toFixed(3)} — ${drift.agent3.verdict}**\n\n` +
      drift.agent3.signals.map(s =>
        `${s.passed ? '✅' : '❌'} **${s.name}**\n` +
        `  ${s.agentDid}`
      ).join('\n\n'),
      '🔗 IGS — Inter-Agent Grounding'
    )

    // ── Step 4d — Final ASI Summary ───────────────────────────────────────
    const driftIcon = drift.driftScore === 0 ? '✅'
      : drift.driftScore <= 25 ? '🟡'
      : drift.driftScore <= 50 ? '🟠' : '🔴'
    const langfuseNote = lfEnabled && tracer.traceId
      ? `\n\n🔭 **Langfuse:** Trace \`${tracer.traceId}\` — SFS, IGS, ASI scores sent to Langfuse.`
      : ''
    addMsg('system',
      `${driftIcon} **Overall ASI: ${drift.ASI.toFixed(3)} — ${drift.verdict}**\n\n` +
      `| Metric | Score | Status |\n` +
      `|--------|-------|--------|\n` +
      `| SFS (Semantic Fidelity)    | ${drift.SFS.toFixed(3)} | ${drift.driftTypes.semanticDrift     ? '⚠️ DRIFT' : '✅ OK'} |\n` +
      `| IGS (Inter-Agent Grounding)| ${drift.IGS.toFixed(3)} | ${drift.driftTypes.coordinationDrift ? '⚠️ DRIFT' : '✅ OK'} |\n` +
      `| **ASI (Overall)**          | **${drift.ASI.toFixed(3)}** | **${drift.ASI >= 0.75 ? '✅ STABLE' : '⚠️ DRIFT DETECTED'} (τ=0.75)** |\n\n` +
      `Agent made **${kbCallLog.length} autonomous KB queries** before diagnosing.\n` +
      `See **Drift Panel →** for full breakdown.` +
      langfuseNote,
      '📊 Final ASI Score'
    )

    setRunning(false)
  }, [apiKey, lfEnabled, running, addMsg, addStreaming, updateMsg, finishMsg])

  // ── Handle free-text questions ───────────────────────────────────────────
  const handleQuestion = useCallback(async (question) => {
    if (running || !question.trim()) return
    if (!apiKey) { addMsg('system', '⚠️ Please enter your OpenAI API key first.'); return }

    setRunning(true)
    addMsg('user', question)
    const replyId = addStreaming('agent', '🤖 Assistant')

    try {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
      const stream = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert on the NASA CMAPSS turbofan engine dataset and predictive maintenance. Answer concisely and technically.',
          },
          { role: 'user', content: question },
        ],
        stream: true, max_tokens: 400, temperature: 0.3,
      })
      let full = ''
      for await (const chunk of stream) {
        full += chunk.choices[0]?.delta?.content ?? ''
        updateMsg(replyId, full)
      }
      finishMsg(replyId)
    } catch (e) {
      updateMsg(replyId, `❌ Error: ${e.message}`)
      finishMsg(replyId)
    }
    setRunning(false)
  }, [apiKey, running, addMsg, addStreaming, updateMsg, finishMsg])

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="header-icon">✈️</span>
          <div>
            <h1>NASA CMAPSS Predictive Maintenance</h1>
            <p>Autonomous Multi-Agent AI · GPT-4o KB Tool Calling · SFS + IGS Drift Validation</p>
          </div>
        </div>
        <div className="api-key-box">
          {apiKey ? (
            <div className="key-set">
              <span className="key-dot">🟢</span>
              <span>API Key set</span>
              <button onClick={() => setApiKey('')} className="btn-sm">Change</button>
            </div>
          ) : (
            <div className="key-input-row">
              <input
                type="password"
                placeholder="Enter OpenAI API key…"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && keyInput && setApiKey(keyInput)}
                className="key-input"
              />
              <button
                onClick={() => keyInput && setApiKey(keyInput)}
                className="btn-primary btn-sm"
              >Set Key</button>
            </div>
          )}
          {/* ── Langfuse config toggle ─────────────────────────────────── */}
          <div className="langfuse-config">
            {lfEnabled ? (
              <div className="key-set">
                <span className="key-dot">🔭</span>
                <span>Langfuse on</span>
                <button onClick={() => { setLfEnabled(false); setShowLfConfig(false) }} className="btn-sm">Disable</button>
              </div>
            ) : (
              <button
                onClick={() => setShowLfConfig(v => !v)}
                className="btn-sm"
                title="Enable Langfuse evaluation tracing"
              >🔭 Langfuse</button>
            )}
            {showLfConfig && !lfEnabled && (
              <div className="langfuse-panel">
                <p className="langfuse-panel-title">Langfuse Evaluation</p>
                <input
                  type="password"
                  placeholder="Public key (pk-lf-…)"
                  value={lfInput.pub}
                  onChange={e => setLfInput(v => ({ ...v, pub: e.target.value }))}
                  className="key-input"
                />
                <input
                  type="password"
                  placeholder="Secret key (sk-lf-…)"
                  value={lfInput.sec}
                  onChange={e => setLfInput(v => ({ ...v, sec: e.target.value }))}
                  className="key-input"
                />
                <input
                  type="text"
                  placeholder="Host URL (optional — defaults to cloud)"
                  value={lfInput.url}
                  onChange={e => setLfInput(v => ({ ...v, url: e.target.value }))}
                  className="key-input"
                />
                <button
                  onClick={applyLangfuseKeys}
                  disabled={!lfInput.pub || !lfInput.sec}
                  className="btn-primary btn-sm"
                >Enable</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="main-layout">
        <Sidebar
          engines={ENGINES}
          activeEngine={activeEngine}
          onAnalyse={analyseEngine}
          running={running}
        />
        <div className="chat-area">
          <Chat
            messages={messages}
            onQuestion={handleQuestion}
            running={running}
          />
        </div>
        <DriftPanel result={driftResult} runHistory={runHistory} />
      </div>
    </div>
  )
}
