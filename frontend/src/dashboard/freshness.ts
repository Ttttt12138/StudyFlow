import type { Versions } from "./types";

// A result is current only when it was computed from the latest state, budget and analysis
// versions. A backend that reports no analysis version does not make results stale.
export function computedFrom(
  result: Versions,
  current: { state_version: number; budget_version: number; analysis_version?: number | null },
) {
  return result.state_version === current.state_version
    && result.budget_version === current.budget_version
    && (current.analysis_version == null || result.analysis_version === current.analysis_version);
}
