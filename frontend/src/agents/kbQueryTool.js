// KB Query Tool — Autonomous Knowledge Base Interface
// =====================================================
// Exposes the KB (defined in driftAgent.js) as a callable tool
// for the Diagnosis Agent's agentic loop.
//
// DESIGN PRINCIPLE:
//   The LLM agent does NOT receive KB thresholds in its system prompt.
//   It calls query_kb() to retrieve them on demand — sensor by sensor.
//   This makes the diagnosis genuinely autonomous and KB-grounded.
//
// Supported query types:
//   sensor + HPC_DEG      → threshold for that sensor under HPC degradation
//   sensor + FAN_DEG      → threshold for that sensor under Fan degradation
//   HPC_DEG + all_thresholds → all HPC thresholds at once
//   FAN_DEG + all_thresholds → all FAN thresholds at once
//   RUL + priority         → full RUL-to-priority mapping table
//   FAULT_PRIORITY + procedure → procedure ID for that fault+priority combo
//
// Referenced by: diagnosisAgent.js

import { KB } from './driftAgent.js'

// ── Main query function ────────────────────────────────────────────────────
export function queryKB(sensor, faultType) {

  // ── RUL priority table query ──────────────────────────────────────────
  if (faultType === 'priority') {
    return {
      query:       'RUL priority rules',
      source:      'ISO 13381-1:2015 + SAE JA1012',
      description: 'Maps RUL (cycles remaining) to maintenance priority and required action',
      rules: KB.rulPriority.map(r => ({
        condition: r.max === Infinity ? 'RUL >= 100' : `RUL < ${r.max}`,
        priority:  r.priority,
        action:    r.action,
        standard:  r.standard,
      })),
      usage: 'Find first matching condition for the engine RUL. That is the KB-prescribed priority.',
    }
  }

  // ── Procedure lookup ──────────────────────────────────────────────────
  if (faultType === 'procedure') {
    // sensor param is the procedure key e.g. "HPC_DEG_HIGH"
    const proc = KB.procedures[sensor]
    if (!proc) {
      return {
        error:         `No procedure found for key: ${sensor}`,
        availableKeys: Object.keys(KB.procedures),
        hint:          'Key format is FAULT_PRIORITY e.g. HPC_DEG_HIGH, FAN_DEG_MEDIUM, NOMINAL_LOW',
      }
    }
    return {
      query:           sensor,
      procedureId:     proc.id,
      name:            proc.name,
      standard:        proc.standard,
      detectionTerms:  proc.detect,
      usage:           `Reference this exact procedure ID in your maintenance recommendation: ${proc.id}`,
    }
  }

  // ── All thresholds for a fault type ──────────────────────────────────
  if (faultType === 'all_thresholds') {
    // sensor param is used as fault type: "HPC_DEG" or "FAN_DEG"
    const faultDef = KB.faultThresholds[sensor]
    if (!faultDef) {
      return {
        error:           `Unknown fault type: ${sensor}`,
        availableFaults: Object.keys(KB.faultThresholds),
      }
    }
    return {
      query:      `All thresholds for ${sensor}`,
      faultType:  sensor,
      logic:      'ANY single threshold breach confirms this fault type',
      thresholds: Object.entries(faultDef).map(([s, def]) => ({
        sensor:    s,
        label:     def.label,
        operator:  def.op,
        threshold: def.value,
        unit:      def.unit,
        standard:  def.standard,
        rule:      `If ${s} (${def.label}) ${def.op} ${def.value} ${def.unit} → ${sensor} confirmed [${def.standard}]`,
      })),
    }
  }

  // ── Single sensor threshold query ────────────────────────────────────
  const faultDef = KB.faultThresholds[faultType]
  if (!faultDef) {
    return {
      error:           `Unknown fault type: ${faultType}`,
      availableFaults: Object.keys(KB.faultThresholds),
      hint:            'Valid fault types: HPC_DEG, FAN_DEG',
    }
  }

  const sensorDef = faultDef[sensor]
  if (!sensorDef) {
    return {
      error:            `Sensor ${sensor} not in KB for fault type ${faultType}`,
      availableSensors: Object.keys(faultDef),
      hint:             `Sensors defined for ${faultType}: ${Object.keys(faultDef).join(', ')}`,
    }
  }

  return {
    query:     `${sensor} threshold for ${faultType}`,
    sensor,
    faultType,
    label:     sensorDef.label,
    operator:  sensorDef.op,
    threshold: sensorDef.value,
    unit:      sensorDef.unit,
    standard:  sensorDef.standard,
    rule:      `If ${sensor} (${sensorDef.label}) ${sensorDef.op} ${sensorDef.value} ${sensorDef.unit} → ${faultType} indicator [${sensorDef.standard}]`,
    howToUse:  `Compare actual sensor value against threshold using operator '${sensorDef.op}'. Breach = (actual ${sensorDef.op} ${sensorDef.value}).`,
  }
}

// ── OpenAI function calling schema ────────────────────────────────────────
export function buildKBToolDefinition() {
  return {
    type: 'function',
    function: {
      name: 'query_kb',
      description: `Query the NASA CMAPSS Knowledge Base (KB) to retrieve:
- All thresholds for a fault type: use fault_type="all_thresholds", sensor="HPC_DEG" or "FAN_DEG"
- Single sensor threshold: use sensor="s3", fault_type="HPC_DEG"
- RUL priority mapping: use sensor="RUL", fault_type="priority"
- Maintenance procedure: use sensor="HPC_DEG_HIGH", fault_type="procedure"

CRITICAL: Always call this tool BEFORE making any diagnostic claim.
Never use your internal memory for threshold values — they must come from this tool.`,
      parameters: {
        type: 'object',
        properties: {
          sensor: {
            type: 'string',
            description: `What to query:
- Sensor ID (s2,s3,s4,s7,s8,s9,s11,s12,s13,s14,s15) for single threshold lookup
- "HPC_DEG" or "FAN_DEG" when fault_type is "all_thresholds"
- "RUL" when fault_type is "priority"  
- Procedure key like "HPC_DEG_HIGH" or "FAN_DEG_MEDIUM" when fault_type is "procedure"`,
          },
          fault_type: {
            type: 'string',
            enum: ['HPC_DEG', 'FAN_DEG', 'priority', 'procedure', 'all_thresholds'],
            description: `Query category:
- "all_thresholds": get all thresholds for a fault type at once (fastest, recommended first)
- "HPC_DEG": single sensor threshold for HPC degradation
- "FAN_DEG": single sensor threshold for Fan degradation
- "priority": get full RUL-to-priority table
- "procedure": get maintenance procedure ID for a fault+priority combination`,
          },
        },
        required: ['sensor', 'fault_type'],
      },
    },
  }
}
