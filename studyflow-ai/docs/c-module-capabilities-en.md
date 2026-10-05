# C Module — Implemented Capabilities

Current package version: **0.2.0**. Includes the original data and AI capabilities (v1) and the admission budget and funding assistance capabilities (v2).

| Capability | Implemented Functionality |
|---|---|
| Material Import and Extraction | Imports CSV transaction records, email text, and text-based PDFs. v2 also supports Chinese and English admission materials and specified official website URLs to extract semester details, costs, and related information. |
| Source Evidence Validation | Checks whether amounts, dates, currencies, payees, and other extracted fields are supported by the source text. Preserves quotations and source locations, and flags missing or conflicting information for review. |
| Recurring Expense Detection | Identifies recurring expenses, such as rent, from transaction records across consecutive months and marks the results as inferred. |
| AI Classification and Plan Generation | Integrates Jev for classification and routing, and a large language model for information extraction and candidate plan generation. Supports both offline mock mode and live model calls. |
| Cost Completeness Assessment | Distinguishes known, estimated, and missing costs. Detects duplicate costs and inconsistencies in campus or academic year information. |
| Multi-Currency Exchange Rate Retrieval | Retrieves exchange rates and records their direction, date, and source. Checks for stale rates or invalid dates. A successful live CNY/THB lookup has been recorded. |
| Combined Funding Options and Loan Explanations | Generates candidate funding combinations using budgets, funding sources, and loan quotes supplied by the B backend. Explains loan fees and repayment schedules provided by B. |
| Proactive Check Workflow | Coordinates state retrieval, risk or completeness checks, candidate generation, backend validation, and auditing. Handles repeated checks, state version changes, and retries after failures. |
| Integration Deliverables | Provides Python interfaces, a CLI, JSON Schemas, examples, and integration documentation. v1 also includes HTTP routes that can be mounted in the B backend. |
