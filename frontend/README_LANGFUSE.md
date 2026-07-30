# Langfuse Integration — NASA CMAPSS Predictive Maintenance

This document explains how to enable **Langfuse** observability in the CMAPSS multi-agent system.

---

## What Is Traced

Each time you click **"Analyse"** for an engine, a root trace named `cmapss-analysis` is created containing:

```
cmapss-analysis  (root trace — tagged with dataset subset + RUL band)
├── sensor-agent        (event — pure JS, instant)
├── diagnosis-agent     (span — GPT-4o KB tool-use loop)
│   ├── kb-query-1      (event — sensor / fault_type queried)
│   ├── kb-query-2
│   └── …
├── maintenance-agent   (span — GPT-4o streaming)
└── drift-validator     (span — deterministic)
    ├── sfs-signal-*    (events — each SFS check)
    └── igs-signal-*    (events — each IGS check)
```

### Custom Scores Attached to Every Trace

| Score name          | Range  | Pass threshold |
|---------------------|--------|----------------|
| `sfs_score`         | 0 – 1  | ≥ 0.75         |
| `igs_score`         | 0 – 1  | ≥ 0.75         |
| `asi_score`         | 0 – 1  | ≥ 0.75         |
| `kb_call_count`     | 0 – 1  | ≥ 0.33 (≥ 1 query) |
| `agent_coordination`| 0 or 1 | = 1            |
| `semantic_fidelity` | 0 or 1 | = 1            |

---

## Quick Setup

### 1. Create a Langfuse account

Sign up at <https://cloud.langfuse.com> (free tier available) or self-host.

### 2. Get your Public Key

`Settings → API Keys → Create new key`  
Copy the **Public Key** (starts with `pk-lf-…`).

> The frontend uses the **public key only** — no secret key is sent to the browser.

### 3. Configure environment variables

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local and fill in your public key:
VITE_LANGFUSE_PUBLIC_KEY=pk-lf-your-key-here
```

### 4. Start the app

```bash
npm run dev
```

Traces appear in your Langfuse dashboard within a few seconds of each analysis run.

---

## Langfuse Dashboard Usage

### Traces view

- Filter by `name = cmapss-analysis`
- Use tags to filter by dataset subset (e.g. `FD001`) or RUL band (`rul_20`)
- Click any trace to see the full agent span hierarchy

### Metrics / Scores

- Navigate to **Scores** and filter by `sfs_score`, `igs_score`, or `asi_score`
- Compare average scores across engine IDs using the grouping controls

### Example dashboard queries

**Average ASI per engine (last 7 days)**
```
Scores → asi_score → Group by: session_id
```

**Find high-drift runs (ASI < 0.75)**
```
Traces → Filter: score(asi_score) < 0.75 → Sort by: timestamp DESC
```

**KB call distribution**
```
Scores → kb_call_count → Histogram view
```

### Alerts (Langfuse Cloud)

Set up a **Score Alert** on `asi_score < 0.75` to receive notifications when the agent pipeline drifts below the stability threshold.

---

## Architecture Notes

- Langfuse is **optional** — if `VITE_LANGFUSE_PUBLIC_KEY` is not set the app operates normally with no-op stubs.
- The `langfuse` SDK calls `flushAsync()` after each analysis run to ensure traces are shipped before the user navigates away.
- No secret keys are stored or transmitted from the browser; only the public key is used.
- The `kbCallLog` audit trail from `diagnosisAgent.js` is the primary source of truth for SFS scoring; Langfuse records it as span events for full auditability.

---

## File Reference

| File | Purpose |
|------|---------|
| `src/lib/langfuseClient.js` | Langfuse SDK initialisation; exports `createTrace` and `flushAsync` with no-op fallback |
| `src/lib/langfuseEvaluators.js` | `scoreTrace()` — attaches SFS / IGS / ASI / KB / coordination scores to a trace |
| `src/agents/tracedDiagnosisAgent.js` | Wraps `streamDiagnosis()` with a Langfuse span; logs each KB query as an event |
| `src/agents/tracedMaintenanceAgent.js` | Wraps `streamMaintenance()` with a Langfuse span |
| `src/agents/tracedDriftValidator.js` | Wraps `validateDrift()` with a Langfuse span; logs every SFS/IGS signal |
| `src/App.jsx` | Creates the root trace; calls traced agents; finalises scores |
