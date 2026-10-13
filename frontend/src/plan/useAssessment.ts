import { useCallback, useEffect, useRef, useState } from "react";
import { getLang, translate } from "../i18n";
import type { WalletClient } from "../wallet/client";
import type { AssessmentInputs, PlanningAssessment } from "./assessmentTypes";
import type { Plan } from "./types";

/** A malformed reply shows the panel error instead of breaking the workspace around it. */
function checked(value: PlanningAssessment) {
  if (!value || typeof value.version !== "number" || !Array.isArray(value.quotes)
    || (value.inputs !== null && typeof value.inputs !== "object")) throw new Error(translate(getLang(), "common.err.section"));
  return value;
}

export function useAssessment(client: WalletClient, plan: Plan | null, preview: boolean) {
  const [data, setData] = useState<PlanningAssessment | null>(null);
  const [inputs, setInputs] = useState<AssessmentInputs | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0), latest = useRef(inputs), changed = useRef(false);
  const scope = useRef("");
  scope.current = `${plan?.id}:${plan?.version}`;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  latest.current = inputs;
  const refresh = useCallback(async () => {
    if (!plan) return;
    const requestScope = scope.current;
    const value = checked(await client.get<PlanningAssessment>("planning/assessment/"));
    if (requestScope !== scope.current || value.version < version.current) return;
    version.current = value.version;
    setData(value);
    if (!changed.current) setInputs(value.inputs);
  }, [client, preview, plan?.id, plan?.version]);
  useEffect(() => { changed.current = false; version.current = 0; setDirty(false); setData(null); setInputs(null);
    void refresh().catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const persist = useCallback((draft: boolean) => {
    const snapshot = latest.current;
    const requestScope = scope.current;
    if (!snapshot || !plan || preview) return Promise.resolve(null);
    const action = async () => {
      if (requestScope !== scope.current) return null;
      setBusy(true); setError("");
      try {
        const value = checked(await client.post<PlanningAssessment>("planning/assessment/", {
          expected_version: version.current, plan_version: plan.version, inputs: snapshot, draft,
        }, `assessment:${plan.id}:${version.current}:${draft ? "draft" : "evaluate"}`));
        if (requestScope !== scope.current) return null;
        version.current = value.version; setData(value);
        if (JSON.stringify(latest.current) === JSON.stringify(snapshot)) { changed.current = false; setDirty(false); }
        return value;
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); throw e; }
      finally { setBusy(false); }
    };
    const pending = queue.current.catch(() => undefined).then(action);
    queue.current = pending;
    return pending;
  }, [client, plan?.id, plan?.version, preview]);

  useEffect(() => {
    if (!dirty || busy || error) return;
    const timer = setTimeout(() => { void persist(true).catch(() => undefined); }, 1200);
    return () => clearTimeout(timer);
  }, [inputs, dirty, busy, error, persist]);
  const edit = (value: AssessmentInputs) => { changed.current = true; setError(""); setDirty(true); latest.current = value; setInputs(value); };
  return { data, inputs, edit, busy, dirty, error, setError, refresh, persist };
}
