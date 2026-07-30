# IEEE-Style Abstract — Drift-Aware Multi-Agent Systems for Predictive Maintenance

> **Submission target:** IEEE Transactions on Industrial Informatics / IEEE Transactions on Automation Science and Engineering  
> **Word count:** ≈ 230 words (within the 150–250 word IEEE abstract guideline)

---

## Abstract

Predictive maintenance of safety-critical turbofan engines demands AI systems that remain reliable over prolonged, autonomous operation. Multi-Agent Systems (MAS), with their distributed sensing, diagnosis, and planning capabilities, are increasingly deployed for this purpose; however, long-running agent networks are vulnerable to *agent drift* — a progressive degradation in semantic fidelity, inter-agent coordination, and behavioral consistency that silently erodes fault-detection accuracy. Existing approaches address either predictive maintenance algorithms or MAS deployment architectures, but none instrument the agent network itself for continuous, quantitative drift monitoring.

This paper presents a **drift-aware MAS framework** for turbofan-engine predictive maintenance built on the NASA CMAPSS benchmark dataset. The framework comprises four specialized agents — Sensor Monitor, Diagnosis Agent (GPT-4o), Maintenance Planner Agent (GPT-4o), and a deterministic Drift Validator — augmented by a Retrieval-Augmented Generation (RAG) knowledge base grounded in authoritative aerospace standards (NASA TM-2008-215546, ISO 13379-1, ISO 13381-1, FAA AC 43.13-1B, SAE JA1012). Drift is quantified through three complementary, audit-log-derived metrics: the **Semantic Fidelity Score** (SFS), which measures whether individual agent outputs remain faithful to retrieved knowledge; the **Inter-Agent Grounding Score** (IGS), which verifies that maintenance plans directly address diagnosed fault modes and priority levels; and the composite **Agent Stability Index** (ASI = (SFS + IGS) / 2), which triggers corrective alerts when it falls below a calibrated threshold (τ = 0.75).

Experiments on 100 CMAPSS run-to-failure engine trajectories demonstrate that drift-aware validation [*results placeholder: e.g., sustains fault-detection accuracy above X% after Y,000 operational cycles and reduces undetected drift events by Z% compared to non-drift-aware baselines*]. The framework, datasets, and audit-log toolkit are released as open-source, enabling reproducible research at the intersection of trustworthy agentic AI and industrial predictive maintenance.

---

## Plain-Language Guide to the Abstract Structure

The table below maps each sentence of the abstract to its IEEE structural role, so that anyone reading or editing this work can understand what each part must accomplish.

| # | Structural Role | What It Must Answer | Abstract Sentences |
|---|----------------|--------------------|--------------------|
| 1 | **Motivation** | Why does this problem matter in the real world? | *"Predictive maintenance of safety-critical turbofan engines demands AI systems that remain reliable over prolonged, autonomous operation…"* |
| 2 | **Problem Statement** | What goes wrong today and why does it matter? | *"…long-running agent networks are vulnerable to agent drift…"* |
| 3 | **Gap in Existing Work** | What is missing in the literature? | *"Existing approaches address either predictive maintenance algorithms or MAS deployment architectures, but none instrument the agent network itself…"* |
| 4 | **Proposed Method** | What is your solution at a high level? | *"This paper presents a drift-aware MAS framework…"* |
| 5 | **System Components** | What are the technical building blocks? | *"…four specialized agents…augmented by a RAG knowledge base grounded in authoritative aerospace standards…"* |
| 6 | **Metrics** | How is success measured objectively? | *"Drift is quantified through…SFS…IGS…ASI…"* |
| 7 | **Results** | What did you demonstrate empirically? *(fill in with actual numbers before submission)* | *"Experiments on 100 CMAPSS run-to-failure engine trajectories demonstrate that…"* |
| 8 | **Contributions** | What can others take and use? | *"The framework, datasets, and audit-log toolkit are released as open-source…"* |

---

## Key Terms (for Keywords field in journal submission)

```
Multi-Agent Systems, Predictive Maintenance, Agent Drift,
Semantic Fidelity, Audit-Log Validation, Turbofan Engine Prognostics,
Retrieval-Augmented Generation, Industrial AI Reliability
```

---

## Notes for Authors Before Final Submission

1. **Fill in results placeholders** — Replace the bracketed `[*results placeholder…*]` sentence with concrete numbers from your experiments (accuracy, drift rate, comparison to baselines, etc.).

2. **Verify word count** — IEEE Transactions abstracts must not exceed 250 words. Count programmatically or via Word's word-count tool before submission.

3. **Match journal template** — Some IEEE journals require the abstract to appear in a single unformatted paragraph without subsections. Copy only the abstract paragraph itself (not the guide tables) into the manuscript file.

4. **Cross-reference** — Ensure every claim in the abstract is substantiated by a section in the paper body (the metrics must appear in Section IV, the results in Section VI, etc.).

5. **Metric symbols** — SFS, IGS, and ASI are introduced here; define them again with the same notation in the body of the paper for consistency.
