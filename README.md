# NASA CMAPSS Predictive Maintenance — Multi-Agent AI Framework

A Multi-Agent System (MAS) for turbofan engine predictive maintenance using real NASA CMAPSS data, GPT-4o, RAG knowledge base, and drift validation.

## Live Demo
🌐 **[View on GitHub Pages](https://cloudivy.github.io/cmapss-predictive-maintenance/)**

## What This Does

```
Real NASA Sensor Data  →  Sensor Agent  →  Diagnosis Agent (GPT-4o)
                                                    ↓
                              Maintenance Agent (GPT-4o)  →  Drift Validator
                                                                     ↓
                                              RAG Knowledge Base (NASA/ISO/FAA)
```

## Dataset

**NASA CMAPSS** — Commercial Modular Aero-Propulsion System Simulation
- 100 turbofan engines run to failure (FD001)
- 21 sensor measurements per flight cycle
- Source: [Saxena et al. 2008, NASA TM-2008-215546](https://ntrs.nasa.gov/citations/20090029214)

## RAG Knowledge Base (10 real documents)

| Document | Source |
|----------|--------|
| Engine specification | NASA TM-2008-215546 |
| Normal sensor ranges | Saxena et al. 2008 |
| HPC fault pattern | NASA paper + ISO 13379-1 |
| Fan fault pattern | NASA paper + AGARD-R-785 |
| RUL prognostics | ISO 13381-1:2015 |
| Borescope inspection | FAA AC 43.13-1B |
| Compressor wash | GE Aviation Manual |
| Fan inspection | AGARD-R-785 |
| Priority rules | ISO 13381-1 + SAE JA1012 |
| Historical records | CMAPSS training statistics |

## Setup

### Download Data
```bash
pip install pandas numpy
python data/setup_cmapss.py
```

### Run Frontend Locally
```bash
cd frontend
npm install
npm run dev
```

## Agents

| Agent | Technology | Purpose |
|-------|-----------|---------|
| Sensor Monitor | Pure JS | Parse real sensor readings, flag anomalies |
| Diagnosis Agent | GPT-4o streaming | Identify fault mode (HPC_DEG / FAN_DEG) |
| Maintenance Planner | GPT-4o streaming | Generate work order with real procedure IDs |
| Drift Validator | Deterministic JS | Validate predictions against RAG ground truth |

## Drift Validation

Every agent prediction is validated against the RAG knowledge base:
- **Fault match**: Does agent agree with RAG threshold-based diagnosis?
- **Priority match**: Does agent assign correct RUL-based priority?
- **Procedure cited**: Does agent reference a real procedure ID?
- **Drift Score**: 0 = fully grounded, 100 = complete drift

## Paper Abstract

See [`ABSTRACT.md`](./ABSTRACT.md) for a full IEEE-style structured abstract (with motivation, method, metrics, results placeholders, and contributions) ready for adaptation to a journal manuscript.

## References

- Saxena A., Goebel K., Simon D., Eklund N. (2008). *Damage Propagation Modeling for Aircraft Engine Run-to-Failure Simulation*. NASA TM-2008-215546
- ISO 13381-1:2015 — Condition monitoring — Prognostics
- ISO 13379-1:2012 — Condition monitoring — Diagnostics
- FAA AC 43.13-1B — Aircraft Inspection and Repair
- SAE JA1012 — Reliability-Centred Maintenance Standard
