import { acceptLanguage, getLang, translate } from "../../i18n";
import { WalletApiError } from "../../wallet/client";
import type { Verification } from "./logic";

/** Anonymous check: VerifyView has no authentication classes, so no session cookie or CSRF token is sent or needed. */
export async function verifyStatement(statement: string): Promise<Verification> {
  let response: Response;
  try {
    response = await fetch("/api/v2/credit/statements/verify/", { method: "POST", credentials: "omit", cache: "no-store",
      headers: { "Accept": "application/json", "Accept-Language": acceptLanguage(), "Content-Type": "application/json" },
      body: JSON.stringify({ statement }) });
  } catch { throw new WalletApiError(0, { detail: translate(getLang(), "common.err.unreachable") }); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new WalletApiError(response.status, payload);
  if (!payload || typeof payload !== "object" || !("data" in payload)) throw new WalletApiError(response.status, { detail: translate(getLang(), "common.err.notJson") });
  return (payload as { data: Verification }).data;
}
