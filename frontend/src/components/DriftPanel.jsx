// DriftPanel — Extended SFS v2 Display
// Shows Tier 1 (Process Fidelity) and Tier 2 (Reasoning Fidelity) separately.
// New signals: SFS-4 (threshold direction), SFS-5 (fault consistency), SFS-6 (priority derivation).
// Based on: Rath (2026), Manakul et al. (2023), Es et al. (2023), Guo et al. (2022)

import { getAllMemory } from '../agents/driftAgent.js'

// ── Colour helpers ─────────────────────────────────────────────────────────
const scoreColor = s => s >= 0.75 ? '#3fb950' : s >= 0.5 ? '#d29922' : '#f85149'
const driftColor = s => s === 0 ? '#3fb950' : s <= 25 ? '#d29922' : s <= 50 ? '#f0883e' : '#f85149'
const scoreIcon  = s => s >= 0.75 ? '✅' : s >= 0.5 ? '🟡' : '🔴'
const pct        = v => `${Math.round(v * 100)}%`

// Tier colours
const TIER1_COLOR = '#185FA5'  // blue — process
const TIER2_COLOR = '#534AB7'  // purple — reasoning

// ── Score Bar ──────────────────────────────────────────────────────────────
function ScoreBar({ value, threshold = 0.75 }) {
  const col = scoreColor(value)
  return (
    <div style={{ position: 'relative', marginBottom: '4px' }}>
      <div className="drift-bar-bg">
        <div className="drift-bar-fill" style={{ width: pct(value), background: col }} />
      </div>
      <div
        style={{
          position: 'absolute', top: '-3px',
          left: `${threshold * 100}%`,
          width: '2px', height: '12px',
          background: '#f0883e', borderRadius: '1px',
        }}
        title={`τ = ${threshold}`}
      />
    </div>
  )
}

// ── Tier Score Bar (coloured by tier) ─────────────────────────────────────
function TierBar({ value, color }) {
  return (
    <div className="drift-bar-bg" style={{ marginBottom: '4px' }}>
      <div className="drift-bar-fill" style={{ width: pct(value), background: color }} />
    </div>
  )
}

// ── Signal Card — handles both old and new signals ─────────────────────────
function SignalCard({ signal }) {
  const tierColor = signal.tier === 2 ? TIER2_COLOR : TIER1_COLOR
  const tierLabel = signal.tier === 2 ? 'Reasoning' : 'Process'

  return (
    <div className={`exp-card ${signal.passed ? 'exp-pass' : 'exp-fail'}`}>
      <div className="exp-card-header">
        <span className="exp-icon">{signal.passed ? '✅' : '❌'}</span>
        <span className="exp-id">{signal.id}</span>
        <span className="exp-name">{signal.name}</span>
        {/* Tier badge */}
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '2px 6px',
          borderRadius: '3px', background: `${tierColor}20`,
          color: tierColor, marginLeft: '2px',
        }}>
          {tierLabel}
        </span>
        <span className={`exp-drift-type exp-drift-${signal.driftType}`}>
          {signal.driftType === 'semantic' ? 'Semantic' : 'Coordination'}
        </span>
      </div>

      <div className="exp-kb-fact">
        <span className="exp-label">Expected:</span> {signal.kbFact}
      </div>
      <div className="exp-agent-claim">
        <span className="exp-label">Agent did:</span> {signal.agentDid}
      </div>

      {/* SFS-4 specific: show per-sensor check results */}
      {signal.id === 'SFS-4' && signal.checks?.length > 0 && (
        <div style={{
          marginTop: '6px',
          background: 'rgba(0,0,0,0.04)',
          borderRadius: '5px',
          padding: '6px 8px',
          fontSize: '10px',
          fontFamily: 'monospace',
        }}>
          {signal.checks.map((c, i) => (
            <div key={i} style={{
              display: 'flex', gap: '6px', marginBottom: '2px',
              color: c.consistent ? '#3fb950' : '#f85149',
            }}>
              <span>{c.consistent ? '✅' : '❌'}</span>
              <span>{c.sensor}: actual={c.actual} {c.operator} {c.threshold}? breach={String(c.breachExpected)}</span>
            </div>
          ))}
        </div>
      )}

      {/* SFS-5 specific: show fault comparison */}
      {signal.id === 'SFS-5' && (
        <div style={{
          marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center',
          fontSize: '11px',
        }}>
          <span style={{ color: '#8b949e' }}>KB evidence:</span>
          <span style={{ fontWeight: 600, color: '#d29922' }}>{signal.kbDerivedFault}</span>
          <span style={{ color: signal.passed ? '#3fb950' : '#f85149' }}>
            {signal.passed ? '→ matches →' : '✗ contradicts ✗'}
          </span>
          <span style={{ fontWeight: 600, color: signal.passed ? '#3fb950' : '#f85149' }}>
            {signal.agentFault}
          </span>
          <span style={{ color: '#8b949e' }}>agent</span>
        </div>
      )}

      {/* SFS-6 specific: show priority comparison */}
      {signal.id === 'SFS-6' && (
        <div style={{
          marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center',
          fontSize: '11px',
        }}>
          <span style={{ color: '#8b949e' }}>KB prescribes:</span>
          <span style={{ fontWeight: 600, color: '#d29922' }}>{signal.kbPriority}</span>
          <span style={{ color: signal.passed ? '#3fb950' : '#f85149' }}>
            {signal.passed ? '→ matches →' : '✗ contradicts ✗'}
          </span>
          <span style={{ fontWeight: 600, color: signal.passed ? '#3fb950' : '#f85149' }}>
            {signal.agentPriority || 'not stated'}
          </span>
          <span style={{ color: '#8b949e' }}>agent</span>
        </div>
      )}

      {!signal.passed && (
        <div className="exp-explanation">
          <span className="exp-label">Drift reason:</span> {signal.detail}
        </div>
      )}

      {/* Literature citation for Tier 2 signals */}
      {signal.tier === 2 && signal.literature && (
        <div style={{
          fontSize: '10px', color: '#8b949e',
          marginTop: '4px', fontStyle: 'italic',
        }}>
          📖 {signal.literature}
        </div>
      )}

      {!signal.passed && signal.whyMatters && (
        <div style={{
          fontSize: '10px', color: '#8b949e',
          marginTop: '4px', fontStyle: 'italic',
        }}>
          💡 {signal.whyMatters}
        </div>
      )}
    </div>
  )
}

// ── SFS Tier Panel ─────────────────────────────────────────────────────────
function SFSTierPanel({ agent2 }) {
  const signals   = agent2.signals || []
  const tier1Sigs = signals.filter(s => s.tier === 1)
  const tier2Sigs = signals.filter(s => s.tier === 2)
  const tier1     = agent2.tier1
  const tier2     = agent2.tier2

  return (
    <div className="agent-drift-block">
      <div className="agent-drift-header">
        <span className="agent-drift-label">🧠 Agent 2 — Diagnosis (GPT-4o)</span>
        <span className="agent-drift-asi" style={{ color: scoreColor(agent2.ASI) }}>
          SFS = {agent2.ASI.toFixed(3)}
        </span>
      </div>
      <ScoreBar value={agent2.ASI} />
      <div style={{ marginTop: '6px', marginBottom: '12px' }}>
        <span style={{ fontSize: '11px', color: scoreColor(agent2.ASI), fontWeight: 600 }}>
          {scoreIcon(agent2.ASI)} {agent2.verdict}
        </span>
      </div>

      {/* ── Tier 1: Process Fidelity ──────────────────────────────────── */}
      <div style={{
        fontSize: '11px', fontWeight: 700, color: TIER1_COLOR,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '6px', marginTop: '4px',
        paddingLeft: '6px', borderLeft: `3px solid ${TIER1_COLOR}`,
      }}>
        Tier 1 — Process Fidelity
        <span style={{ fontWeight: 400, color: '#8b949e', marginLeft: '6px', fontSize: '10px' }}>
          Did agent USE the KB?
        </span>
        {tier1 && (
          <span style={{ float: 'right', fontSize: '11px', color: scoreColor(tier1.score) }}>
            {tier1.score.toFixed(3)}
          </span>
        )}
      </div>
      {tier1 && <TierBar value={tier1.score} color={TIER1_COLOR} />}
      <div style={{ marginBottom: '10px' }}>
        {tier1Sigs.map(s => <SignalCard key={s.id} signal={s} />)}
      </div>

      {/* ── Tier 2: Reasoning Fidelity ────────────────────────────────── */}
      <div style={{
        fontSize: '11px', fontWeight: 700, color: TIER2_COLOR,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: '6px', marginTop: '8px',
        paddingLeft: '6px', borderLeft: `3px solid ${TIER2_COLOR}`,
      }}>
        Tier 2 — Reasoning Fidelity
        <span style={{ fontWeight: 400, color: '#8b949e', marginLeft: '6px', fontSize: '10px' }}>
          Did agent REASON correctly from KB?
        </span>
        {tier2 && (
          <span style={{ float: 'right', fontSize: '11px', color: scoreColor(tier2.score) }}>
            {tier2.score.toFixed(3)}
          </span>
        )}
      </div>
      {tier2 && <TierBar value={tier2.score} color={TIER2_COLOR} />}
      <div style={{ marginBottom: '4px' }}>
        {tier2Sigs.map(s => <SignalCard key={s.id} signal={s} />)}
      </div>
    </div>
  )
}

// ── Coordination Mismatch Panel (unchanged) ────────────────────────────────
function CoordinationMismatchPanel({ result }) {
  if (!result.diagFault && !result.diagPriority) return null

  const igsSignals     = result.agent3?.signals || []
  const faultSignal    = igsSignals.find(s => s.id === 'IGS-1')
  const prioritySignal = igsSignals.find(s => s.id === 'IGS-2')
  const faultMatch     = faultSignal?.passed
  const priorityMatch  = prioritySignal?.passed
  const anyMismatch    = !faultMatch || !priorityMatch

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${anyMismatch ? '#f85149' : '#3fb950'}`,
      borderRadius: '8px', padding: '12px', marginBottom: '4px',
    }}>
      <div style={{
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: anyMismatch ? '#f85149' : '#3fb950',
        marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        {anyMismatch ? '⚠️ Coordination Mismatch Detected' : '✅ Agents Coordinated'}
        <span style={{ fontSize: '9px', color: '#8b949e', fontWeight: 400, textTransform: 'none' }}>
          Agent 3 vs Agent 2 findings
        </span>
      </div>

      {/* Fault row */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '10px', color: '#8b949e', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
          Fault Mode
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr', gap: '6px', alignItems: 'center' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#58a6ff', fontWeight: 700, marginBottom: '3px' }}>🧠 AGENT 2 DIAGNOSED</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: result.diagFault === 'NOMINAL' ? '#3fb950' : '#d29922' }}>
              {result.diagFault || '—'}
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: '14px', color: faultMatch ? '#3fb950' : '#f85149' }}>
            {faultMatch ? '→' : '✗'}
          </div>
          <div style={{ background: 'var(--bg-surface)', border: `1px solid ${faultMatch ? 'var(--border)' : '#f85149'}`, borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#3fb950', fontWeight: 700, marginBottom: '3px' }}>🔧 AGENT 3 ACTED ON</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: faultMatch ? '#3fb950' : '#f85149' }}>
              {faultMatch ? result.diagFault : <span>MISMATCH<br /><span style={{ fontSize: '10px', fontWeight: 400 }}>{faultSignal?.detail || 'No fault-specific actions'}</span></span>}
            </div>
          </div>
        </div>
        {!faultMatch && (
          <div style={{ marginTop: '6px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: '5px', padding: '7px 9px', fontSize: '10px', color: '#f85149', lineHeight: 1.5 }}>
            <strong>⚠️ Coordination Drift:</strong> {faultSignal?.detail}
          </div>
        )}
      </div>

      {/* Priority row */}
      <div>
        <div style={{ fontSize: '10px', color: '#8b949e', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
          Priority / Urgency
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr', gap: '6px', alignItems: 'center' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#58a6ff', fontWeight: 700, marginBottom: '3px' }}>🧠 AGENT 2 STATED</div>
            <div style={{ fontSize: '12px', fontWeight: 700,
              color: result.diagPriority === 'CRITICAL' ? '#f85149' : result.diagPriority === 'HIGH' ? '#f0883e' : result.diagPriority === 'MEDIUM' ? '#d29922' : '#3fb950' }}>
              {result.diagPriority || 'NOT STATED'}
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: '14px', color: priorityMatch ? '#3fb950' : '#f85149' }}>
            {priorityMatch ? '→' : '✗'}
          </div>
          <div style={{ background: 'var(--bg-surface)', border: `1px solid ${priorityMatch ? 'var(--border)' : '#f85149'}`, borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#3fb950', fontWeight: 700, marginBottom: '3px' }}>🔧 AGENT 3 REFLECTED</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: priorityMatch ? '#3fb950' : '#f85149' }}>
              {priorityMatch ? result.diagPriority : <span>MISMATCH<br /><span style={{ fontSize: '10px', fontWeight: 400 }}>Wrong or missing urgency</span></span>}
            </div>
          </div>
        </div>
        {!priorityMatch && result.diagPriority && (
          <div style={{ marginTop: '6px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: '5px', padding: '7px 9px', fontSize: '10px', color: '#f85149', lineHeight: 1.5 }}>
            <strong>⚠️ Coordination Drift:</strong> {prioritySignal?.detail}
          </div>
        )}
        {!result.diagPriority && (
          <div style={{ marginTop: '6px', background: 'rgba(210,153,34,0.08)', border: '1px solid rgba(210,153,34,0.3)', borderRadius: '5px', padding: '7px 9px', fontSize: '10px', color: '#d29922', lineHeight: 1.5 }}>
            ⚠️ Agent 2 did not state a clear priority level
          </div>
        )}
      </div>

      <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border)',
        fontSize: '11px', fontWeight: 600, color: anyMismatch ? '#f85149' : '#3fb950' }}>
        {anyMismatch
          ? `⚠️ Agent 3 did not fully act on Agent 2's findings — IGS = ${result.IGS.toFixed(3)}`
          : `✅ Agent 3 correctly acted on Agent 2's findings — IGS = ${result.IGS.toFixed(3)}`
        }
      </div>
    </div>
  )
}

// ── Memory Log ─────────────────────────────────────────────────────────────
function MemoryLogPanel() {
  const allMemory = getAllMemory()
  const engines   = Object.keys(allMemory)
  if (engines.length === 0) return null

  return (
    <div className="memory-log">
      <div className="memory-log-title">🗂️ Memory Log — All Stored Runs</div>
      {engines.map(engineId => (
        <div key={engineId} className="memory-engine-block">
          <div className="memory-engine-header">{engineId}</div>
          {allMemory[engineId].map((run, i) => {
            const ts = run.timestamp ? new Date(run.timestamp).toLocaleString() : `Run ${i + 1}`
            return (
              <div key={i} className="memory-run-row">
                <div className="memory-run-top">
                  <span className="memory-run-ts">{i === 0 ? '🔵 Latest' : ts}</span>
                  <span className="memory-run-score" style={{ color: driftColor(run.driftScore) }}>
                    {run.driftScore}/100
                  </span>
                  <span className="memory-run-asi">ASI {run.ASI}</span>
                  <span className="memory-run-verdict"
                    style={{ color: driftColor(run.driftScore), fontSize: '9px', fontWeight: 600 }}>
                    {run.verdict}
                  </span>
                </div>
                <div className="memory-run-steps">
                  {run.SFS !== undefined && (
                    <span className="memory-step" style={{ color: scoreColor(run.SFS) }}>
                      📐 SFS: {run.SFS.toFixed(2)}
                    </span>
                  )}
                  {run.sfsTier1 && (
                    <span className="memory-step" style={{ color: TIER1_COLOR, fontSize: '10px' }}>
                      T1: {run.sfsTier1.score.toFixed(2)}
                    </span>
                  )}
                  {run.sfsTier2 && (
                    <span className="memory-step" style={{ color: TIER2_COLOR, fontSize: '10px' }}>
                      T2: {run.sfsTier2.score.toFixed(2)}
                    </span>
                  )}
                  {run.IGS !== undefined && (
                    <span className="memory-step" style={{ color: scoreColor(run.IGS) }}>
                      🔗 IGS: {run.IGS.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Run History ────────────────────────────────────────────────────────────
function RunHistory({ runHistory, engineId }) {
  if (!runHistory || runHistory.length === 0) return null
  return (
    <div className="run-history">
      <div className="run-history-title">Run History — {engineId}</div>
      <div className="run-history-list">
        {runHistory.map((r, i) => {
          const col      = driftColor(r.driftScore)
          const ts       = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : `Run ${runHistory.length - i}`
          const trend    = i < runHistory.length - 1
            ? r.driftScore < runHistory[i + 1].driftScore ? '↓'
            : r.driftScore > runHistory[i + 1].driftScore ? '↑' : '→'
            : '—'
          const trendCol = trend === '↓' ? '#3fb950' : trend === '↑' ? '#f85149' : '#8b949e'
          return (
            <div key={i} className="run-history-row">
              <span className="run-ts">{i === 0 ? '🔵 Latest' : ts}</span>
              <span className="run-score" style={{ color: col }}>{r.driftScore}/100</span>
              <span className="run-asi">ASI {r.ASI}</span>
              {r.SFS !== undefined && (
                <span style={{ fontSize: '10px', color: scoreColor(r.SFS) }}>SFS {r.SFS.toFixed(2)}</span>
              )}
              {r.IGS !== undefined && (
                <span style={{ fontSize: '10px', color: scoreColor(r.IGS) }}>IGS {r.IGS.toFixed(2)}</span>
              )}
              <span className="run-trend" style={{ color: trendCol }}>{trend}</span>
            </div>
          )
        })}
      </div>
      {runHistory.length >= 2 && (() => {
        const delta    = runHistory[0].driftScore - runHistory[1].driftScore
        const trendMsg = delta < 0 ? `↓ Improved by ${Math.abs(delta)} points vs last run`
                       : delta > 0 ? `↑ Increased by ${delta} points vs last run`
                       : '→ No change vs last run'
        const trendCol = delta < 0 ? '#3fb950' : delta > 0 ? '#f85149' : '#8b949e'
        return <div className="run-trend-summary" style={{ color: trendCol }}>{trendMsg}</div>
      })()}
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────
export default function DriftPanel({ result, runHistory = [] }) {

  if (!result) return (
    <aside className="drift-panel">
      <div className="drift-title">📊 Drift Validator</div>
      <div className="drift-empty">
        <p>Drift report appears here after analysis.</p>
        <p className="drift-hint">
          <strong>SFS Tier 1</strong> — Did Agent 2 use the KB? (process)
        </p>
        <p className="drift-hint">
          <strong>SFS Tier 2</strong> — Did Agent 2 reason correctly from KB? (reasoning)
        </p>
        <p className="drift-hint">
          <strong>IGS</strong> — Did Agent 3 act on Agent 2's specific findings?
        </p>
        <p className="drift-hint">
          <strong>ASI</strong> = (SFS + IGS) / 2 — τ = 0.75 (Rath 2026)
        </p>
      </div>
      <MemoryLogPanel />
    </aside>
  )

  const asiColor = scoreColor(result.ASI)
  const driftCol = driftColor(result.driftScore)

  return (
    <aside className="drift-panel">
      <div className="drift-title">📊 Drift Validator</div>
      <div className="drift-engine">{result.engineId}</div>

      {/* ── Overall Drift Score ─────────────────────────────────────────── */}
      <div className="drift-score-section">
        <div className="drift-score-label">Overall Drift Score</div>
        <div className="drift-score-val" style={{ color: driftCol }}>{result.driftScore}/100</div>
        <div className="drift-bar-bg">
          <div className="drift-bar-fill" style={{ width: `${result.driftScore}%`, background: driftCol }} />
        </div>
        <div className="drift-verdict" style={{ color: driftCol }}>
          {result.driftScore === 0 ? '✅' : result.driftScore <= 25 ? '🟡' : result.driftScore <= 50 ? '🟠' : '🔴'} {result.verdict}
        </div>
      </div>

      {/* ── ASI Score ──────────────────────────────────────────────────── */}
      <div className="asi-score-section">
        <div className="asi-score-row">
          <span className="asi-score-label">ASI = (SFS + IGS) / 2</span>
          <span className="asi-score-val" style={{ color: asiColor }}>{result.ASI.toFixed(3)}</span>
        </div>
        <ScoreBar value={result.ASI} threshold={0.75} />
        <div className="asi-threshold-label">
          τ = 0.75 {result.ASI < 0.75 ? '⚠️ DRIFT DETECTED' : '✅ STABLE'}
        </div>
      </div>

      {/* ── Metric Summary ─────────────────────────────────────────────── */}
      <div className="drift-thresholds">
        <div className="drift-thresh-title">Metric Summary (Rath 2026 + v2 extensions)</div>

        {/* SFS row with tier breakdown */}
        <div className="drift-thresh-row">
          <span style={{ width: '40px', fontSize: '11px', fontWeight: 700, color: '#58a6ff' }}>SFS</span>
          <span className="drift-thresh-val" style={{ flex: 1 }}>Semantic Fidelity — Agent 2</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: scoreColor(result.SFS) }}>
            {result.SFS.toFixed(3)}
          </span>
          <span className={`drift-thresh-status ${result.driftTypes.semanticDrift ? 'triggered' : 'ok'}`}
            style={{ marginLeft: '6px' }}>
            {result.driftTypes.semanticDrift ? '⚠️ DRIFT' : '✅ OK'}
          </span>
        </div>

        {/* SFS Tier 1 sub-row */}
        {result.sfsTier1 && (
          <div style={{ paddingLeft: '12px', marginBottom: '2px' }}>
            <div className="drift-thresh-row" style={{ marginBottom: '2px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: TIER1_COLOR, display: 'inline-block', marginRight: '6px', flexShrink: 0 }}></span>
              <span style={{ fontSize: '10px', color: TIER1_COLOR, flex: 1 }}>Tier 1 — Process Fidelity</span>
              <span style={{ fontSize: '10px', fontWeight: 600, color: scoreColor(result.sfsTier1.score) }}>
                {result.sfsTier1.score.toFixed(3)}
              </span>
              <span style={{ fontSize: '9px', color: result.driftTypes.processDrift ? '#f85149' : '#3fb950', marginLeft: '6px' }}>
                {result.driftTypes.processDrift ? '⚠️' : '✅'}
              </span>
            </div>
            <div className="drift-thresh-row">
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: TIER2_COLOR, display: 'inline-block', marginRight: '6px', flexShrink: 0 }}></span>
              <span style={{ fontSize: '10px', color: TIER2_COLOR, flex: 1 }}>Tier 2 — Reasoning Fidelity</span>
              <span style={{ fontSize: '10px', fontWeight: 600, color: scoreColor(result.sfsTier2?.score || 0) }}>
                {result.sfsTier2?.score.toFixed(3) || '—'}
              </span>
              <span style={{ fontSize: '9px', color: result.driftTypes.reasoningDrift ? '#f85149' : '#3fb950', marginLeft: '6px' }}>
                {result.driftTypes.reasoningDrift ? '⚠️' : '✅'}
              </span>
            </div>
          </div>
        )}

        {/* IGS row */}
        <div className="drift-thresh-row">
          <span style={{ width: '40px', fontSize: '11px', fontWeight: 700, color: '#bc8cff' }}>IGS</span>
          <span className="drift-thresh-val" style={{ flex: 1 }}>Inter-Agent Grounding — Agent 3</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: scoreColor(result.IGS) }}>
            {result.IGS.toFixed(3)}
          </span>
          <span className={`drift-thresh-status ${result.driftTypes.coordinationDrift ? 'triggered' : 'ok'}`}
            style={{ marginLeft: '6px' }}>
            {result.driftTypes.coordinationDrift ? '⚠️ DRIFT' : '✅ OK'}
          </span>
        </div>

        {/* ASI row */}
        <div className="drift-thresh-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '6px', marginTop: '4px' }}>
          <span style={{ width: '40px', fontSize: '11px', fontWeight: 700, color: asiColor }}>ASI</span>
          <span className="drift-thresh-val" style={{ flex: 1 }}>Agent Stability Index</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: asiColor }}>{result.ASI.toFixed(3)}</span>
          <span className={`drift-thresh-status ${result.ASI < 0.75 ? 'triggered' : 'ok'}`} style={{ marginLeft: '6px' }}>
            {result.ASI < 0.75 ? '⚠️ DRIFT' : '✅ STABLE'}
          </span>
        </div>
      </div>

      {/* ── Drift Type Flags ────────────────────────────────────────────── */}
      <div className="drift-types-section">
        <div className="drift-types-title">Drift Taxonomy (Rath 2026 §2.3 + v2)</div>
        <div className="drift-type-row">
          <span className={`drift-type-badge ${result.driftTypes.semanticDrift ? 'drift-active' : 'drift-ok'}`}>
            {result.driftTypes.semanticDrift ? '⚠️' : '✅'} Semantic (SFS)
          </span>
          <span className={`drift-type-badge ${result.driftTypes.coordinationDrift ? 'drift-active' : 'drift-ok'}`}>
            {result.driftTypes.coordinationDrift ? '⚠️' : '✅'} Coordination (IGS)
          </span>
        </div>
        {/* New v2 drift subtypes */}
        <div className="drift-type-row" style={{ marginTop: '4px' }}>
          <span className={`drift-type-badge ${result.driftTypes.processDrift ? 'drift-active' : 'drift-ok'}`}
            style={{ fontSize: '9px' }}>
            {result.driftTypes.processDrift ? '⚠️' : '✅'} Process (T1)
          </span>
          <span className={`drift-type-badge ${result.driftTypes.reasoningDrift ? 'drift-active' : 'drift-ok'}`}
            style={{ fontSize: '9px' }}>
            {result.driftTypes.reasoningDrift ? '⚠️' : '✅'} Reasoning (T2)
          </span>
        </div>
      </div>

      {/* ── Coordination Mismatch Panel ─────────────────────────────────── */}
      <div className="asi-categories">
        <div className="asi-categories-title">🔗 Coordination Analysis — Agent 2 → Agent 3</div>
        <div className="asi-formula-note">
          Did Agent 3 act on Agent 2's specific fault and priority findings?
        </div>
        <CoordinationMismatchPanel result={result} />
      </div>

      {/* ── SFS Detail — Agent 2 with Tier breakdown ────────────────────── */}
      <div className="asi-categories">
        <div className="asi-categories-title">📐 SFS — Semantic Fidelity (Agent 2) v2</div>
        <div className="asi-formula-note">
          SFS = (T1: KB queried + sensors cited + standard cited +
          T2: threshold direction + fault consistency + priority derivation) / 6
        </div>
        <SFSTierPanel agent2={result.agent2} />
      </div>

      {/* ── IGS Detail — Agent 3 ────────────────────────────────────────── */}
      <div className="asi-categories">
        <div className="asi-categories-title">🔗 IGS — Inter-Agent Grounding (Agent 3)</div>
        <div className="asi-formula-note">
          IGS = (fault actions matched + priority urgency matched) / 2
        </div>
        <div className="agent-drift-block">
          <div className="agent-drift-header">
            <span className="agent-drift-label">🔧 Agent 3 — Maintenance (GPT-4o)</span>
            <span className="agent-drift-asi" style={{ color: scoreColor(result.IGS) }}>
              IGS = {result.IGS.toFixed(3)}
            </span>
          </div>
          <ScoreBar value={result.IGS} />
          <div style={{ marginTop: '6px', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', color: scoreColor(result.IGS), fontWeight: 600 }}>
              {scoreIcon(result.IGS)} {result.agent3.verdict}
            </span>
          </div>
          {result.agent3.signals?.map(s => <SignalCard key={s.id} signal={s} />)}
        </div>
      </div>

      {/* ── Run History ─────────────────────────────────────────────────── */}
      <RunHistory runHistory={runHistory} engineId={result.engineId} />

      {/* ── Memory Log ──────────────────────────────────────────────────── */}
      <MemoryLogPanel />

      <div className="drift-source">
        SFS v2: T1 Process (SFS-1,2,3) + T2 Reasoning (SFS-4,5,6)<br />
        IGS: Inter-Agent Grounding · ASI: Rath (2026) arXiv:2601.04070 · τ = 0.75<br />
        Manakul (2023) arXiv:2303.08896 · Es (2023) arXiv:2309.15217<br />
        KB: NASA TM-2008-215546 · ISO 13381-1 · FAA AC 43.13-1B
      </div>
    </aside>
  )
}
