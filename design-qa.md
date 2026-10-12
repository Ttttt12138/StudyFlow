# StudyFlow orbital workspace design QA — 2026-10-12

final result: passed

## Reference and state

- Approved source: `output/orbital-workspace-20261012/design-reference.png` (copied without alteration from the selected generated image).
- Rendered implementation: `output/orbital-workspace-20261012/final/orbital-reference-state.png`.
- Source and implementation: 1586 × 992 pixels. Browser viewport 1586 × 992 CSS pixels, deviceScaleFactor 1. No density normalization required.
- State: Chinese, enrolled/life-assistant view. Mocked API supplies 8,620 THB recorded expenses, 24,300 THB budget, 15,680 THB remaining and a 6,500 THB housing bill due 2026-10-15. These are controlled visual fixtures, not the user's records.
- Full comparison: `output/orbital-workspace-20261012/comparison-final/comparison-full.png`.
- Focused budget/bill/tool comparison: `output/orbital-workspace-20261012/comparison-final/comparison-status.png`.
- Comparisons put the source and browser capture together in one browser-rendered image. Reproducible via `frontend/scripts/compare-orbital-design.mjs`.

## Comparison history and fixes

1. Initial captures under `initial/`: left column and globe were smaller than the approved composition; conversation body text was undersized. Expanded the wide-screen left track to a maximum 300px, kept the center flexible, increased conversation text to 16px. School geography now falls back to the existing school-detail endpoint when absent from the current conversation; no invented map marker.
2. First combined comparison under `comparison/`: [P2] the budget/facts hierarchy was too fine, and [P2] the mobile status dialog's large globe pushed budget information below the opening view. Increased rail heading/facts sizes and arc weight, added the chart's zero/full scale and data endpoint, compacted mobile stages into three columns and omitted the decorative globe inside that dialog.
3. Final browser recapture and combined comparison under `comparison-final/`: earlier findings resolved. The mobile opening view now exposes the budget. No remaining actionable P0/P1/P2 finding.

## Required fidelity surfaces

- **Fonts/typography:** retained the introduction's installed Space Grotesk, Chinese system fallbacks and numeric styling. Phase/amount hierarchy, upright readable text and bilingual wrapping inspected. Tool hints remain smaller secondary text.
- **Spacing/layout:** open three-column desktop layout, no enclosing sidebar cards, one persistent central conversation, input visible at the bottom. At 1100–1279px the left rail moves into the status dialog; below 1100px both rails do. Opening a tool hides side summaries without remounting the conversation. Desktop rail contents can scroll independently on shorter viewports.
- **Colors/tokens:** existing mint/ivory/forest theme; gold for unpaid/overdue bills. Low contrast generated atmosphere supports text. No new continuous animation; existing reduced-motion support retained.
- **Image quality:** generated transparent globe (1254 × 1254 RGBA) and atmosphere (1586 × 992 RGB), both copied into `frontend/public/images/`. Alpha was inspected. Phosphor library supplies standard icons, imported individually. The budget arc is a semantic SVG data chart tied to the actual ratio, not a rasterized financial value.
- **Copy/content:** school sample and simulated finance labels retained. Plan date is explicitly planned; passage of that date never confirms enrollment. Daily spending and unpaid bills are separately labeled. School location is real catalog metadata or an explicit unknown state. Old-stage navigation preserves actual enrolled status. Conversation text remains the service response.

## Intentional production differences

- Retained the existing role switch, tool shortcuts, journey replay and preparation/daily guide because they are working product flows. The design image omitted several of these controls.
- The app uses real response content; the source's compact expense confirmation row is not fabricated as a new assistant message.
- The gauge draws 35.5% of its 270-degree range for the example. The generated reference's luminous arc was not mathematically proportional. Over-budget labels remain uncapped while the drawn arc stops at 100%.
- The decorative globe has no hard-coded Bangkok marker: the same surface supports all catalog schools. Verified location appears as editable UI text below it.
- The existing top simulation/language/navigation strip remains intact. The generated reference rearranged some global controls.

## Interaction and responsive checks

- Automated captures: all three phases × 1440/1024/375px × Chinese/English (18 views), plus the 1586px reference state and mobile status dialog.
- Opened final full/focused comparisons, mobile dialog, 1440px Chinese consultation, 1024px English life view and 375px Chinese life view; inspected earlier English preparation and desktop/mobile captures during iteration.
- All tested widths: no document horizontal overflow; composer remains within viewport.
- Tested keyboard Escape/focus return, status-to-tool handoff, completed-phase return, preserved drafts, browser history, wallet section links, zero-write preview, stale-refresh retry and account clearing.
- Mocked browser regression 22/22 passed; after final visual refinements, focused regression 11/11 passed, including the previously separate intro-link test. No captured page errors in the final visual matrix.
- Actual Django/PostgreSQL planning journey 1/1 passed using the independent database with the rule planner and fixture rates. This is not live LLM or real-money evidence.
- Final original-port check exposed a React context error while two Vite servers shared the dependency cache. Isolated the validation cache and explicitly deduplicated React/React DOM. The same read-only preview navigation test then passed on both 5173 and 5194; type checking and production build passed again. Evidence: `dev-port-final/` and `cache-isolation-final/`.

## Follow-up polish

- [P3] The generated globe is intentionally subdued; a future optimization can encode the two raster assets more compactly. They currently total about 2.96 MB.
- Existing >500kB build chunk warnings remain. Production build and type checking pass.

## Implementation checklist

- [x] Functional status rails and valid empty/error states.
- [x] Source-grounded imagery and standard icon assets.
- [x] Responsive dialog, tools and conversation continuity.
- [x] Final combined visual comparison and focused inspection.
- [x] Separate mock, UI and actual-backend evidence.
