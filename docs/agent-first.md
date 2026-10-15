# Agent-first student flow

Current specification: [shared student loan contract](student-loan-contract.md), effective 2026-10-15.

Start with school costs and comparisons. The user enters the desired loan amount; the UI asks for product, term and repayment method, shows the estimate and submits a mandatory loan application with plan confirmation. A simulated admission notice is attached automatically. Automatic approval uses the full-course cost cap, without adding fees. The student completes other documents and explicitly signs before scheduled payments to the school.

Only `DRAFT` and `CONFIRMED` plan states remain. To-dos, bills and wallet tools open after submission. The conversation does not extract savings or family support and no longer proposes enrollment or bookkeeping actions. Loan repayments and financial audit remain.

See the contract for exact endpoints, migrated data, deletion scope and preview generation. [Earlier design](legacy/agent-first-before-20261015.md) is archived and superseded for the student flow.
