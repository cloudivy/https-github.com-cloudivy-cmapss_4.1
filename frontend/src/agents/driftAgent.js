// Drift Validator — KB Grounding Framework
// Based on: Rath (2026) "Agent Drift: Quantifying Behavioral Degradation
//           in Multi-Agent LLM Systems Over Extended Interactions"
//
// ── Extended SFS (v2) ─────────────────────────────────────────────────────
// SFS now has 6 signals split into two tiers:
//
//   TIER 1 — Process Fidelity (did agent USE the KB correctly?)
//     SFS-1: Did agent query KB before diagnosing?          [audit trail]
//     SFS-2: Did agent mention sensors it actually queried? [entity check]
//     SFS-3: Did agent cite a real KB standard?             [attribution]
//
//   TIER 2 — Reasoning Fidelity (did agent REASON correctly from KB?)
//     SFS-4: Threshold Direction Correctness                [Manakul 2023]
//            → For each KB threshold retrieved, does agent's
//              breach conclusion match the actual sensor value?
//     SFS-5: Fault Mode Consistency                         [Es 2023 RAGAS]
//            → Does agent's stated fault match KB-derivable
//              ground truth from retrieved thresholds?
//     SFS-6: Priority Derivation Correctness                [Rath 2026 §3.1]
//            → Does agent's stated priority match KB priority
//              table applied to the engine's actual RUL?
//
//   SFS = (SFS-1 + SFS-2 + SFS-3 + SFS-4 + SFS-5 + SFS-6) / 6
//
// Literature basis:
//   Manakul et al. (2023) SelfCheckGPT — arXiv:2303.08896
//   Es et al. (2023) RAGAS — arXiv:2309.15217
//   Guo et al. (2022) Survey of Hallucination in NLG — ACM Computing Surveys
//   Huang et al. (2023) Cognitive Mirage — arXiv:2311.05232
//   Rath (2026) Agent Drift — arXiv:2601.04070
//
// IGS remains unchanged (2 signals):
//   IGS-1: Fault-Specific Action Check
//   IGS-2: Priority Urgency Alignment
//
//   ASI = (SFS + IGS) / 2  —  drift if ASI < τ (0.75)

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATOR VOCABULARY
// Used ONLY for checking agent output language alignment.
// NOT used for fault diagnosis or threshold computation.
// ═══════════════════════════════════════════════════════════════════════════

export const KB = {

  standards: [
    'NASA TM-2008-215546',
    'ISO 13379-1',
    'ISO 13381-1',
    'FAA AC 43.13-1B',
    'SAE JA1012',
    'AGARD-R-785',
    'GE Aviation',
  ],

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

  // Language that signals a sensor breach in agent output
  breachLanguage: [
    'exceeded', 'exceeds', 'above threshold', 'elevated',
    'below threshold', 'dropped below', 'breach', 'breached',
    'confirmed', 'degradation confirmed', 'fault confirmed',
    'anomalous', 'out of range', 'critical reading',
  ],

  // Language that signals a sensor is normal in agent output
  normalLanguage: [
    'within normal range', 'within range', 'no breach',
    'nominal', 'acceptable', 'normal reading',
    'no fault detected', 'within limits',
  ],

  procedureIds: [
    'cmapss_proc_borescope_001',
    'cmapss_proc_compressor_wash_001',
    'cmapss_proc_fan_inspection_001',
    'routine_monitoring',
  ],
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v))
}

function containsAny(text, terms) {
  const lower = text.toLowerCase()
  return terms.filter(t => lower.includes(t.toLowerCase()))
}

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

function extractFaultFromDiagnosis(diagnosisText) {
  const lower = diagnosisText.toLowerCase()
  const hpcTerms = KB.faultActionTerms.HPC_DEG
  if (hpcTerms.some(t => lower.includes(t))) return 'HPC_DEG'
  const fanTerms = KB.faultActionTerms.FAN_DEG
  if (fanTerms.some(t => lower.includes(t))) return 'FAN_DEG'
  return 'NOMINAL'
}

function extractPriorityFromDiagnosis(diagnosisText) {
  const lower = diagnosisText.toLowerCase()
  if (lower.includes('critical') || lower.includes('immediate grounding')) return 'CRITICAL'
  if (lower.includes('high priority') || lower.includes('high severity') ||
      lower.includes('48 hour') || lower.includes('ground within')) return 'HIGH'
  if (lower.includes('medium') || lower.includes('moderate') ||
      lower.includes('7 day') || lower.includes('schedule within')) return 'MEDIUM'
  if (lower.includes('low priority') || lower.includes('routine monitoring')) return 'LOW'
  return null
}

// ── NEW HELPER: Derive KB priority from RUL (mirrors kbQueryTool.js logic) ─
// Source: ISO 13381-1:2015, SAE JA1012
function deriveKBPriorityFromRUL(rul) {
  if (rul < 10)  return 'CRITICAL'
  if (rul < 30)  return 'HIGH'
  if (rul < 100) return 'MEDIUM'
  return 'LOW'
}

// ── NEW HELPER: Derive KB fault from retrieved thresholds + actual sensor values
// Deterministic re-derivation using kbCallLog — no LLM involved.
// Basis: RAGAS faithfulness — each claim verifiable against retrieved context.
function deriveKBFaultFromCallLog(kbCallLog, engine) {
  for (const entry of kbCallLog) {
    if (!entry.result?.thresholds) continue
    for (const t of entry.result.thresholds) {
      const sensorData = engine.sensors?.[t.sensor]
      if (!sensorData) continue
      const actual   = sensorData.value
      const breached = t.operator === '>'
        ? actual > t.threshold
        : actual < t.threshold
      if (breached) {
        // Return whichever fault type this threshold belongs to
        return entry.result.faultType || 'HPC_DEG'
      }
    }
  }
  return 'NOMINAL'
}

// ── NEW HELPER: Check if agent text is consistent with a sensor breach ──────
// For a given sensor, determine if agent's language around that sensor
// matches the expected breach status.
// Basis: Manakul et al. (2023) SelfCheckGPT consistency check.
function agentBreachClaimConsistent(diagnosisText, sensor, breachExpected) {
  const lower = diagnosisText.toLowerCase()

  // Find sentences that mention this specific sensor
  const sentences = lower.split(/[.!?\n]+/).filter(s => s.includes(sensor))
  if (sentences.length === 0) return null  // sensor not discussed → skip

  // Check language in sentences mentioning this sensor
  const hasBreach = KB.breachLanguage.some(w =>
    sentences.some(s => s.includes(w.toLowerCase()))
  )
  const hasNormal = KB.normalLanguage.some(w =>
    sentences.some(s => s.includes(w.toLowerCase()))
  )

  if (!hasBreach && !hasNormal) return null  // ambiguous → skip

  // Consistent = (breach expected AND agent uses breach language)
  //           OR (no breach expected AND agent uses normal language)
  if (breachExpected) return hasBreach
  return hasNormal
}

// ═══════════════════════════════════════════════════════════════════════════
// SFS-4 — Threshold Direction Correctness
//
// For each KB threshold the agent retrieved, check:
//   Does the agent's textual conclusion about that sensor (breach vs normal)
//   match what the KB threshold actually says when applied to the real value?
//
// Example PASS:
//   KB says s3 > 1592 → breach. Actual s3 = 1594.8 → BREACH.
//   Agent says "s3 exceeded threshold" → ✅ consistent
//
// Example FAIL (reasoning drift):
//   KB says s3 > 1592. Actual s3 = 1590.1 → NO breach.
//   Agent says "s3 is critically elevated" → ❌ hallucinated breach
//
// Basis: Manakul et al. (2023) SelfCheckGPT — arXiv:2303.08896
// ═══════════════════════════════════════════════════════════════════════════

function computeSFS4_ThresholdDirectionCorrectness(diagnosisText, kbCallLog, engine) {
  const checks = []

  for (const entry of kbCallLog) {
    if (!entry.result?.thresholds) continue

    for (const t of entry.result.thresholds) {
      const sensorData = engine.sensors?.[t.sensor]
      if (!sensorData) continue

      const actual        = sensorData.value
      const breachExpected = t.operator === '>'
        ? actual > t.threshold
        : actual < t.threshold

      const consistent = agentBreachClaimConsistent(diagnosisText, t.sensor, breachExpected)

      // Only count sensors where agent actually discussed them
      if (consistent !== null) {
        checks.push({
          sensor:        t.sensor,
          actual,
          threshold:     t.threshold,
          operator:      t.operator,
          breachExpected,
          consistent,
        })
      }
    }
  }

  if (checks.length === 0) {
    // Agent didn't discuss individual sensors clearly — partial credit
    return {
      score:   0.5,
      checks,
      detail:  'No sensor-level breach/normal language found in diagnosis — direction consistency unverifiable',
      passed:  false,
    }
  }

  const correct = checks.filter(c => c.consistent).length
  const score   = clamp(correct / checks.length)
  const failed  = checks.filter(c => !c.consistent)

  return {
    score,
    checks,
    passed: score >= 0.75,
    detail: score >= 0.75
      ? `Agent correctly described ${correct}/${checks.length} sensor breach statuses per KB thresholds`
      : `Reasoning drift: Agent incorrectly described ${failed.length} sensor(s): [${failed.map(c =>
          `${c.sensor} (actual ${c.actual} ${c.operator} ${c.threshold}? ${c.breachExpected})`
        ).join(', ')}]`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SFS-5 — Fault Mode Consistency
//
// Deterministically re-derive the KB-supported fault from the thresholds
// the agent retrieved + the engine's actual sensor values.
// Then compare to what the agent concluded.
//
// This is NOT re-diagnosing — it checks agent's conclusion against
// the evidence it retrieved from KB itself.
//
// Example PASS:
//   Agent queried HPC_DEG thresholds. s3=1594.8 > 1592 → KB supports HPC_DEG.
//   Agent concluded HPC_DEG → ✅
//
// Example FAIL (fault hallucination):
//   Agent queried HPC_DEG thresholds. No threshold actually breached.
//   Agent concluded HPC_DEG anyway → ❌ unsupported by retrieved evidence
//
// Basis: Es et al. (2023) RAGAS faithfulness — arXiv:2309.15217
// ═══════════════════════════════════════════════════════════════════════════

function computeSFS5_FaultModeConsistency(diagnosisText, kbCallLog, engine) {
  const kbDerivedFault = deriveKBFaultFromCallLog(kbCallLog, engine)
  const agentFault     = extractFaultFromDiagnosis(diagnosisText)

  const passed = agentFault === kbDerivedFault
  const score  = passed ? 1.0 : 0.0

  return {
    score,
    passed,
    kbDerivedFault,
    agentFault,
    detail: passed
      ? `Agent fault (${agentFault}) matches KB-derivable fault (${kbDerivedFault}) from retrieved thresholds`
      : `Fault hallucination: KB evidence supports ${kbDerivedFault} but agent concluded ${agentFault}. ` +
        `Agent may have used internal memory instead of retrieved thresholds.`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SFS-6 — Priority Derivation Correctness
//
// Agent queried the RUL priority table from KB (logged in kbCallLog).
// Check: did the agent apply the priority table correctly to the engine's RUL?
//
// Example PASS:
//   Engine RUL = 18. KB table: RUL 10–30 → HIGH priority.
//   Agent stated HIGH priority → ✅
//
// Example FAIL (priority hallucination):
//   Engine RUL = 18. KB table: RUL 10–30 → HIGH priority.
//   Agent stated CRITICAL → ❌ contradicts KB priority table
//
// Basis: Rath (2026) §3.1 — priority misclassification as semantic drift subtype
//        Guo et al. (2022) — intrinsic hallucination = contradicts retrieved source
// ═══════════════════════════════════════════════════════════════════════════

function computeSFS6_PriorityDerivationCorrectness(diagnosisText, kbCallLog, engine) {
  // Check agent queried priority table
  const priorityEntry = kbCallLog.find(e => e.query?.fault_type === 'priority')

  if (!priorityEntry) {
    return {
      score:  0.0,
      passed: false,
      detail: 'Agent did not query the RUL priority table — priority derivation unverifiable. ' +
              'SFS-6 fails because KB priority grounding was skipped.',
    }
  }

  // Derive correct priority from KB rules using engine RUL
  const kbPriority    = deriveKBPriorityFromRUL(engine.rul)
  const agentPriority = extractPriorityFromDiagnosis(diagnosisText)

  if (!agentPriority) {
    return {
      score:  0.5,
      passed: false,
      kbPriority,
      agentPriority: null,
      detail: `Agent queried priority table but did not state a clear priority level in output. ` +
              `KB table prescribes ${kbPriority} for RUL=${engine.rul}.`,
    }
  }

  const passed = agentPriority === kbPriority
  const score  = passed ? 1.0 : 0.0

  return {
    score,
    passed,
    kbPriority,
    agentPriority,
    detail: passed
      ? `Agent priority (${agentPriority}) correctly derived from KB table for RUL=${engine.rul}`
      : `Priority hallucination: KB table prescribes ${kbPriority} for RUL=${engine.rul} ` +
        `but agent stated ${agentPriority}. This contradicts the KB evidence agent retrieved.`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SFS — Semantic Fidelity Score (Agent 2 — Diagnosis)
//
// v2: Extended to 6 signals across two tiers.
//
// IMPORTANT: engine parameter added — required for SFS-4, SFS-5, SFS-6.
// Update call in validateDrift() accordingly.
//
// SFS = (s1 + s2 + s3 + s4 + s5 + s6) / 6  →  0.0 to 1.0
// ═══════════════════════════════════════════════════════════════════════════

export function computeSFS(diagnosisText, kbCallLog, engine) {
  const diagLower = (diagnosisText || '').toLowerCase()

  // ── TIER 1: Process Fidelity ─────────────────────────────────────────────

  // SFS-1: Did agent query KB before diagnosing?
  const queriedKB = kbCallLog.length > 0
  const s1        = queriedKB ? 1.0 : 0.0

  // SFS-2: Did agent mention sensors it actually queried?
  const queriedSensors   = extractQueriedSensors(kbCallLog)
  const mentionedSensors = queriedSensors.filter(s => diagLower.includes(s))
  const s2 = queriedSensors.length > 0
    ? clamp(mentionedSensors.length / queriedSensors.length)
    : 0.0

  // SFS-3: Did agent cite a real KB standard?
  const citedStandards = containsAny(diagnosisText, KB.standards)
  const s3             = citedStandards.length > 0 ? 1.0 : 0.0

  // ── TIER 2: Reasoning Fidelity ───────────────────────────────────────────

  // SFS-4: Threshold direction correctness
  const sfs4 = computeSFS4_ThresholdDirectionCorrectness(diagnosisText, kbCallLog, engine)
  const s4   = sfs4.score

  // SFS-5: Fault mode consistency with KB evidence
  const sfs5 = computeSFS5_FaultModeConsistency(diagnosisText, kbCallLog, engine)
  const s5   = sfs5.score

  // SFS-6: Priority derivation correctness
  const sfs6 = computeSFS6_PriorityDerivationCorrectness(diagnosisText, kbCallLog, engine)
  const s6   = sfs6.score

  const SFS = (s1 + s2 + s3 + s4 + s5 + s6) / 6

  return {
    metric:   'SFS',
    fullName: 'Semantic Fidelity Score',
    score:    Math.round(SFS * 1000) / 1000,
    passed:   SFS >= 0.5,

    // Tier breakdown for UI
    tier1: { label: 'Process Fidelity',   score: Math.round(((s1+s2+s3)/3)*1000)/1000 },
    tier2: { label: 'Reasoning Fidelity', score: Math.round(((s4+s5+s6)/3)*1000)/1000 },

    signals: [
      // ── Tier 1 ──────────────────────────────────────────────────────────
      {
        id:        'SFS-1',
        name:      'KB Query Audit',
        tier:      1,
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
          : 'No KB queries in audit trail — diagnosis not KB-grounded',
        literature: 'Rath (2026) §2.2',
      },
      {
        id:        'SFS-2',
        name:      'Queried Sensor Citation',
        tier:      1,
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
          : `Agent queried [${queriedSensors.join(', ')}] but only mentioned [${mentionedSensors.join(', ') || 'none'}]`,
        literature: 'Es et al. (2023) RAGAS — entity faithfulness',
      },
      {
        id:        'SFS-3',
        name:      'KB Standard Citation',
        tier:      1,
        passed:    s3 === 1.0,
        score:     s3,
        driftType: 'semantic',
        source:    'KB.standards vocabulary',
        kbFact:    'Agent must cite at least one KB source standard in output',
        agentDid:  s3 === 1.0
          ? `Agent cited: "${citedStandards.join('", "')}"`
          : 'Agent did not cite any KB standard',
        detail: s3 === 1.0
          ? `Standard citation found: "${citedStandards.join('", "')}"`
          : `No KB standard cited. Expected one of: ${KB.standards.join(', ')}`,
        literature: 'Guo et al. (2022) — extrinsic hallucination = no source attribution',
      },

      // ── Tier 2 ──────────────────────────────────────────────────────────
      {
        id:        'SFS-4',
        name:      'Threshold Direction Correctness',
        tier:      2,
        passed:    sfs4.passed,
        score:     s4,
        driftType: 'semantic',
        source:    'kbCallLog thresholds × engine sensor values',
        kbFact:    'For each KB threshold retrieved, agent breach conclusion must match actual sensor vs threshold comparison',
        agentDid:  sfs4.detail,
        detail:    sfs4.detail,
        checks:    sfs4.checks,
        literature: 'Manakul et al. (2023) SelfCheckGPT — arXiv:2303.08896',
        whyMatters: 'An agent can query the KB but still misread the threshold direction — claiming a breach where none exists, or missing a real breach.',
      },
      {
        id:        'SFS-5',
        name:      'Fault Mode Consistency',
        tier:      2,
        passed:    sfs5.passed,
        score:     s5,
        driftType: 'semantic',
        source:    'kbCallLog thresholds × engine sensors → KB-derived fault',
        kbFact:    `KB evidence from retrieved thresholds supports fault: ${sfs5.kbDerivedFault}`,
        agentDid:  `Agent concluded fault: ${sfs5.agentFault}`,
        detail:    sfs5.detail,
        kbDerivedFault: sfs5.kbDerivedFault,
        agentFault:     sfs5.agentFault,
        literature: 'Es et al. (2023) RAGAS faithfulness — arXiv:2309.15217',
        whyMatters: 'An agent can retrieve correct thresholds but conclude the wrong fault — using internal memory to override KB evidence.',
      },
      {
        id:        'SFS-6',
        name:      'Priority Derivation Correctness',
        tier:      2,
        passed:    sfs6.passed,
        score:     s6,
        driftType: 'semantic',
        source:    'kbCallLog priority query × engine RUL',
        kbFact:    `KB priority table prescribes: ${sfs6.kbPriority} for RUL=${engine?.rul}`,
        agentDid:  sfs6.agentPriority
          ? `Agent stated priority: ${sfs6.agentPriority}`
          : 'Agent did not state a clear priority level',
        detail:    sfs6.detail,
        kbPriority:   sfs6.kbPriority,
        agentPriority: sfs6.agentPriority,
        literature: 'Rath (2026) §3.1 + Guo et al. (2022) — intrinsic hallucination',
        whyMatters: 'An agent can retrieve the priority table but apply it to the wrong RUL range — overstating or understating urgency.',
      },
    ],

    verdict: SFS >= 0.75 ? 'HIGH FIDELITY'
           : SFS >= 0.5  ? 'PARTIAL FIDELITY'
           : 'LOW FIDELITY — SEMANTIC DRIFT',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IGS — Inter-Agent Grounding Score (Agent 3 — Maintenance)
// Unchanged from v1.
// ═══════════════════════════════════════════════════════════════════════════

export function computeIGS(diagnosisText, maintenanceText, kbCallLog) {
  const maintLower = (maintenanceText || '').toLowerCase()

  const diagFault    = extractFaultFromDiagnosis(diagnosisText)
  const diagPriority = extractPriorityFromDiagnosis(diagnosisText)

  // IGS-1: Fault-Specific Action Check
  const faultActionTerms    = KB.faultActionTerms[diagFault] || KB.faultActionTerms.NOMINAL
  const matchedFaultActions = containsAny(maintenanceText, faultActionTerms)
  const s1                  = matchedFaultActions.length > 0 ? 1.0 : 0.0

  const wrongFaults       = Object.keys(KB.faultActionTerms).filter(f => f !== diagFault)
  const wrongFaultActions = wrongFaults.flatMap(f =>
    containsAny(maintenanceText, KB.faultActionTerms[f])
  )
  const addressedWrongFault = wrongFaultActions.length > 0 && matchedFaultActions.length === 0

  const s1Detail = s1 === 1.0
    ? `Agent 3 addressed Agent 2's ${diagFault} with fault-specific actions: "${matchedFaultActions.slice(0, 2).join('", "')}"`
    : addressedWrongFault
    ? `COORDINATION DRIFT: Agent 2 diagnosed ${diagFault} but Agent 3 addressed wrong fault (found: "${wrongFaultActions[0]}")`
    : `COORDINATION DRIFT: Agent 2 diagnosed ${diagFault} but Agent 3 plan has no ${diagFault}-specific actions. Expected: [${faultActionTerms.slice(0, 4).join(', ')}]`

  // IGS-2: Priority Urgency Alignment
  let s2       = 0.0
  let s2Detail = ''

  if (!diagPriority) {
    s2       = 0.5
    s2Detail = 'Agent 2 did not state a clear priority — urgency alignment cannot be verified'
  } else {
    const urgencyTerms        = KB.priorityUrgencyTerms[diagPriority] || []
    const matchedUrgencyTerms = containsAny(maintenanceText, urgencyTerms)
    s2 = matchedUrgencyTerms.length > 0 ? 1.0 : 0.0

    const wrongPriorities   = Object.keys(KB.priorityUrgencyTerms).filter(p => p !== diagPriority)
    const wrongUrgencyTerms = wrongPriorities.flatMap(p =>
      containsAny(maintenanceText, KB.priorityUrgencyTerms[p])
    )
    const usedWrongUrgency = wrongUrgencyTerms.length > 0 && matchedUrgencyTerms.length === 0

    s2Detail = s2 === 1.0
      ? `Agent 3 urgency matches Agent 2's ${diagPriority} priority: "${matchedUrgencyTerms.slice(0, 2).join('", "')}"`
      : usedWrongUrgency
      ? `COORDINATION DRIFT: Agent 2 stated ${diagPriority} but Agent 3 used wrong urgency: "${wrongUrgencyTerms[0]}"`
      : `COORDINATION DRIFT: Agent 2 stated ${diagPriority} but Agent 3 plan has no matching urgency. Expected: [${urgencyTerms.join(', ')}]`
  }

  const IGS = (s1 + s2) / 2

  return {
    metric:   'IGS',
    fullName: 'Inter-Agent Grounding Score',
    score:    Math.round(IGS * 1000) / 1000,
    passed:   IGS >= 0.5,
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
        whyMatters: 'An agent that says "based on diagnosis" but recommends wrong actions has not acted on Agent 2 — this is coordination drift',
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
          : `Agent 3 urgency does not match Agent 2's ${diagPriority} priority`,
        detail: s2Detail,
        whyMatters: 'An agent that acknowledges CRITICAL fault but schedules maintenance in 7 days has not acted on Agent 2\'s priority — coordination drift',
      },
    ],
    verdict: IGS >= 0.75 ? 'STRONGLY GROUNDED — Agent 3 acted on Agent 2'
           : IGS >= 0.5  ? 'PARTIALLY GROUNDED — incomplete action on Agent 2'
           : 'NOT GROUNDED — Agent 3 did not act on Agent 2 findings',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — validateDrift
//
// CHANGE FROM v1: engine parameter added to computeSFS call.
// kbCallLog audit trail from diagnosisAgent.js — passed from App.jsx.
// No LLM. No re-diagnosis. Fully deterministic.
//
// ASI = (SFS + IGS) / 2
// ═══════════════════════════════════════════════════════════════════════════

export function validateDrift(engine, diagnosisText, maintenanceText, kbCallLog = []) {

  // engine is now passed to computeSFS for Tier 2 reasoning checks
  const sfsResult = computeSFS(diagnosisText, kbCallLog, engine)
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

    // SFS tier breakdown (new in v2)
    sfsTier1: sfsResult.tier1,
    sfsTier2: sfsResult.tier2,

    diagFault:    igsResult.diagFault,
    diagPriority: igsResult.diagPriority,

    driftTypes: {
      semanticDrift:     !sfsResult.passed,
      coordinationDrift: !igsResult.passed,
      // New in v2: distinguish process vs reasoning drift
      processDrift:   sfsResult.tier1?.score < 0.75,
      reasoningDrift: sfsResult.tier2?.score < 0.75,
    },

    agent2: {
      label:   'Diagnosis Agent (GPT-4o)',
      metric:  'SFS',
      ASI:     sfsResult.score,
      passed:  sfsResult.passed,
      verdict: sfsResult.verdict,
      signals: sfsResult.signals,
      tier1:   sfsResult.tier1,
      tier2:   sfsResult.tier2,
    },
    agent3: {
      label:   'Maintenance Planner (GPT-4o)',
      metric:  'IGS',
      ASI:     igsResult.score,
      passed:  igsResult.passed,
      verdict: igsResult.verdict,
      signals: igsResult.signals,
    },

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
