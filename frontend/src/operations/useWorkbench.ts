import { useCallback, useEffect, useRef, useState } from "react";
import { WalletApiError, type WalletClient } from "../wallet/client";
import type { OpsFilters, OpsWorkbench } from "./types";
import { workbenchPath } from "./workbench";

export function useWorkbench(client: WalletClient, filters: OpsFilters) {
  const path = workbenchPath(filters);
  const sequence = useRef(0);
  const [state, setState] = useState<{ data: OpsWorkbench | null; error: Error | null; loading: boolean; path: string }>({ data: null, error: null, loading: true, path });
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setState(previous => ({ ...previous, loading: true }));
    try {
      const data = await client.get<OpsWorkbench>(path);
      if (request !== sequence.current) return null;
      setState({ data, error: null, loading: false, path });
      return data;
    } catch (reason) {
      if (request !== sequence.current) return null;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const denied = error instanceof WalletApiError && [401, 403].includes(error.status);
      setState(previous => ({ data: denied ? null : previous.data, error, loading: false, path: previous.path }));
      return null;
    }
  }, [client, path]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh]);
  return { ...state, loading: state.loading || state.path !== path && !state.error, refresh,
    stale: !!state.error || state.path !== path };
}
