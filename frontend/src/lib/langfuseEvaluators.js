/**
 * Custom evaluation / scoring functions for the CMAPSS multi-agent pipeline.
 *
 * These are called inside App.jsx after the full pipeline completes.
 * Each function receives the drift result and the Langfuse trace object,
 * then attaches a named numeric score to the trace so it can be tracked
 * and compared across runs in the Langfuse dashboard.
 *
 * Thresholds follow the spec: pass ≥ 0.75
 */

/**
 * Attach all CMAPSS evaluation scores to a Langfuse trace.
 *
 * @param {object} trace       - Langfuse trace (or no-op stub)
 * @param {object} driftResult - Output of validateDrift()
 * @param {number} kbCallCount - Number of KB queries made by the Diagnosis Agent
 */
export function scoreTrace(trace, driftResult, kbCallCount) {
  if (!trace || !driftResult) return

  const { SFS, IGS, ASI } = driftResult

  // SFS — Semantic Fidelity Score (Diagnosis Agent KB grounding)
  trace.score({
    name:    'sfs_score',
    value:   SFS,
    comment: SFS >= 0.75
      ? 'Diagnosis stayed faithful to KB queries'
      : 'Diagnosis drifted from KB-retrieved thresholds',
  })

  // IGS — Inter-Agent Grounding Score (Maintenance ↔ Diagnosis coordination)
  trace.score({
    name:    'igs_score',
    value:   IGS,
    comment: IGS >= 0.75
      ? 'Maintenance plan acted on diagnosis findings'
      : 'Maintenance plan did not fully address diagnosed fault',
  })

  // ASI — Agent Stability Index (overall)
  trace.score({
    name:    'asi_score',
    value:   ASI,
    comment: ASI >= 0.75 ? 'Agent pipeline stable' : 'Drift detected — pipeline unstable',
  })

  // KB Grounding — how many KB queries the Diagnosis Agent made
  // Score is clamped to [0, 1]: optimal is ≥ 3 queries
  const kbScore = Math.min(1, kbCallCount / 3)
  trace.score({
    name:    'kb_call_count',
    value:   kbScore,
    comment: `Made ${kbCallCount} autonomous KB quer${kbCallCount === 1 ? 'y' : 'ies'} before diagnosing`,
  })

  // Agent Coordination — binary: did Maintenance agent act on Diagnosis findings?
  const coordinationScore = driftResult.driftTypes?.coordinationDrift ? 0 : 1
  trace.score({
    name:    'agent_coordination',
    value:   coordinationScore,
    comment: coordinationScore === 1
      ? 'Maintenance addressed diagnosis fault mode'
      : 'Coordination drift — Maintenance did not align with Diagnosis',
  })

  // Semantic Drift flag — binary pass/fail
  const semanticScore = driftResult.driftTypes?.semanticDrift ? 0 : 1
  trace.score({
    name:    'semantic_fidelity',
    value:   semanticScore,
    comment: semanticScore === 1
      ? 'No semantic drift detected'
      : 'Semantic drift — Diagnosis diverged from KB data',
  })
}
