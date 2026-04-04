// Drift Validator — KB Grounding Framework
// Based on: Rath (2026) "Agent Drift: Quantifying Behavioral Degradation
//           in Multi-Agent LLM Systems Over Extended Interactions"
//
// DESIGN PRINCIPLE:
//   Agent outputs are NOT re-diagnosed here.
//   Instead we check two things:
//
//   SFS (Semantic Fidelity Score) — Agent 2 only
//   "Did Agent 2's output stay faithful to what it retrieved from the KB?"
//   Three deterministic signals using kbCallLog audit trail:
//     SFS-1: Did agent query KB before diagnosing?
//     SFS-2: Did agent mention sensors it actually queried?
//     SFS-3: Did agent cite a KB standard in output?
//
//   IGS (Inter-Agent Grounding Score) — Agent 3 only
//   "Did Agent 3 ACT ON Agent 2's specific findings — not just reference them?"
//   Two deterministic signals:
//     IGS-1: Did Agent 3's maintenance ACTIONS address Agent 2's specific fault?
//            (not just "based on" — checks if fault-specific actions appear)
//     IGS-2: Did Agent 3's work order URGENCY reflect Agent 2's priority level?
//            (checks if timing terms match KB priority — 48h, 7 days etc.)
//
//   ASI (Agent Stability Index) = (SFS + IGS) / 2
//   Drift detected when ASI < 0.75 (τ threshold, Rath 2026 §2.2)
//
// WHY IGS IS NOT JUST A PHRASE CHECK:
//   Old approach: check if Agent 3 said "based on" → proves nothing
//   New approach: check if Agent 3's SPECIFIC ACTIONS reflect Agent 2's
//                 SPECIFIC FINDINGS (fault mode + priority level)
//                 This is a behavioral check, not a linguistic check.

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATOR VOCABULARY
// Used ONLY for checking agent output language alignment
// NOT used for fault diagnosis or threshold computation
// ═══════════════════════════════════════════════════════════════════════════════

export const KB = {

  // KB standard citations — check if agent cited sources
  standards: [
    'NASA TM-2008-215546',
    'ISO 13379-1',
    'ISO 13381-1',
    'FAA AC 43.13-1B',
    'SAE JA1012',
    'AGARD-R-785',
    'GE Aviation',
  ],

  // Fault-specific ACTION terms for IGS-1
  // These are the actions Agent 3 MUST take if Agent 2 found that fault
  // If Agent 2 diagnosed HPC_DEG, Agent 3's plan must mention HPC-related actions
  // If Agent 2 diagnosed FAN_DEG, Agent 3's plan must mention fan-related actions
  faultActionTerms: {
    HPC_DEG: [
      'borescope', 'compressor wash', 'compressor inspection',
      'hpc', 'high-pressure compressor', 'compressor blade',
      'compressor fouling', 'blade erosion', 'tip clearance',
    ],
    FAN_DEG: [
      'fan blade', 'fan inspection', 'fan borescope',
      'fan imbalance', 'blade erosion', 'fan rotor',
      'fan speed', 'bypass ratio',
    ],
    NOMINAL: [
      'routine monitoring', 'routine inspection',
      'no immediate action', 'continue monitoring',
      'standard health monitoring',
    ],
  },

  // Priority-specific URGENCY terms for IGS-2
  // These are timing/urgency terms Agent 3 MUST use based on Agent 2's priority
  // If Agent 2 said HIGH priority, Agent 3 must reflect that urgency in its plan
  priorityUrgencyTerms: {
    CRITICAL: [
      'immediate', 'immediately', 'ground immediately',
      'do not fly', 'emergency', 'within 2 hours',
      'immediate grounding', 'engine teardown',
    ],
    HIGH: [
      '48 hour', '48-hour', 'within 48',
      'ground within', 'next maintenance',
      'before next flight', 'urgent',
    ],
    MEDIUM: [
      '7 day', 'seven day', 'within 7',
      'within a week', 'schedule within',
      'shop visit', 'next available',
    ],
    LOW: [
      'routine', 'monitor', 'monitoring',
      'next scheduled', 'preventive',
      'no immediate', '30 day',
    ],
  },

  // Known procedure IDs — used as fallback for IGS cross-check
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

// Extract procedure ID that Agent 2 retrieved from KB
function extractProcedureIdFromKBLog(kbCallLog) {
  for (const entry of kbCallLog) {
    if (entry.result?.procedureId) return entry.result.procedureId
  }
  return null
}

// Extract sensor IDs that Agent 2 actually queried from KB
function extractQueriedSensors(kbCallLog) {
  const sensors = []
  for (const entry of kbCallLog) {
    const s = entry.query?.sensor
    if (s && s.match(/^s\d+$/)) sensors.push(s)
    if (s === 'HPC_DEG') sensors.push(...['s3', 's4', 's7', 's11', 's12'])
    if (s === 'FAN_DEG') sensors.push(...['s8', 's13', 's15'])
  }
  return [...new Set(sensors)]
}

// Extract fault mode that Agent 2 diagnosed from its output text
// We scan for KB fault vocabulary in Agent 2's diagnosis
function extractFaultFromDiagnosis(diagnosisText) {
  const lower = diagnosisText.toLowerCase()

  // Check HPC first (more specific terms)
  const hpcTerms = KB.faultActionTerms.HPC_DEG
  if (hpcTerms.some(t => lower.includes(t))) return 'HPC_DEG'

  // Check FAN
  const fanTerms = KB.faultActionTerms.FAN_DEG
  if (fanTerms.some(t => lower.includes(t))) return 'FAN_DEG'

  return 'NOMINAL'
}

// Extract priority level that Agent 2 stated in its output text
function extractPriorityFromDiagnosis(diagnosisText) {
  const lower = diagnosisText.toLowerCase()

  // Check most severe first
  if (lower.includes('critical') || lower.includes('immediate grounding')) return 'CRITICAL'
  if (lower.includes('high priority') || lower.includes('high severity') ||
      lower.includes('48 hour') || lower.includes('ground within')) return 'HIGH'
  if (lower.includes('medium') || lower.includes('moderate') ||
      lower.includes('7 day') || lower.includes('schedule within')) return 'MEDIUM'
  if (lower.includes('low priority') || lower.includes('routine monitoring')) return 'LOW'

  return null  // Agent 2 did not state a clear priority
}

// ═══════════════════════════════════════════════════════════════════════════════
// SFS — Semantic Fidelity Score (Agent 2 — Diagnosis)
//
// Measures: Did Agent 2's output stay faithful to what it retrieved from KB?
// Uses kbCallLog audit trail — no re-diagnosis.
//
// SFS = (signal_1 + signal_2 + signal_3) / 3  → 0.0 to 1.0
// ═══════════════════════════════════════════════════════════════════════════════

export function computeSFS(diagnosisText, kbCallLog) {
  const diagLower = (diagnosisText || '').toLowerCase()

  // ── SFS-1: Did agent query KB before diagnosing? ──────────────────────────
  const queriedKB = kbCallLog.length > 0
  const s1        = queriedKB ? 1.0 : 0.0

  // ── SFS-2: Did agent mention sensors it actually queried? ─────────────────
  const queriedSensors   = extractQueriedSensors(kbCallLog)
  const mentionedSensors = queriedSensors.filter(s => diagLower.includes(s))
  const s2 = queriedSensors.length > 0
    ? clamp(mentionedSensors.length / queriedSensors.length)
    : 0.0

  // ── SFS-3: Did agent cite a KB standard? ──────────────────────────────────
  const citedStandards = containsAny(diagnosisText, KB.standards)
  const s3             = citedStandards.length > 0 ? 1.0 : 0.0

  const SFS = (s1 + s2 + s3) / 3

  return {
    metric:   'SFS',
    fullName: 'Semantic Fidelity Score',
    score:    Math.round(SFS * 1000) / 1000,
    passed:   SFS >= 0.5,
    signals: [
      {
        id:        'SFS-1',
        name:      'KB Query Audit',
        passed:    s1 === 1.0,
        score:     s1,
        driftType: 'semantic',
        source:    'kbCallLog audit trail',
        kbFact:    'Agent must query KB at least once before diagnosing',
        agentDid:  s1 === 1.0
          ? `Agent made ${kbCallLog.length} KB query(s) before diagnosing`
          : 'Agent produced diagnosis without querying KB',
        detail: s1 === 1.0
          ? `KB audit confirmed — ${kbCallLog.length} query(s) logged`
          : 'No KB queries found in audit trail — diagnosis not KB-grounded',
      },
      {
        id:        'SFS-2',
        name:      'Queried Sensor Citation',
        passed:    s2 >= 0.5,
        score:     s2,
        driftType: 'semantic',
        source:    'kbCallLog cross-reference',
        kbFact:    `Agent retrieved thresholds for [${queriedSensors.join(', ')}] — these must appear in diagnosis`,
        agentDid:  queriedSensors.length > 0
          ? `Agent mentioned ${mentionedSensors.length}/${queriedSensors.length} queried sensors: [${mentionedSensors.join(', ') || 'none'}]`
          : 'No specific sensors found in kbCallLog',
        detail: s2 >= 0.5
          ? `Agent cited ${mentionedSensors.length} of ${queriedSensors.length} KB-queried sensors`
          : `Agent queried [${queriedSensors.join(', ')}] from KB but only mentioned [${mentionedSensors.join(', ') || 'none'}] in output`,
      },
      {
        id:        'SFS-3',
        name:      'KB Standard Citation',
        passed:    s3 === 1.0,
        score:     s3,
        driftType: 'semantic',
        source:    'KB.standards vocabulary',
        kbFact:    `Agent must cite at least one KB source standard in output`,
        agentDid:  s3 === 1.0
          ? `Agent cited standard(s): "${citedStandards.join('", "')}"`
          : 'Agent did not cite any KB standard',
        detail: s3 === 1.0
          ? `Standard citation found: "${citedStandards.join('", "')}"`
          : `No KB standard cited. Expected one of: ${KB.standards.join(', ')}`,
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
// Measures: Did Agent 3 ACT ON Agent 2's specific findings?
// Not just "did it say based on" — did it actually respond to what Agent 2 found?
//
// IGS-1: Did Agent 3's maintenance ACTIONS address Agent 2's specific fault?
//   → extracts fault from Agent 2 output
//   → checks if Agent 3's plan contains fault-specific action terms
//   → e.g. if Agent 2 said HPC_DEG, Agent 3 must mention borescope/compressor
//
// IGS-2: Did Agent 3's work order URGENCY reflect Agent 2's priority level?
//   → extracts priority from Agent 2 output
//   → checks if Agent 3's plan contains matching urgency/timing terms
//   → e.g. if Agent 2 said HIGH, Agent 3 must mention "48 hours" or "urgent"
//
// IGS = (signal_1 + signal_2) / 2  → 0.0 to 1.0
//
// WHY THIS IS BEHAVIORAL NOT LINGUISTIC:
//   A phrase check ("based on") only proves Agent 3 acknowledged Agent 2.
//   An action check proves Agent 3 actually responded to Agent 2's findings.
//   An agent that says "based on diagnosis, do routine monitoring" for a
//   CRITICAL HPC fault would FAIL IGS-1 and IGS-2 — correctly flagging
//   coordination drift even though it used a handoff phrase.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeIGS(diagnosisText, maintenanceText, kbCallLog) {
  const maintLower = (maintenanceText || '').toLowerCase()

  // ── What did Agent 2 actually find? ──────────────────────────────────────
  // We extract these FROM Agent 2's output text — not from KB re-diagnosis
  const diagFault    = extractFaultFromDiagnosis(diagnosisText)
  const diagPriority = extractPriorityFromDiagnosis(diagnosisText)

  // ── IGS-1: Did Agent 3's ACTIONS address Agent 2's specific fault? ────────
  //
  // Logic:
  //   Agent 2 diagnosed fault X (extracted from its output)
  //   Agent 3 must include actions specific to fault X in its work order
  //   If Agent 3 addresses the WRONG fault or no fault → coordination drift
  //
  // Example of PASS:
  //   Agent 2 said "HPC_DEG confirmed"
  //   Agent 3 mentions "borescope inspection of compressor blades" → ✅
  //
  // Example of FAIL (coordination drift):
  //   Agent 2 said "HPC_DEG confirmed"
  //   Agent 3 only mentions "fan blade inspection" → ❌ wrong fault addressed
  //   Agent 3 says "routine monitoring recommended" → ❌ ignored fault finding

  const faultActionTerms   = KB.faultActionTerms[diagFault] || KB.faultActionTerms.NOMINAL
  const matchedFaultActions = containsAny(maintenanceText, faultActionTerms)
  const s1                  = matchedFaultActions.length > 0 ? 1.0 : 0.0

  // Also check: did Agent 3 address a WRONG fault? (stronger drift signal)
  const wrongFaults         = Object.keys(KB.faultActionTerms).filter(f => f !== diagFault)
  const wrongFaultActions   = wrongFaults.flatMap(f =>
    containsAny(maintenanceText, KB.faultActionTerms[f])
  )
  const addressedWrongFault = wrongFaultActions.length > 0 && matchedFaultActions.length === 0

  const s1Detail = s1 === 1.0
    ? `Agent 3 addressed Agent 2's ${diagFault} finding with fault-specific actions: "${matchedFaultActions.slice(0, 2).join('", "')}"`
    : addressedWrongFault
    ? `COORDINATION DRIFT: Agent 2 diagnosed ${diagFault} but Agent 3 addressed wrong fault (found: "${wrongFaultActions[0]}")`
    : `COORDINATION DRIFT: Agent 2 diagnosed ${diagFault} but Agent 3's plan contains no ${diagFault}-specific actions. Expected one of: [${faultActionTerms.slice(0, 4).join(', ')}]`

  // ── IGS-2: Did Agent 3's URGENCY reflect Agent 2's priority? ─────────────
  //
  // Logic:
  //   Agent 2 stated priority X (extracted from its output)
  //   Agent 3 must use urgency/timing terms matching priority X
  //   If Agent 3 uses wrong urgency → coordination drift
  //
  // Example of PASS:
  //   Agent 2 said "HIGH priority — ground within 48 hours"
  //   Agent 3 says "engine must be grounded within 48 hours" → ✅
  //
  // Example of FAIL (coordination drift):
  //   Agent 2 said "CRITICAL — immediate grounding"
  //   Agent 3 says "schedule maintenance within 7 days" → ❌ wrong urgency
  //   Agent 3 ignores urgency entirely → ❌ coordination drift

  let s2        = 0.0
  let s2Detail  = ''

  if (!diagPriority) {
    // Agent 2 did not state a clear priority — cannot check urgency alignment
    s2       = 0.5   // neutral — not a drift but not confirmed either
    s2Detail = `Agent 2 did not state a clear priority level — urgency alignment cannot be verified`
  } else {
    const urgencyTerms        = KB.priorityUrgencyTerms[diagPriority] || []
    const matchedUrgencyTerms = containsAny(maintenanceText, urgencyTerms)
    s2 = matchedUrgencyTerms.length > 0 ? 1.0 : 0.0

    // Check if Agent 3 used WRONG urgency level
    const wrongPriorities   = Object.keys(KB.priorityUrgencyTerms).filter(p => p !== diagPriority)
    const wrongUrgencyTerms = wrongPriorities.flatMap(p =>
      containsAny(maintenanceText, KB.priorityUrgencyTerms[p])
    )
    const usedWrongUrgency  = wrongUrgencyTerms.length > 0 && matchedUrgencyTerms.length === 0

    s2Detail = s2 === 1.0
      ? `Agent 3 urgency matches Agent 2's ${diagPriority} priority: "${matchedUrgencyTerms.slice(0, 2).join('", "')}"`
      : usedWrongUrgency
      ? `COORDINATION DRIFT: Agent 2 stated ${diagPriority} priority but Agent 3 used wrong urgency: "${wrongUrgencyTerms[0]}"`
      : `COORDINATION DRIFT: Agent 2 stated ${diagPriority} priority but Agent 3's plan has no matching urgency terms. Expected one of: [${urgencyTerms.join(', ')}]`
  }

  const IGS = (s1 + s2) / 2

  return {
    metric:   'IGS',
    fullName: 'Inter-Agent Grounding Score',
    score:    Math.round(IGS * 1000) / 1000,
    passed:   IGS >= 0.5,

    // expose what we extracted from Agent 2 — useful for UI and debugging
    diagFault,
    diagPriority,

    signals: [
      {
        id:        'IGS-1',
        name:      'Fault-Specific Action Check',
        passed:    s1 === 1.0,
        score:     s1,
        driftType: 'coordination',
        source:    'Agent 2 output × Agent 3 actions',
        kbFact:    `Agent 2 diagnosed ${diagFault} — Agent 3 must include ${diagFault}-specific maintenance actions`,
        agentDid:  s1 === 1.0
          ? `Agent 3 included ${diagFault}-specific actions: "${matchedFaultActions.slice(0, 2).join('", "')}"`
          : addressedWrongFault
          ? `Agent 3 addressed wrong fault — ignoring Agent 2's ${diagFault} finding`
          : `Agent 3 did not include any ${diagFault}-specific actions`,
        detail: s1Detail,
        whyMatters: 'An agent that says "based on diagnosis" but recommends wrong/irrelevant actions has not acted on Agent 2 — this is coordination drift',
      },
      {
        id:        'IGS-2',
        name:      'Priority Urgency Alignment',
        passed:    s2 >= 0.75,
        score:     s2,
        driftType: 'coordination',
        source:    'Agent 2 output × Agent 3 urgency terms',
        kbFact:    diagPriority
          ? `Agent 2 stated ${diagPriority} priority — Agent 3 work order must reflect matching urgency`
          : 'Agent 2 did not state a clear priority level',
        agentDid:  s2 === 1.0
          ? `Agent 3 work order urgency matches ${diagPriority} priority`
          : s2 === 0.5
          ? 'Agent 2 priority unclear — urgency alignment unverifiable'
          : `Agent 3 work order urgency does not match Agent 2's ${diagPriority} priority`,
        detail: s2Detail,
        whyMatters: 'An agent that acknowledges a CRITICAL fault but schedules maintenance in 7 days has not acted on Agent 2\'s priority — this is coordination drift',
      },
    ],
    verdict: IGS >= 0.75 ? 'STRONGLY GROUNDED — Agent 3 acted on Agent 2'
           : IGS >= 0.5  ? 'PARTIALLY GROUNDED — incomplete action on Agent 2'
           : 'NOT GROUNDED — Agent 3 did not act on Agent 2 findings',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY
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
// MAIN EXPORT
//
// validateDrift(engine, diagnosisText, maintenanceText, kbCallLog)
//
// kbCallLog — audit trail from diagnosisAgent.js — passed from App.jsx
// No LLM. No re-diagnosis. Fully deterministic.
//
// ASI = (SFS + IGS) / 2
// ═══════════════════════════════════════════════════════════════════════════════

export function validateDrift(engine, diagnosisText, maintenanceText, kbCallLog = []) {

  const sfsResult = computeSFS(diagnosisText, kbCallLog)
  const igsResult = computeIGS(diagnosisText, maintenanceText, kbCallLog)

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

    SFS: sfsResult.score,
    IGS: igsResult.score,

    // what Agent 2 actually found — exposed for UI display
    diagFault:    igsResult.diagFault,
    diagPriority: igsResult.diagPriority,

    driftTypes: {
      semanticDrift:     !sfsResult.passed,
      coordinationDrift: !igsResult.passed,
    },

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

    // step results for UI compatibility
    stepResults: {
      diagnosis: {
        step:           'diagnosis',
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
