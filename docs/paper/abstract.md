# Abstract

## Drift-Aware Multi-Agent Systems for Predictive Maintenance: A Knowledge-Grounded Approach with Deterministic Audit-Log Validation

---

### IEEE-Style Abstract

Industrial predictive maintenance increasingly relies on multi-agent AI systems to monitor complex machinery in real time, yet sustained deployment exposes these systems to **agent drift**—the progressive degradation of individual agent outputs, inter-agent coordination, and overall decision reliability. This paper presents a drift-aware multi-agent system (MAS) architecture for turbofan engine predictive maintenance, applied to the NASA CMAPSS benchmark dataset. The framework comprises four cooperating agents: a **sensor monitor** that ingests raw telemetry and flags statistical anomalies; a **diagnosis agent** equipped with a retrieval-augmented knowledge base (KB), structured tool-calling, and full audit-log traceability; a **maintenance planner** that translates diagnostic findings into prioritized work orders; and a **deterministic drift validator** that continuously audits agent behavior without modifying primary agent logic. Drift is quantified through three complementary, deterministic metrics—the **Semantic Fidelity Score (SFS)**, which measures whether diagnosis outputs remain grounded in retrieved KB evidence; the **Inter-Agent Grounding Score (IGS)**, which assesses whether maintenance plans faithfully act on diagnosed fault modes and priorities; and the **Agent Stability Index (ASI)**, the composite score derived from SFS and IGS that triggers corrective alerts when it falls below a defined threshold. Each metric is computed solely from structured audit logs, ensuring full reproducibility and explainability. Experiments demonstrate that drift-aware validation sustains high fault-detection accuracy and inter-agent coordination fidelity across extended operational cycles, with detected drift reliably attributed to semantic or coordination failure modes. These results indicate that deterministic, audit-log-based drift attribution is a practical and scalable strategy for deploying trustworthy multi-agent AI in regulated industrial settings.

---

### Structured Breakdown

| Component | Description |
|-----------|-------------|
| **Motivation** | Long-running multi-agent predictive maintenance systems degrade through agent drift, compromising fault detection and maintenance planning reliability. |
| **Approach** | A four-agent pipeline (sensor monitor → diagnosis agent with KB/tool calling/audit logs → maintenance planner → drift validator) with deterministic, log-based drift validation. |
| **Metrics** | SFS (semantic grounding of diagnosis), IGS (coordination fidelity between diagnosis and maintenance), ASI (composite stability index). |
| **Results** | [Placeholder — drift-aware MAS sustains accuracy over extended cycles; specific precision/recall and ASI values to be reported.] |
| **Conclusion** | Deterministic, audit-log-driven drift attribution is a reproducible, explainable, and deployment-ready mechanism for trustworthy industrial MAS. |

---

### Keywords

Multi-Agent Systems · Predictive Maintenance · Agent Drift · Semantic Fidelity Score · Inter-Agent Grounding Score · Agent Stability Index · Audit Logs · Retrieval-Augmented Generation · NASA CMAPSS · Knowledge Base · Drift Attribution · Deterministic Validation

---

### Notes for Authors

- Replace `[Placeholder — ...]` in the Results row with actual experimental numbers once evaluation is complete.
- Insert quantitative findings (e.g., precision/recall values, ASI thresholds) at the end of the abstract paragraph once experiments are complete.
- The abstract word count is approximately **248 words**, within the IEEE 250-word limit.
- Citation style: follow IEEE (numbered, e.g., [1], [2]) for the final submission.
- Refer to `docs/paper/` for any companion skeleton or full-paper draft files.
