# Agent-first student flow

Current specification: [shared student loan contract](student-loan-contract.md), effective 2026-10-15.

Start with school costs and comparisons. After choosing a school, the Agent recommends a loan product and asks for the desired amount. It prepares one quote, responds to monthly-payment, interest and amount concerns with recalculation, and offers “Apply with this plan”. That action reviews the current quote before the user explicitly submits. A refusal pauses the pitch. Manual editing remains in My plan. A simulated admission notice is attached on submission; the full-course cost cap excludes fees. The student completes other documents and explicitly signs before scheduled payments to the school.

Only `DRAFT` and `CONFIRMED` plan states remain. To-dos, bills and wallet tools open after submission. The conversation does not extract savings or family support and no longer proposes enrollment or bookkeeping actions. Loan repayments and financial audit remain.

See the contract for exact endpoints, migrated data, deletion scope and preview generation. [Earlier design](legacy/agent-first-before-20261015.md) is archived and superseded for the student flow.
