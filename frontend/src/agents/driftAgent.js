// Drift Validator — KB Grounding Framework
// Based on: Rath (2026) "Agent Drift: Quantifying Behavioral Degradation
//           in Multi-Agent LLM Systems Over Extended Interactions"
//
// DESIGN PRINCIPLE:
//   Agent outputs are NOT re-diagnosed here.
//   Instead, we check whether agents DEMONSTRABLY used the KB.
//   The kbCallLog (audit trail from diagnosisAgent.js) is the ground truth.
//
// Two Metrics (Rath 2026):
//
//   SFS (Semantic Fidelity Score) — Agent 2 only
//   "Did Agent 2's output stay faithful to what it retrieved from the KB?"
//   Checks:
//     1. Did agent query KB before diagnosing?      (kbCallLog.length > 0)
//     2. Did agent mention sensors it queried?      (queried sensor IDs in output)
//     3. Did agent cite a KB standard in output?    (NASA TM / ISO / FAA)
//
//   IGS (Inter-Agent Grounding Score) — Agent 3 only
//   "Did Agent 3 demonstrably ground itself in Agent 2's output?"
//   Checks:
//     1. Did agent use an explicit handoff phrase?  ("based on", "consistent with"...)
//     2. Did agent carry Agent 2's procedure ID?    (exact procedureId in output)
//
//   ASI (Agent Stability Index) — Overall
//   ASI = (SFS + IGS) / 2
//   Drift detected when ASI < 0.75 (threshold τ, Rath 2026 §2.2)
//
// WHY THIS IS NOT RE-DIAGNOSIS:
//   Old D1: computed sensor breaches → derived kbFault → checked if agent agreed
//           (this IS diagnosis — wrong)
//   New SFS: reads kbCallLog → checks if agent's text reflects what it retrieved
//            (this is process quality measurement — correct)

// ═══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE — used ONLY for vocabulary/standard detection
// NOT used for fault diagnosis or threshold computation
// ═══════════════════════════════════════════════════════════════════════════════

export const KB = {

  // KB standard citations — used to check if agent cited sources
  standards: [
    'NASA TM-2008-215546',
    'ISO 13379-1',
    'ISO 13381-1',
    'FAA AC 43.13-1B',
    'SAE JA1012',
    'AGARD-R-785',
    'GE Aviation',
  ],

  // KB fault vocabulary — used to check if agent used KB-aligned terms
  // NOT used to re-diagnose — only to check language alignment
  faultVocab: [
    'hpc_deg', 'fan_deg', 'hpc degradation', 'fan degradation',
    'high-pressure compressor', 'compressor fouling',
    'blade erosion', 'tip clearance', 'nominal',
  ],

  // Inter-agent handoff phrases (Rath 2026 §3.2)
  handoffPhrases: [
    'based on', 'per diagnosis', 'consistent with', 'as diagnosed',
    'the diagnosis indicates', 'identified fault',
    'diagnosis agent', 'sensor report',
  ],

  // Known procedure IDs from KB — used to check Agent 3 carried content
  procedureIds: [
    'cmapss_proc_borescope_001',
    'cmapss_proc_compressor_wash_001',
    'cmapss_proc_fan_inspection_001',
    'routine_monitoring',
  ],
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v))
}

function containsAny(text, terms) {
  const lower = text.toLowerCase()
  return terms.filter(t => lower.includes(t.toLowerCase()))
}

// Extract procedure ID that Agent 2 actually retrieved from KB
// This is what we check Agent 3 carried forward
function extractProcedureIdFromKBLog(kbCallLog) {
  for (const entry of kbCallLog) {
    if (entry.result?.procedureId) return entry.result.procedureId
    // Also check nested thresholds result
    if (entry.query?.fault_type === 'procedure' && entry.result?.procedureId) {
      return entry.result.procedureId
    }
  }
  return null
}

// Extract all sensor IDs that Agent 2 actually queried from KB
function extractQueriedSensors(kbCallLog) {
  const sensors = []
  for (const entry of kbCallLog) {
    const s = entry.query?.sensor
    if (s && s.match(/^s\d+$/)) sensors.push(s)           // e.g. "s3", "s7"
    if (s === 'HPC_DEG') sensors.push(...['s3','s4','s7','s11','s12'])
    if (s === 'FAN_DEG') sensors.push(...['s8','s13','s15'])
  }
  return [...new Set(sensors)]  // deduplicate
}

// ═══════════════════════════════════════════════════════════════════════════════
// SFS — Semantic Fidelity Score (Agent 2 — Diagnosis)
//
// Measures: Did Agent 2's output stay faithful to what it retrieved from KB?
// This is NOT re-diagnosis. We do NOT compute what the correct fault is.
// We only check: did the agent demonstrably use what the KB gave it?
//
// Three deterministic sub-signals:
//   signal_1: Did agent query KB before diagnosing?
//   signal_2: Did agent mention sensors it actually queried from KB?
//   signal_3: Did agent cite a KB standard in its output?
//
// SFS = (signal_1 + signal_2 + signal_3) / 3  → 0.0 to 1.0
// ═══════════════════════════════════════════════════════════════════════════════

export function computeSFS(diagnosisText, kbCallLog) {
  const diagLower = (diagnosisText || '').toLowerCase()

  // ── Signal 1: Did agent query KB before diagnosing? ───────────────────────
  // Source: kbCallLog audit trail from diagnosisAgent.js
  const queriedKB = kbCallLog.length > 0
  const s1        = queriedKB ? 1.0 : 0.0

  const s1Detail = queriedKB
    ? `Agent made ${kbCallLog.length} KB query(s) before diagnosing — audit trail confirmed`
    : `Agent made NO KB queries — diagnosis not grounded in KB (kbCallLog empty)`

  // ── Signal 2: Did agent mention sensors it actually queried from KB? ───────
  // We check if sensor IDs from kbCallLog appear in agent's output text
  // This confirms agent used retrieved thresholds, not its own memory
  const queriedSensors  = extractQueriedSensors(kbCallLog)
  const mentionedSensors = queriedSensors.filter(s => diagLower.includes(s))
  const s2 = queriedSensors.length > 0
    ? clamp(mentionedSensors.length / queriedSensors.length)
    : 0.0

  const s2Detail = queriedSensors.length > 0
    ? `Agent queried thresholds for [${queriedSensors.join(', ')}] from KB. ` +
      `Mentioned in output: [${mentionedSensors.join(', ') || 'none'}] ` +
      `(${mentionedSensors.length}/${queriedSensors.length})`
    : `No specific sensors found in kbCallLog`

  // ── Signal 3: Did agent cite a KB standard in its output? ─────────────────
  // Checks if agent referenced the actual standards the KB is grounded in
  const citedStandards = containsAny(diagnosisText, KB.standards)
  const s3             = citedStandards.length > 0 ? 1.0 : 0.0

  const s3Detail = citedStandards.length > 0
    ? `Agent cited KB standard(s): "${citedStandards.join('", "')}"`
    : `Agent did not cite any KB standard (expected one of: ${KB.standards.join(', ')})`

  // ── SFS Score ─────────────────────────────────────────────────────────────
  const SFS     = (s1 + s2 + s3) / 3
  const passed  = SFS >= 0.5

  return {
    metric:   'SFS',
    fullName: 'Semantic Fidelity Score',
    score:    Math.round(SFS * 1000) / 1000,
    passed,
    signals: [
      {
        id:       'SFS-1',
        name:     'KB Query Audit',
        passed:   s1 === 1.0,
        score:    s1,
        detail:   s1Detail,
        kbFact:   `kbCallLog must contain at least 1 entry (agent must query KB before diagnosing)`,
        agentDid: s1 === 1.0
          ? `Agent queried KB ${kbCallLog.length} time(s) before producing diagnosis`
          : `Agent produced diagnosis without querying KB`,
        driftType: 'semantic',
        source:    'kbCallLog audit trail (diagnosisAgent.js)',
      },
      {
        id:       'SFS-2',
        name:     'Queried Sensor Citation',
        passed:   s2 >= 0.5,
        score:    s2,
        detail:   s2Detail,
        kbFact:   `Agent retrieved thresholds for [${queriedSensors.join(', ')}] — these sensor IDs must appear in diagnosis output`,
        agentDid: s2 >= 0.5
          ? `Agent mentioned ${mentionedSensors.length} of ${queriedSensors.length} queried sensors: [${mentionedSensors.join(', ')}]`
          : `Agent mentioned only ${mentionedSensors.length} of ${queriedSensors.length} queried sensors`,
        driftType: 'semantic',
        source:    'kbCallLog cross-reference',
      },
      {
        id:       'SFS-3',
        name:     'KB Standard Citation',
        passed:   s3 === 1.0,
        score:    s3,
        detail:   s3Detail,
        kbFact:   `Agent must cite at least one KB source standard in its output`,
        agentDid: s3 === 1.0
          ? `Agent cited: "${citedStandards.join('", "')}"`
          : `Agent did not cite any KB standard`,
        driftType: 'semantic',
        source:    'KB.standards vocabulary',
      },
    ],
    verdict: SFS >= 0.75 ? 'HIGH FIDELITY'
           : SFS >= 0.5  ? 'PARTIAL FIDELITY'
           : 'LOW FIDELITY — SEMANTIC DRIFT',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IGS — Inter-Agent Grounding Score (Agent 3 — Maintenance)
//
// Measures: Did Agent 3 demonstrably ground itself in Agent 2's output?
// This is NOT checking if Agent 3 agreed with Agent 2 on fault.
// We only check: did Agent 3 carry specific content from Agent 2?
//
// Two deterministic sub-signals:
//   signal_1: Did Agent 3 use an explicit handoff phrase?
//   signal_2: Did Agent 3 carry Agent 2's KB-retrieved procedure ID?
//
// IGS = (signal_1 + signal_2) / 2  → 0.0 to 1.0
// ═══════════════════════════════════════════════════════════════════════════════

export function computeIGS(diagnosisText, maintenanceText, kbCallLog) {
  const maintLower = (maintenanceText || '').toLowerCase()

  // ── Signal 1: Did Agent 3 use an explicit handoff phrase? ────────────────
  // Checks if Agent 3 explicitly referenced Agent 2's output
  // Required by inter-agent protocol (Rath 2026 §3.2)
  const foundPhrases = containsAny(maintenanceText, KB.handoffPhrases)
  const s1           = foundPhrases.length > 0 ? 1.0 : 0.0

  const s1Detail = foundPhrases.length > 0
    ? `Agent 3 used handoff phrase(s): "${foundPhrases.join('", "')}"`
    : `Agent 3 did not use any inter-agent handoff phrase`

  // ── Signal 2: Did Agent 3 carry Agent 2's procedure ID? ──────────────────
  // We extract the EXACT procedure ID that Agent 2 retrieved from KB
  // then check if Agent 3 used that exact ID in its work order
  // This proves content actually flowed between agents
  const kbProcedureId   = extractProcedureIdFromKBLog(kbCallLog)

  // Also check if procedure ID appears in diagnosis text (Agent 2 output)
  const diagHasProcId   = kbProcedureId
    ? (diagnosisText || '').includes(kbProcedureId)
    : false

  // Agent 3 carries it forward
  const maintHasProcId  = kbProcedureId
    ? maintLower.includes(kbProcedureId.toLowerCase())
    : false

  // Fallback: check if any known procedure ID appears in both
  const fallbackProcIds = KB.procedureIds.filter(id =>
    (diagnosisText || '').toLowerCase().includes(id.toLowerCase()) &&
    maintLower.includes(id.toLowerCase())
  )

  const s2        = (maintHasProcId || fallbackProcIds.length > 0) ? 1.0 : 0.0
  const usedProcId = maintHasProcId
    ? kbProcedureId
    : fallbackProcIds[0] || null

  const s2Detail = s2 === 1.0
    ? `Agent 3 carried procedure ID "${usedProcId}" from Agent 2's KB-grounded diagnosis`
    : kbProcedureId
    ? `Agent 2 retrieved procedure "${kbProcedureId}" from KB but Agent 3 did not reference it`
    : `No KB procedure ID found in Agent 2 output to check against`

  // ── IGS Score ─────────────────────────────────────────────────────────────
  const IGS    = (s1 + s2) / 2
  const passed = IGS >= 0.5

  return {
    metric:   'IGS',
    fullName: 'Inter-Agent Grounding Score',
    score:    Math.round(IGS * 1000) / 1000,
    passed,
    signals: [
      {
        id:       'IGS-1',
        name:     'Explicit Handoff Phrase',
        passed:   s1 === 1.0,
        score:    s1,
        detail:   s1Detail,
        kbFact:   `Inter-agent protocol requires explicit reference to Agent 2 output (Rath 2026 §3.2)`,
        agentDid: s1 === 1.0
          ? `Agent 3 explicitly referenced Agent 2: "${foundPhrases[0]}"`
          : `Agent 3 produced work order without referencing Agent 2 output`,
        driftType: 'coordination',
        source:    'Rath (2026) §3.2',
      },
      {
        id:       'IGS-2',
        name:     'Procedure ID Carry-Forward',
        passed:   s2 === 1.0,
        score:    s2,
        detail:   s2Detail,
        kbFact:   kbProcedureId
          ? `Agent 2 retrieved procedure "${kbProcedureId}" from KB — Agent 3 must reference it`
          : `No KB procedure ID retrieved by Agent 2`,
        agentDid: s2 === 1.0
          ? `Agent 3 referenced procedure ID "${usedProcId}" — content flowed between agents`
          : `Agent 3 did not reference the KB procedure ID from Agent 2's diagnosis`,
        driftType: 'coordination',
        source:    'kbCallLog + Agent 2 output cross-reference',
      },
    ],
    verdict: IGS >= 0.75 ? 'STRONGLY GROUNDED'
           : IGS >= 0.5  ? 'PARTIALLY GROUNDED'
           : 'NOT GROUNDED — COORDINATION DRIFT',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY — localStorage run history
// ═══════════════════════════════════════════════════════════════════════════════

const MEMORY_KEY             = 'cmapss_drift_memory'
const MAX_HISTORY_PER_ENGINE = 5

export function saveRunToMemory(result) {
  try {
    const store = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}')
    if (!store[result.engineId]) store[result.engineId] = []
    store[result.engineId].unshift({ ...result, timestamp: new Date().toISOString() })
    store[result.engineId] = store[result.engineId].slice(0, MAX_HISTORY_PER_ENGINE)
    localStorage.setItem(MEMORY_KEY, JSON.stringify(store))
  } catch (_) {}
}

export function getEngineMemory(engineId) {
  try {
    const store = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}')
    return store[engineId] || []
  } catch (_) { return [] }
}

export function getAllMemory() {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}')
  } catch (_) { return {} }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — Full drift validation
//
// kbCallLog parameter added — this is the audit trail from diagnosisAgent.js
// No LLM used. No re-diagnosis. Fully deterministic.
//
// ASI = (SFS + IGS) / 2
// Drift detected when ASI < 0.75 (τ threshold, Rath 2026 §2.2)
// ═══════════════════════════════════════════════════════════════════════════════

export function validateDrift(engine, diagnosisText, maintenanceText, kbCallLog = []) {

  // ── Compute SFS (Agent 2 — Semantic Fidelity) ─────────────────────────────
  const sfsResult = computeSFS(diagnosisText, kbCallLog)

  // ── Compute IGS (Agent 3 — Inter-Agent Grounding) ─────────────────────────
  const igsResult = computeIGS(diagnosisText, maintenanceText, kbCallLog)

  // ── Overall ASI ───────────────────────────────────────────────────────────
  const ASI        = (sfsResult.score + igsResult.score) / 2
  const driftScore = Math.round((1 - ASI) * 100)

  return {
    engineId:   engine.id,
    rul:        engine.rul,
    driftScore,
    verdict: driftScore === 0  ? 'FULLY GROUNDED'
           : driftScore <= 25  ? 'MINOR DRIFT'
           : driftScore <= 50  ? 'MODERATE DRIFT'
           : 'SIGNIFICANT DRIFT',

    ASI:          Math.round(ASI * 1000) / 1000,
    asiThreshold: 0.75,

    // ── Per-metric scores (your dissertation metrics) ────────────────────────
    SFS: sfsResult.score,   // Semantic Fidelity Score
    IGS: igsResult.score,   // Inter-Agent Grounding Score

    // ── Drift type flags ─────────────────────────────────────────────────────
    driftTypes: {
      semanticDrift:     !sfsResult.passed,
      coordinationDrift: !igsResult.passed,
    },

    // ── Per-agent results ────────────────────────────────────────────────────
    agent2: {
      label:   'Diagnosis Agent (GPT-4o)',
      metric:  'SFS',
      ASI:     sfsResult.score,
      passed:  sfsResult.passed,
      verdict: sfsResult.verdict,
      signals: sfsResult.signals,
    },
    agent3: {
      label:   'Maintenance Planner (GPT-4o)',
      metric:  'IGS',
      ASI:     igsResult.score,
      passed:  igsResult.passed,
      verdict: igsResult.verdict,
      signals: igsResult.signals,
    },

    // ── Step results for UI compatibility ────────────────────────────────────
    stepResults: {
      diagnosis: {
        step:          'diagnosis',
        stepDriftScore: Math.round((1 - sfsResult.score) * 100),
        verdict:        sfsResult.verdict,
        checks:         sfsResult.signals,
      },
      maintenance: {
        step:           'maintenance',
        stepDriftScore: Math.round((1 - igsResult.score) * 100),
        verdict:        igsResult.verdict,
        checks:         igsResult.signals,
      },
    },
  }
}
