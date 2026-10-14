# StudyFlow — Formal English Demo Script

Current formal film: [StudyFlow_Demo_EN.mp4](../evidence/demo-live-20261014/StudyFlow_Demo_EN.mp4). Runtime: approximately 3 minutes 34 seconds. English narration and burned-in captions; 1920 × 1080 at 30 fps.

The film shows actual browser footage from the successful fixed-snapshot live-model take on 14 October 2026. It replaces the historical multi-role demo as the submission video. All financial transactions are simulated.

## Timed narration

### 00:00–00:13 · Know the cost. Plan the gap.

StudyFlow helps students compare the cost of studying abroad, then plan how to cover a funding gap. This demonstration uses live AI guidance and simulated financial transactions.

### 00:13–00:24 · One conversation

We start in the English student workspace. The main action is a price question. Students can compare schools before providing financial information.

### 00:24–00:44 · Whole-course costs

We ask the live model to compare four universities in Thailand. It returns whole-course estimates in Thai baht, with each course duration visible. PSU Phuket is the lowest current estimate in this comparison. These are sourced sample estimates, which students must check with the university.

### 00:44–01:06 · Context is remembered

Next, we choose PSU Phuket and declare ten thousand baht in available study funds. The assistant saves this information and opens the funding options. The full-course estimate is one million, thirteen thousand, eight hundred baht. The resulting funding gap is one million, three thousand, eight hundred baht.

### 01:06–01:23 · Guidance before commitment

We ask how much can be borrowed, without submitting an application. The live answer uses the server's pre-check result. This is a simulated ceiling based on the funding gap. It is not a bank offer or an assessment of the family's ability to repay.

### 01:23–01:37 · No transfer from this request

We also ask the assistant to skip confirmation and transfer money before enrollment. In this recorded response, it defers the transfer. No money tool executes and the plan remains a draft.

### 01:37–01:56 · Review the repayment plan

The student chooses a twenty thousand baht commercial study loan example, at four point five percent over sixty months. The server calculates the schedule and a monthly installment of three hundred seventy-two baht and eighty-six satang. This loan covers only part of the funding gap.

### 01:56–02:09 · A deliberate application

The student reviews the confirmation dialog and explicitly confirms the plan and application. The simulated application is approved. The assistant has not submitted it on the student's behalf.

### 02:09–02:23 · Review the checklist

Before signing, the student completes the displayed document checklist. These are demo declarations. They do not represent verification of uploaded identity, admission, or financial documents.

### 02:23–02:34 · Confirm the simulated contract

Signing requires another explicit confirmation. The resulting loan schedules tuition payments to the school, rather than crediting the borrowed amount to the student's wallet.

### 02:34–02:51 · School-directed payouts

The signed state shows the school's payout schedule and the next repayment. For the repayment demonstration, we advance the isolated demo clock and add a separate ten thousand baht synthetic wallet top-up. No real funds are received or transferred.

### 02:51–03:07 · Repayment needs confirmation

The student reviews the first installment and confirms repayment. A password check is required before the server executes this simulated payment. The live model does not type the password or authorize the transaction.

### 03:07–03:19 · The first installment is paid

The first installment is now marked paid. The recording is backed by browser assertions and saved model-call traces, linking the live conversation to the actual application state.

### 03:19–03:34 · Cost clarity. Informed choices. User control.

StudyFlow connects cost comparison, funding guidance, and a confirmed loan journey. Live AI explains the options. The server calculates the amounts, and the student confirms the financial actions.

## Evidence and production

[Recording and verification](../evidence/demo-live-20261014/README.md) · [English SRT captions](../evidence/demo-live-20261014/StudyFlow_Demo_EN.srt) · [Edit manifest](../evidence/demo-live-20261014/edit-manifest.json).

The selected English journey contains four live user turns; the same browser run also verifies the Chinese phone-width flow. Financial amounts are asserted against the server state. Idle waits are shortened and final frames held for narration; the model answers and app results are retained.

Narration uses Microsoft Zira Desktop synthetic speech. No background music is included. The source scripts are [build_demo_video.py](../scripts/build_demo_video.py) and [narrate_demo_video.ps1](../scripts/narrate_demo_video.ps1). Reproduction commands and the preserved failed attempts are documented in the recording evidence.
