// Langfuse custom evaluators for the CMAPSS agent pipeline
// ================================================================
// These functions are called after a trace completes to score the
// quality of each pipeline run.  They are pure JS — no LLM calls.
//
// Usage:
//   import { runEvaluators } from '../lib/langfuseEvaluators'
//   runEvaluators(trace, { drift, kbCallLog, diagnosisText, maintenanceText })

/**
 * sfs_score — Semantic Fidelity Score sent as a Langfuse score.
 * Pass threshold: SFS >= 0.75
 */
export function evaluateSFS(trace, drift) {
  const score = drift?.SFS ?? 0
  trace.score({
    name:    'sfs_score',
    value:   score,
    comment: score >= 0.75 ? 'High KB fidelity' : 'Low KB fidelity — semantic drift detected',
  })
}

/**
 * igs_score — Inter-Agent Grounding Score sent as a Langfuse score.
 * Pass threshold: IGS >= 0.75
 */
export function evaluateIGS(trace, drift) {
  const score = drift?.IGS ?? 0
  trace.score({
    name:    'igs_score',
    value:   score,
    comment: score >= 0.75 ? 'Strong agent coordination' : 'Weak coordination — agent drift detected',
  })
}

/**
 * asi_score — Agent Stability Index sent as a Langfuse score.
 * Pass threshold: ASI >= 0.75
 */
export function evaluateASI(trace, drift) {
  const score = drift?.ASI ?? 0
  trace.score({
    name:    'asi_score',
    value:   score,
    comment: score >= 0.75 ? 'Stable agent pipeline' : '⚠️ Drift detected — ASI below threshold (τ=0.75)',
  })
}

/**
 * kb_grounding_quality — Scores how well the diagnosis agent used the KB.
 * Optimal range: 3–5 queries.  Score = min(1, kbCallCount / 3).
 */
export function evaluateKBGrounding(trace, kbCallLog) {
  const kbCallCount  = kbCallLog?.length ?? 0
  const optimalLower = 3
  const score        = Math.min(1, kbCallCount / optimalLower)
  trace.score({
    name:    'kb_grounding_quality',
    value:   score,
    comment: `Diagnosis agent made ${kbCallCount} KB queries (optimal: 3–5)`,
  })
}

/**
 * agent_coordination — Binary check: did maintenance address the diagnosed fault?
 * 1.0 = maintenance addressed the fault; 0.0 = coordination drift.
 */
export function evaluateAgentCoordination(trace, drift) {
  const faultMatched = drift?.agent3?.signals?.some(
    s => s.id === 'IGS-1' && s.passed
  ) ?? false
  trace.score({
    name:    'agent_coordination',
    value:   faultMatched ? 1.0 : 0.0,
    comment: faultMatched
      ? 'Maintenance plan addressed diagnosed fault'
      : 'Coordination drift — maintenance did not address diagnosed fault',
  })
}

/**
 * cost_per_asi — Efficiency metric: ASI / estimated_cost.
 * Higher is better (more stability per dollar).
 * estimated_cost is approximate based on token count (placeholder = 0.01 per run).
 */
export function evaluateCostPerASI(trace, drift, estimatedCostUSD = 0.01) {
  const asi   = drift?.ASI ?? 0
  const score = estimatedCostUSD > 0 ? asi / estimatedCostUSD : 0
  trace.score({
    name:    'cost_per_asi',
    value:   score,
    comment: `ASI ${asi.toFixed(3)} / $${estimatedCostUSD.toFixed(4)} estimated cost`,
  })
}

/**
 * kb_call_audit — Verify that the KB audit trail is present and non-empty.
 * 1.0 = audit exists; 0.0 = no audit trail (agent may have skipped KB).
 */
export function evaluateKBCallAudit(trace, kbCallLog) {
  const hasAudit = Array.isArray(kbCallLog) && kbCallLog.length > 0
  trace.score({
    name:    'kb_call_audit',
    value:   hasAudit ? 1.0 : 0.0,
    comment: hasAudit
      ? `Audit trail verified — ${kbCallLog.length} KB call(s) recorded`
      : 'No KB audit trail — agent did not call query_kb before diagnosing',
  })
}

/**
 * runEvaluators — convenience wrapper that runs all evaluators in one call.
 *
 * @param {object} trace       — Langfuse trace object
 * @param {object} drift       — result from validateDrift()
 * @param {Array}  kbCallLog   — KB query audit trail from diagnosisAgent
 */
export function runEvaluators(trace, { drift, kbCallLog = [] }) {
  if (!trace) return

  evaluateSFS(trace, drift)
  evaluateIGS(trace, drift)
  evaluateASI(trace, drift)
  evaluateKBGrounding(trace, kbCallLog)
  evaluateAgentCoordination(trace, drift)
  evaluateCostPerASI(trace, drift)
  evaluateKBCallAudit(trace, kbCallLog)
}
