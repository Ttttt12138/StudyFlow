export type WalletBalance = {
  currency: string;
  balance: string;
  available_balance: string;
  is_home: boolean;
  indicative_home_value: string | null;
  valuation: unknown;
};
export type WalletBalances = { home_currency: string; balances: WalletBalance[];
  /** Every currency the wallet can hold, for top-ups (absent from older responses). */
  supported_currencies?: string[]; is_simulated: boolean };
export type Corridor = {
  id: string; code: string; provider: string; tier: string;
  source_currency: string; target_currency: string;
  min_amount: string; max_amount: string;
  settlement_min_days: number; settlement_days: number;
  is_simulated: boolean;
};
export type Quote = {
  id: string; corridor_id?: string; route_name: string; source_currency: string;
  target_currency: string; send_amount?: string; quoted_amount?: string;
  net_received?: string; rate: string; sender_fee: string; receiver_fee: string | number | null;
  settlement_min_days: number; settlement_days: number; expires_at: string;
  rate_source: string; rate_date: string | null; is_mock: boolean;
  consumed_at?: string | null;
};
export type Beneficiary = { id: string; name: string; destination_label: string; verified: boolean };
export type OrderStatus = "CREATED" | "SUBMITTED" | "IN_TRANSIT" | "DELIVERED" | "RECONCILED" | "CANCELLED" | "EXPIRED" | "UNKNOWN" | "REFUNDED";
export type Order = {
  id: string; version: number; quote: string; status: OrderStatus; effective_status: OrderStatus;
  recipient: "SELF" | "BENEFICIARY"; beneficiary: string | null; purpose: string;
  reference: string; send_currency: string; send_amount: string; sender_fee: string;
  receive_currency: string; receive_amount: string; rate: string; total_cost: string;
  expected_earliest: string | null; expected_latest: string | null; deadline: string | null;
  submitted_at: string | null; delivered_on: string | null; failure_reason: string;
  history: Array<{ from: string; to: string; version: number; at: string; note: string }>;
  is_simulated: boolean;
};
export type Approval = {
  id: string; action: string; target_id: string; amount: string; currency: string;
  status: string; expires_at: string; version: number; created_at?: string;
};
export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };
export type PolicyError = { detail?: string; code?: string; message?: string; policy?: { tier?: string; requires?: string[] } };
export type WalletSnapshot = {
  balances: WalletBalances | null; corridors: Corridor[]; beneficiaries: Beneficiary[];
  orders: Order[]; approvals: Approval[];
  errors: Partial<Record<"balances" | "corridors" | "beneficiaries" | "orders" | "approvals", string>>;
};
