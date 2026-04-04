// Drift Validator — Knowledge Base Comparison Framework
// Based on: Rath (2026) "Agent Drift: Quantifying Behavioral Degradation
//           in Multi-Agent LLM Systems Over Extended Interactions"
//
// DESIGN PRINCIPLE:
//   Agent outputs are compared DIRECTLY against KB ground truth.
//   No pre-filters in system prompts — agents respond freely.
//   All comparison criteria derive from KB data structures below.
//
// Drift Types (Rath 2026 §2.3):
//   Semantic Drift     — agent output deviates from KB fault ontology, severity, or procedure (Agent 2 + Agent 3)
//   Coordination Drift — inter-agent fault consensus breaks down; Agent 3 ignores Agent 2 (Agent 3 only)
//
// Agent 2 ASI = C_sem
// Agent 3 ASI = 0.50 × C_sem + 0.50 × (I_agree + I_handoff) / 2
// Overall ASI = (Agent 2 ASI + Agent 3 ASI) / 2
// Drift detected when ASI < 0.75  (threshold τ, Rath 2026 §2.2)
//
// ── V2 CHANGE ──────────────────────────────────────────────────────────────
// D1 (Fault Mode Identification) now uses LLM-as-Judge for semantic similarity
// instead of exact keyword matching. All other checks remain deterministic.
// Functions that changed: validateDiagnosisStep (now async), validateDrift (now async)
// New function: llmJudgeD1
// New import: OpenAI
// ───────────────────────────────────────────────────────────────────────────

// ── V2 CHANGE: Import OpenAI for LLM-as-Judge ─────────────────────────────
import OpenAI from 'openai'

// ═══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE — Single source of truth for ALL comparisons
// Agent output detection terms are derived FROM KB vocabulary, not separate lists.
// ═══════════════════════════════════════════════════════════════════════════════

export const KB = {

  // Source: NASA TM-2008-215546 (Saxena et al. 2008), ISO 13379-1, AGARD-R-785
  faultThresholds: {
    HPC_DEG: {
      s3:  { op: '>',  value: 1592.0, label: 'HPC Outlet Temp',     unit: '°R',       standard: 'NASA TM-2008-215546' },
      s4:  { op: '>',  value: 1415.0, label: 'LPT Outlet Temp',     unit: '°R',       standard: 'NASA TM-2008-215546' },
      s7:  { op: '<',  value: 549.0,  label: 'HPC Outlet Pressure', unit: 'psia',     standard: 'ISO 13379-1'         },
      s11: { op: '<',  value: 47.0,   label: 'HPC Static Pressure', unit: 'psia',     standard: 'ISO 13379-1'         },
      s12: { op: '>',  value: 524.0,  label: 'Fuel Flow Ratio',     unit: 'pps/psia', standard: 'NASA TM-2008-215546' },
    },
    FAN_DEG: {
      s8:  { op: '<', value: 2385.0, label: 'Physical Fan Speed',  unit: 'rpm', standard: 'AGARD-R-785' },
      s13: { op: '<', value: 2388.0, label: 'Corrected Fan Speed', unit: 'rpm', standard: 'AGARD-R-785' },
      s15: { op: '<', value: 8.40,   label: 'Bypass Ratio',        unit: '–',   standard: 'AGARD-R-785' },
    },
  },

  // Source: ISO 13381-1:2015, SAE JA1012
  rulPriority: [
    { max: 10,       priority: 'CRITICAL', action: 'Immediate grounding',    standard: 'ISO 13381-1:2015' },
    { max: 30,       priority: 'HIGH',     action: 'Ground within 48 hours', standard: 'ISO 13381-1:2015' },
    { max: 100,      priority: 'MEDIUM',   action: 'Schedule within 7 days', standard: 'SAE JA1012'       },
    { max: Infinity, priority: 'LOW',      action: 'Routine monitoring',     standard: 'SAE JA1012'       },
  ],

  // Source: cmapss_scheduling_001, cmapss_equip_registry_001
  procedures: {
    HPC_DEG_CRITICAL: { id: 'cmapss_proc_borescope_001',       name: 'HPC Borescope Inspection', standard: 'FAA AC 43.13-1B', detect: ['borescope'] },
    HPC_DEG_HIGH:     { id: 'cmapss_proc_borescope_001',       name: 'HPC Borescope Inspection', standard: 'FAA AC 43.13-1B', detect: ['borescope'] },
    HPC_DEG_MEDIUM:   { id: 'cmapss_proc_compressor_wash_001', name: 'Compressor Wash',          standard: 'GE Aviation MM',  detect: ['compressor wash', 'wash'] },
    HPC_DEG_LOW:      { id: 'cmapss_proc_compressor_wash_001', name: 'Compressor Wash',          standard: 'GE Aviation MM',  detect: ['compressor wash', 'wash'] },
    FAN_DEG_CRITICAL: { id: 'cmapss_proc_fan_inspection_001',  name: 'Fan Blade Inspection',     standard: 'AGARD-R-785',     detect: ['fan inspection', 'fan blade'] },
    FAN_DEG_HIGH:     { id: 'cmapss_proc_fan_inspection_001',  name: 'Fan Blade Inspection',     standard: 'AGARD-R-785',     detect: ['fan inspection', 'fan blade'] },
    FAN_DEG_MEDIUM:   { id: 'cmapss_proc_fan_inspection_001',  name: 'Fan Blade Inspection',     standard: 'AGARD-R-785',     detect: ['fan inspection'] },
    FAN_DEG_LOW:      { id: 'cmapss_proc_fan_inspection_001',  name: 'Fan Blade Inspection',     standard: 'AGARD-R-785',     detect: ['fan inspection'] },
    NOMINAL_LOW:      { id: 'routine_monitoring',              name: 'Routine Monitoring',       standard: 'SAE JA1012',      detect: ['routine', 'monitor'] },
    NOMINAL_MEDIUM:   { id: 'routine_monitoring',              name: 'Routine Monitoring',       standard: 'SAE JA1012',      detect: ['routine', 'monitor'] },
  },

  // Fault detection vocabulary — these ARE KB terms used to interpret agent output
  // Not pre-filters: agents are not told to use these. Used only to parse what agent said.
  // ── V2 NOTE: These are still used as FALLBACK if LLM judge call fails ────
  faultDetect: {
    HPC_DEG: ['hpc', 'high-pressure compressor', 'compressor degradation', 'hpc_deg', 'compressor fault'],
    FAN_DEG: ['fan degradation', 'fan_deg', 'fan blade', 'fan fault'],
    NOMINAL: ['nominal', 'no fault', 'within normal', 'no degradation', 'healthy'],
  },

  priorityDetect: {
    CRITICAL: ['critical'],
    HIGH:     ['high priority', 'high severity'],
    MEDIUM:   ['medium', 'moderate'],
    LOW:      ['low priority', 'routine monitoring'],
  },

  // Inter-agent handoff phrases (Rath 2026 §3.2)
  handoffDetect: ['based on', 'per diagnosis', 'consistent with', 'as diagnosed',
                  'the diagnosis indicates', 'identified fault', 'diagnosis agent', 'sensor report'],

}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getKBPriority(rul) {
  return KB.rulPriority.find(r => rul < r.max)
}

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v))
}

// Scan text for a list of terms — returns matched terms (used for DETECTION, not pre-filtering)
// ── V2 NOTE: Still used for D2, D3, M1, M2 and as D1 fallback ─────────────
function detectTerms(text, terms) {
  return terms.filter(t => text.includes(t))
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 — LLM-AS-JUDGE FOR D1
//
// Instead of checking if the agent text contains exact keywords from a list,
// we ask an LLM to judge the semantic similarity between:
//   - What the agent said (free-text diagnosis)
//   - What the KB says (ground truth fault mode + breached sensors)
//
// The judge LLM returns a structured JSON with:
//   fault_score  (0.0–1.0): Did agent identify the CORRECT fault?
//   wrong_fault  (bool):    Did agent identify a WRONG fault?
//   wrong_fault_name (str): If wrong, which fault did agent claim?
//   reasoning    (str):     One-line explanation of the score
//
// FALLBACK: If the LLM call fails (network, key, timeout), we fall back
// to the original keyword matching so the app never breaks.
// ═══════════════════════════════════════════════════════════════════════════════

const D1_JUDGE_SYSTEM_PROMPT = `You are a drift validation judge for a turbofan engine predictive maintenance system.

Your job: compare an agent's diagnosis output against the Knowledge Base (KB) ground truth, and score how well the agent identified the correct fault mode.

The KB defines exactly two fault modes:
- HPC_DEG (High-Pressure Compressor Degradation): compressor fouling, blade erosion, tip clearance increase. Indicated by sensors s3, s4, s7, s11, s12.
- FAN_DEG (Fan Degradation): fan blade erosion, FOD damage, rotor imbalance. Indicated by sensors s8, s13, s15.
- NOMINAL: No fault detected, all sensors within normal range.

You must return ONLY a JSON object with these fields:
{
  "fault_score": <number 0.0 to 1.0>,
  "wrong_fault": <boolean>,
  "wrong_fault_name": <string or null>,
  "reasoning": "<one sentence explaining your score>"
}

Scoring rules for fault_score:
- 1.0 = Agent clearly and correctly identifies the KB fault mode (exact term or unmistakable synonym)
- 0.8 = Agent describes the correct fault mechanism without using the exact KB term (e.g. "compressor fouling" for HPC_DEG)
- 0.5 = Agent vaguely hints at the right fault area but is not specific
- 0.2 = Agent mentions degradation but does not specify which component
- 0.0 = Agent does not identify any fault, OR identifies the WRONG fault

Set wrong_fault = true ONLY if the agent explicitly identifies a different fault mode than KB ground truth.

Return ONLY the JSON object. No markdown, no explanation outside the JSON.`

async function llmJudgeD1(apiKey, agentText, kbFault, breachedSensors) {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })

  const userPrompt = `KB Ground Truth:
- Fault mode: ${kbFault}
- Breached sensors: ${breachedSensors.join(', ')}
- Fault definitions:
  HPC_DEG = High-Pressure Compressor Degradation (sensors s3, s4, s7, s11, s12)
  FAN_DEG = Fan Degradation (sensors s8, s13, s15)
  NOMINAL = No fault

Agent Diagnosis Output:
"""
${agentText.substring(0, 1500)}
"""

Score how well the agent identified the fault mode. Return JSON only.`

  try {
    const response = await client.chat.completions.create({
      model:       'gpt-4o',
      messages: [
        { role: 'system', content: D1_JUDGE_SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens:  200,
      temperature: 0.0,   // deterministic as possible for consistent scoring
    })

    const raw = response.choices[0]?.message?.content || ''
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      success:        true,
      fault_score:    clamp(parsed.fault_score ?? 0),
      wrong_fault:    parsed.wrong_fault ?? false,
      wrong_fault_name: parsed.wrong_fault_name || null,
      reasoning:      parsed.reasoning || '',
    }
  } catch (err) {
    // LLM call failed — return failure so caller can use fallback
    return {
      success:        false,
      fault_score:    0,
      wrong_fault:    false,
      wrong_fault_name: null,
      reasoning:      `LLM judge call failed: ${err.message}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — SENSOR AGENT VALIDATION
// Pure KB threshold check. No agent text — validates KB fact computation.
// ── V2: UNCHANGED ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export function validateSensorStep(engine) {
  const checks = []

  for (const [faultType, thresholds] of Object.entries(KB.faultThresholds)) {
    for (const [sensorKey, def] of Object.entries(thresholds)) {
      const val = engine.sensors[sensorKey]?.value
      if (val === undefined) continue
      const breached   = def.op === '>' ? val > def.value : val < def.value
      const direction  = def.op === '>' ? 'exceeds' : 'is below'
      const safeDir    = def.op === '>' ? 'below'   : 'above'

      checks.push({
        sensor:    sensorKey,
        label:     def.label,
        value:     val,
        threshold: def.value,
        op:        def.op,
        unit:      def.unit,
        standard:  def.standard,
        fault:     faultType,
        breached,
        explanation: breached
          ? `KB BREACH — ${def.label} (${sensorKey}) = ${val} ${def.unit} ${direction} KB threshold (${def.op} ${def.value} ${def.unit}) [${def.standard}] → ${faultType} indicator activated`
          : `KB OK — ${def.label} (${sensorKey}) = ${val} ${def.unit} is ${safeDir} threshold of ${def.value} ${def.unit} [${def.standard}]`,
      })
    }
  }

  const hpcBreaches     = checks.filter(c => c.fault === 'HPC_DEG' && c.breached)
  const fanBreaches     = checks.filter(c => c.fault === 'FAN_DEG' && c.breached)
  const kbFault         = hpcBreaches.length ? 'HPC_DEG' : fanBreaches.length ? 'FAN_DEG' : 'NOMINAL'
  const kbPriorityObj   = getKBPriority(engine.rul)

  return {
    step:            'sensor',
    kbFault,
    kbPriority:      kbPriorityObj.priority,
    kbAction:        kbPriorityObj.action,
    kbPriorityStd:   kbPriorityObj.standard,
    checks,
    breachedCount:   checks.filter(c => c.breached).length,
    breachedSensors: checks.filter(c => c.breached).map(c => c.sensor),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — DIAGNOSIS AGENT VALIDATION
// Compares agent free-text output against KB ground truth.
// Each check: KB says X → did agent say X? → explain mismatch.
//
// ── V2 CHANGE: This function is now ASYNC ──────────────────────────────────
// D1 uses LLM-as-Judge instead of keyword matching.
// D2 and D3 remain unchanged (deterministic keyword matching).
// apiKey parameter added — required for the LLM judge call.
// ═══════════════════════════════════════════════════════════════════════════════

export async function validateDiagnosisStep(apiKey, engine, diagText) {
  const lower        = (diagText || '').toLowerCase()
  const sensorResult = validateSensorStep(engine)
  const kbFault      = sensorResult.kbFault
  const kbPriObj     = getKBPriority(engine.rul)

  // ── D1: Fault Mode Identification — V2: LLM-as-Judge ──────────────────────
  //
  // BEFORE (v1):
  //   const faultTerms = KB.faultDetect[kbFault] || []
  //   const foundFault = detectTerms(lower, faultTerms)
  //   const d1Passed   = foundFault.length > 0
  //
  // NOW (v2):
  //   Call LLM judge to score semantic similarity between agent output and KB.
  //   Falls back to v1 keyword matching if LLM call fails.

  let d1Score       = 0
  let d1Passed      = false
  let d1AgentClaim  = ''
  let d1Explanation = ''
  let d1JudgeUsed   = false
  let d1WrongFault  = null

  // Try LLM judge first
  if (apiKey) {
    const judge = await llmJudgeD1(apiKey, diagText, kbFault, sensorResult.breachedSensors)

    if (judge.success) {
      d1JudgeUsed  = true
      d1Score      = judge.fault_score
      d1Passed     = judge.fault_score >= 0.5
      d1WrongFault = judge.wrong_fault ? judge.wrong_fault_name : null

      d1AgentClaim = judge.wrong_fault
        ? `LLM Judge: Agent identified WRONG fault (${judge.wrong_fault_name || 'unknown'}) — score ${judge.fault_score.toFixed(2)}. "${judge.reasoning}"`
        : `LLM Judge: score ${judge.fault_score.toFixed(2)} — "${judge.reasoning}"`

      d1Explanation = judge.fault_score >= 0.8
        ? `Agent correctly identified ${kbFault}. LLM judge confirms strong semantic alignment (score=${judge.fault_score.toFixed(2)}). KB derives this from threshold analysis of ${sensorResult.breachedSensors.join(', ')}.`
        : judge.fault_score >= 0.5
        ? `Agent partially identified ${kbFault}. LLM judge gives moderate semantic alignment (score=${judge.fault_score.toFixed(2)}). "${judge.reasoning}"`
        : judge.wrong_fault
        ? `SEMANTIC DRIFT (WRONG FAULT): KB determines fault = ${kbFault} but LLM judge detected agent identified ${judge.wrong_fault_name || 'a different fault'}. Score=${judge.fault_score.toFixed(2)}. "${judge.reasoning}"`
        : `SEMANTIC DRIFT: KB determines fault = ${kbFault} from sensor breaches on [${sensorResult.breachedSensors.join(', ')}]. LLM judge scored agent output at ${judge.fault_score.toFixed(2)} — insufficient semantic alignment. "${judge.reasoning}"`
    }
  }

  // Fallback to v1 keyword matching if LLM judge was not used or failed
  if (!d1JudgeUsed) {
    const faultTerms = KB.faultDetect[kbFault] || []
    const foundFault = detectTerms(lower, faultTerms)
    d1Passed         = foundFault.length > 0
    d1Score          = d1Passed ? 1.0 : 0.0

    d1AgentClaim = d1Passed
      ? `Agent used KB-aligned terms: "${foundFault.join('", "')}" (keyword fallback)`
      : `No KB fault vocabulary found in agent output (keyword fallback)`

    d1Explanation = d1Passed
      ? `Agent correctly identified ${kbFault}. KB derives this from threshold analysis of ${sensorResult.breachedSensors.join(', ')}. (Scored by keyword fallback)`
      : `SEMANTIC DRIFT: KB determines fault = ${kbFault} from sensor threshold breaches on [${sensorResult.breachedSensors.join(', ')}]. Agent output did not contain KB-aligned fault vocabulary. Expected one of: [${faultTerms.join(', ')}]. (Scored by keyword fallback — LLM judge unavailable)`
  }

  const d1 = {
    driftType:   'semantic',
    id:          'D1',
    name:        'Fault Mode Identification',
    score:       d1Score,           // ── V2 CHANGE: graduated 0.0–1.0 score
    kbFact:      `KB computes fault = ${kbFault} from ${sensorResult.breachedCount} threshold breach(es) on: ${sensorResult.breachedSensors.join(', ')} [NASA TM-2008-215546]`,
    agentClaim:  d1AgentClaim,
    passed:      d1Passed,
    source:      'NASA TM-2008-215546 + ISO 13379-1',
    explanation: d1Explanation,
    judgeUsed:   d1JudgeUsed,       // ── V2 NEW: flag whether LLM judge was used
    wrongFault:  d1WrongFault,      // ── V2 NEW: name of wrong fault if detected
  }

  // ── D2: Severity / Priority Level ─────────────────────────────────────────
  // ── V2: UNCHANGED ─────────────────────────────────────────────────────────
  const priorityTerms  = KB.priorityDetect[kbPriObj.priority] || []
  const foundPriority  = detectTerms(lower, priorityTerms)
  const d2Passed       = foundPriority.length > 0

  const d2 = {
    driftType:   'semantic',
    id:          'D2',
    name:        'Severity Level',
    kbFact:      `KB priority = ${kbPriObj.priority} for RUL = ${engine.rul} cycles (rule: RUL < ${kbPriObj.max} → ${kbPriObj.priority}, ${kbPriObj.standard})`,
    agentClaim:  d2Passed ? `Agent stated: "${foundPriority.join('", "')}"` : `No KB-aligned severity level found in agent output`,
    passed:      d2Passed,
    source:      kbPriObj.standard,
    explanation: d2Passed
      ? `Agent correctly expressed ${kbPriObj.priority} severity, consistent with KB RUL rule (RUL=${engine.rul} cycles < ${kbPriObj.max} threshold).`
      : `SEMANTIC DRIFT: KB computes priority = ${kbPriObj.priority} for RUL = ${engine.rul} cycles per ${kbPriObj.standard} (threshold: RUL < ${kbPriObj.max} cycles → ${kbPriObj.priority}). Agent did not state a KB-aligned severity level. This is a calibration failure — the agent's urgency assessment is not grounded in the KB RUL table.`,
  }

  // ── D3: Sensor Evidence Citation ──────────────────────────────────────────
  // ── V2: UNCHANGED ─────────────────────────────────────────────────────────
  const breachedSensors = sensorResult.checks.filter(c => c.breached)
  const citedSensors    = breachedSensors.filter(c =>
    lower.includes(c.sensor) || lower.includes(String(c.value))
  )
  const d3Passed        = citedSensors.length > 0 || breachedSensors.length === 0

  const d3 = {
    driftType:   'semantic',
    id:          'D3',
    name:        'Sensor Evidence Citation',
    kbFact:      `KB identifies ${breachedSensors.length} breached sensor(s): ${breachedSensors.map(c => `${c.sensor}=${c.value}${c.unit}`).join(', ')}`,
    agentClaim:  citedSensors.length
      ? `Agent cited ${citedSensors.length}/${breachedSensors.length} KB-identified breached sensor(s): ${citedSensors.map(c => c.sensor).join(', ')}`
      : `Agent did not cite specific KB-identified breached sensor IDs or values`,
    passed:      d3Passed,
    source:      'NASA TM-2008-215546',
    explanation: d3Passed
      ? `Agent cited ${citedSensors.length} of ${breachedSensors.length} KB-identified breached sensors as evidence, ensuring traceability.`
      : `SEMANTIC DRIFT: KB threshold analysis identifies ${breachedSensors.length} breached sensor(s) as the evidence base (${breachedSensors.map(c => c.sensor).join(', ')}). Agent did not cite these specific sensor IDs or their values. Without citing KB-specific evidence, the diagnosis cannot be validated against the knowledge base.`,
  }

  const checks         = [d1, d2, d3]
  const stepDriftScore = Math.round((1 - checks.filter(c => c.passed).length / checks.length) * 100)

  return {
    step:          'diagnosis',
    kbFault,
    kbPriority:    kbPriObj.priority,
    checks,
    stepDriftScore,
    verdict: stepDriftScore === 0 ? 'GROUNDED' : stepDriftScore <= 34 ? 'MINOR DRIFT' : stepDriftScore <= 67 ? 'MODERATE DRIFT' : 'SIGNIFICANT DRIFT',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — MAINTENANCE AGENT VALIDATION
// Checks: correct procedure, agent-to-agent handoff, safety escalation.
// ── V2: UNCHANGED ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export function validateMaintenanceStep(engine, diagText, maintText, kbFault, kbPriorityObj) {
  const maintLower  = (maintText || '').toLowerCase()
  const diagLower   = (diagText  || '').toLowerCase()
  const procKey     = `${kbFault}_${kbPriorityObj.priority}`
  const kbProc      = KB.procedures[procKey] || KB.procedures['NOMINAL_LOW']

  // ── M1: Procedure Selection ───────────────────────────────────────────────
  const foundProcTerms = detectTerms(maintLower, kbProc.detect)
  const m1Passed       = foundProcTerms.length > 0

  const m1 = {
    driftType:   'semantic',
    id:          'M1',
    name:        'Procedure Selection',
    kbFact:      `KB requires procedure ${kbProc.id} (${kbProc.name}) for ${kbFault}+${kbPriorityObj.priority} [${kbProc.standard}]`,
    agentClaim:  m1Passed
      ? `Agent referenced procedure keywords: "${foundProcTerms.join('", "')}" → maps to ${kbProc.id}`
      : `Agent did not reference KB-prescribed procedure (expected: ${kbProc.id})`,
    passed:      m1Passed,
    source:      kbProc.standard,
    explanation: m1Passed
      ? `Agent correctly referenced ${kbProc.id} (${kbProc.name}) as prescribed by KB for ${kbFault} with ${kbPriorityObj.priority} priority.`
      : `SEMANTIC DRIFT: KB procedure registry maps ${kbFault}+${kbPriorityObj.priority} → ${kbProc.id} (${kbProc.name}, ${kbProc.standard}). Agent maintenance plan did not reference this KB-prescribed procedure. The agent either selected a wrong procedure or omitted the procedure reference entirely.`,
  }

  // ── M2: Diagnosis Handoff (Coordination) ─────────────────────────────────
  const foundHandoff = detectTerms(maintLower, KB.handoffDetect)
  const m2Passed     = foundHandoff.length > 0

  const m2 = {
    driftType:   'coordination',
    id:          'M2',
    name:        'Diagnosis Handoff',
    kbFact:      `KB inter-agent protocol: Maintenance agent must explicitly reference Diagnosis output to prevent coordination drift (Rath 2026 §3.2)`,
    agentClaim:  m2Passed
      ? `Agent used handoff phrase: "${foundHandoff[0]}"`
      : `No explicit reference to Diagnosis agent output found`,
    passed:      m2Passed,
    source:      'Rath (2026) §3.2',
    explanation: m2Passed
      ? `Agent correctly used explicit handoff phrase ("${foundHandoff[0]}"), confirming receipt of Diagnosis agent output.`
      : `COORDINATION DRIFT: Rath (2026) §3.2 requires the Maintenance agent to explicitly reference the Diagnosis agent output to maintain inter-agent coherence. The agent did not use any handoff phrase (expected: "based on", "consistent with", "as diagnosed", etc.). This breaks the agent chain and creates a risk of contradictory recommendations.`,
  }

  const checks         = [m1, m2]
  const stepDriftScore = Math.round((1 - checks.filter(c => c.passed).length / checks.length) * 100)

  return {
    step:          'maintenance',
    checks,
    stepDriftScore,
    verdict: stepDriftScore === 0 ? 'GROUNDED' : stepDriftScore <= 34 ? 'MINOR DRIFT' : stepDriftScore <= 67 ? 'MODERATE DRIFT' : 'SIGNIFICANT DRIFT',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASI PER-AGENT SCORING — bifurcated by agent (Rath 2026 §2.3, §3.2, §4.1)
//
// Agent 2 (Diagnosis):    Semantic Drift only
// Agent 3 (Maintenance):  Semantic + Coordination Drift
//
// Agent 2 ASI = C_sem
// Agent 3 ASI = 0.50 × Semantic + 0.50 × Coordination
// Overall ASI = (Agent2 ASI + Agent3 ASI) / 2
//
// ── V2: UNCHANGED ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Agent 2 — only Semantic Drift applies (no prior agent to coordinate with, no escalation obligation)
// Measures: does diagnosis output use KB-aligned fault vocabulary? (C_sem)
function scoreAgent2(kbFault, diagLower) {
  const faultTerms = KB.faultDetect[kbFault] || []
  const hits       = detectTerms(diagLower, faultTerms).length

  let C_sem
  if (kbFault === 'NOMINAL') {
    const nomHits    = detectTerms(diagLower, KB.faultDetect.NOMINAL).length
    const falseAlarm = diagLower.includes('critical') || diagLower.includes('immediate grounding')
    C_sem = falseAlarm ? 0.0 : nomHits > 0 ? 1.0 : 0.4
  } else {
    C_sem = clamp(hits / 2)
  }

  return {
    ASI:           C_sem,
    semanticScore: C_sem,
    C_sem,
    semanticDrift: C_sem < 0.5,
  }
}

// Agent 3 — Semantic + Coordination Drift only
// Semantic:     does maintenance plan cite KB-prescribed procedure? (C_sem)
// Coordination: do both agents agree on fault + does Agent 3 explicitly reference Agent 2? (I_agree, I_handoff)
// Agent 3 ASI = 0.50 × Semantic + 0.50 × Coordination
function scoreAgent3(kbFault, kbPriority, diagLower, maintLower) {
  // Semantic — procedure selection against KB registry
  const procKey = `${kbFault}_${kbPriority.priority}`
  const kbProc  = KB.procedures[procKey] || KB.procedures['NOMINAL_LOW']
  const C_sem   = detectTerms(maintLower, kbProc.detect).length > 0 ? 1.0 : 0.0

  // Coordination — fault agreement between agents + explicit handoff phrase
  const faultTerms = KB.faultDetect[kbFault] || []
  const diagMatch  = detectTerms(diagLower, faultTerms).length > 0
  const maintMatch = detectTerms(maintLower, faultTerms).length > 0 ||
    Object.values(KB.procedures).some(p =>
      p.id.includes(kbFault.toLowerCase().replace('_', '')) && detectTerms(maintLower, p.detect).length > 0
    )
  let I_agree
  if (kbFault === 'NOMINAL') I_agree = (!diagMatch && !maintMatch) ? 1 : 0.3
  else I_agree = (diagMatch && maintMatch) ? 1 : (diagMatch || maintMatch) ? 0.5 : 0

  const I_handoff    = detectTerms(maintLower, KB.handoffDetect).length > 0 ? 1.0 : 0.0
  const coordScore   = (I_agree + I_handoff) / 2

  const ASI3 = 0.50 * C_sem + 0.50 * coordScore

  return {
    ASI:               ASI3,
    semanticScore:     C_sem,
    coordinationScore: coordScore,
    C_sem,
    I_agree, I_handoff,
    semanticDrift:     C_sem < 0.5,
    coordinationDrift: I_agree < 0.5,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY — localStorage run history (persists across sessions)
// ── V2: UNCHANGED ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const MEMORY_KEY            = 'cmapss_drift_memory'
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
  } catch (_) {
    return []
  }
}

export function getAllMemory() {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}')
  } catch (_) {
    return {}
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — Full ASI validation with per-step results
//
// ── V2 CHANGE: This function is now ASYNC ──────────────────────────────────
// because validateDiagnosisStep is now async (LLM judge call).
// apiKey parameter added.
// ═══════════════════════════════════════════════════════════════════════════════

export async function validateDrift(apiKey, engine, diagnosisText, maintenanceText) {
  const rul           = engine.rul
  const kbPriorityObj = getKBPriority(rul)
  const sensorStep    = validateSensorStep(engine)
  const kbFault       = sensorStep.kbFault

  const diagLower  = (diagnosisText   || '').toLowerCase()
  const maintLower = (maintenanceText || '').toLowerCase()
  const combined   = diagLower + ' ' + maintLower

  // ── V2 CHANGE: await the now-async diagnosis step ────────────────────────
  const diagStep  = await validateDiagnosisStep(apiKey, engine, diagnosisText)
  const maintStep = validateMaintenanceStep(engine, diagnosisText, maintenanceText, kbFault, kbPriorityObj)

  const agent2 = scoreAgent2(kbFault, diagLower)
  const agent3 = scoreAgent3(kbFault, kbPriorityObj, diagLower, maintLower)

  // Overall ASI = average of both agent ASIs
  const ASI        = (agent2.ASI + agent3.ASI) / 2
  const driftScore = Math.round((1 - ASI) * 100)

  return {
    engineId:            engine.id,
    rul,
    thresholdChecks:     sensorStep.checks,
    ragFault:            kbFault,
    faultMatch:          agent2.C_sem >= 0.5,
    groundTruthPriority: kbPriorityObj.priority,
    driftScore,
    verdict: driftScore === 0  ? 'FULLY GROUNDED'
           : driftScore <= 25  ? 'MINOR DRIFT'
           : driftScore <= 50  ? 'MODERATE DRIFT'
           : 'SIGNIFICANT DRIFT',
    ASI:          Math.round(ASI * 1000) / 1000,
    asiThreshold: 0.75,
    agent2: {
      label:         'Diagnosis Agent (GPT-4o)',
      ASI:           Math.round(agent2.ASI * 1000) / 1000,
      semanticDrift: agent2.semanticDrift,
      C_sem:         agent2.C_sem,
    },
    agent3: {
      label:             'Maintenance Planner (GPT-4o)',
      ASI:               Math.round(agent3.ASI * 1000) / 1000,
      semanticDrift:     agent3.semanticDrift,
      coordinationDrift: agent3.coordinationDrift,
      C_sem:             agent3.C_sem,
      I_agree:           agent3.I_agree,
      I_handoff:         agent3.I_handoff,
      semanticScore:     agent3.semanticScore,
      coordinationScore: agent3.coordinationScore,
    },
    driftTypes: {
      semanticDrift:     agent2.semanticDrift || agent3.semanticDrift,
      coordinationDrift: agent3.coordinationDrift,
    },
    stepResults: {
      sensor:      sensorStep,
      diagnosis:   diagStep,
      maintenance: maintStep,
    },
  }
}
