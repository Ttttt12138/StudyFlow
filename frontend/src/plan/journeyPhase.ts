import type { Plan } from "./types";

export type JourneyPhase = 0 | 1 | 2;
type StoragePort = Pick<Storage, "getItem" | "setItem">;
const key = (account: string) => `studyflow.journey.v1:${account}`;
export function journeyPhase(status: Plan["status"] | null): JourneyPhase {
  return status === "ENROLLED" ? 2 : status === "CONFIRMED" ? 1 : 0;
}
export function needsJourneyIntro(account: string, phase: JourneyPhase | undefined, seen: number) {
  return !!account && phase !== undefined && phase > seen;
}
export function readJourney(account: string, storage?: StoragePort) {
  try {
    const value = (storage ?? localStorage).getItem(key(account));
    return value !== null && /^[012]$/.test(value) ? Number(value) : -1;
  } catch { return -1; }
}
export function rememberJourney(account: string, phase: JourneyPhase, storage?: StoragePort) {
  try { (storage ?? localStorage).setItem(key(account), String(Math.max(phase, readJourney(account, storage)))); }
  catch { /* The mounted workspace still remembers dismissal if storage is unavailable. */ }
}
