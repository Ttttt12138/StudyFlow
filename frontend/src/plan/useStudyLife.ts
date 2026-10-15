import { useCallback, useEffect, useRef, useState } from "react";
import { getLang, translate } from "../i18n";
import type { WalletClient } from "../wallet/client";
import type { StudyLife } from "./lifeTypes";

export function useStudyLife(client: WalletClient, scope: string, preview: boolean) {
  const [data, setData] = useState<StudyLife | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const writing = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await client.get<StudyLife>("planning/life/");
      // A malformed reply shows the section error instead of breaking the conversation it sits in.
      if (!next || !Array.isArray(next.items) || !Array.isArray(next.upcoming)) throw new Error(translate(getLang(), "common.err.section"));
      if (request === sequence.current) { setData(next); setError(""); }
    } catch (reason) { if (request === sequence.current) setError(String(reason instanceof Error ? reason.message : reason)); }
  }, [client]);
  useEffect(() => {
    if (!scope) { setData(null); return; }
    void refresh();
    const update = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("studyflow:write", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    const timer = preview ? undefined : window.setInterval(update, 60000);
    return () => { ++sequence.current; window.clearInterval(timer); window.removeEventListener("studyflow:write", update);
      window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [scope, preview, refresh]);
  const run = async (path: string, body: unknown) => {
    if (preview || writing.current) return;
    writing.current = true;
    setBusy(true); setError("");
    try { const result = await client.post(path, body, `study-life:${path}`); await refresh(); return result; }
    catch (reason) { await refresh(); setError(reason instanceof Error ? reason.message : String(reason)); throw reason; }
    finally { writing.current = false; setBusy(false); }
  };
  return { data, error, busy, refresh, run, client };
}
export type LifeControl = ReturnType<typeof useStudyLife>;
