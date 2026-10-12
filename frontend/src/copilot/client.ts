import { getLang, translate } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import { sortNotifications } from "./logic";
import type { CopilotSnapshot, Notification, ReadinessState, ReviewPage } from "./types";

function errorText(error: unknown) {
  return error instanceof WalletApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : translate(getLang(), "common.err.section");
}

/** Readiness state, the review queue and notifications load and fail independently. */
export async function loadCopilot(client: WalletClient): Promise<CopilotSnapshot> {
  const [state, reviews, notifications] = await Promise.allSettled([
    client.get<ReadinessState>("readiness/state/"),
    client.get<ReviewPage>("review-queue/"),
    // DjangoClient unwraps {data: [...]} and drops unread_count, so the count is derived from read_at.
    client.get<Notification[]>("readiness/notifications/"),
  ]);
  const failed = (result: PromiseSettledResult<unknown>) => result.status === "rejected" ? errorText(result.reason) : undefined;
  const errors = Object.fromEntries(Object.entries({ state: failed(state), reviews: failed(reviews), notifications: failed(notifications) })
    .filter(([, text]) => text)) as CopilotSnapshot["errors"];
  return {
    state: state.status === "fulfilled" ? state.value : null,
    reviews: reviews.status === "fulfilled" ? reviews.value.items ?? [] : [],
    notifications: notifications.status === "fulfilled" && Array.isArray(notifications.value) ? sortNotifications(notifications.value) : [],
    errors,
  };
}
