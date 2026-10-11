// Shapes returned by backend/finance/agent_api.py (session_record) and agent_runner.py.
export type StepStatus = "OK" | "ERROR" | "PROPOSED" | "DENIED" | "FINAL";
export type PendingStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "EXPIRED" | "FAILED";

export type AgentStep = {
  id: string;
  number: number;
  tool: string;
  tier: string;
  arguments: Record<string, unknown>;
  rationale: string;
  status: StepStatus;
  result: Record<string, unknown>;
  created_at: string;
};

export type PendingAction = {
  id: string;
  session: string;
  step: string;
  action: string;
  tool: string;
  arguments: Record<string, unknown>;
  target_id: string;
  amount: string;
  currency: string;
  status: PendingStatus;
  expires_at: string;
  decided_at: string | null;
  result: Record<string, unknown>;
  version: number;
  created_at: string;
};

export type AgentSession = {
  id: string;
  goal: string;
  locale: "zh" | "en";
  mode: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  final_answer: string;
  error_code: string;
  write_count: number;
  created_at: string;
  updated_at: string;
  steps: AgentStep[];
  pending_actions: PendingAction[];
  is_simulated: boolean;
};

export type Approval = {
  id: string;
  action: string;
  target_id: string;
  amount: string;
  currency: string;
  status: string;
  reason?: string;
  expires_at: string;
  created_at?: string;
  version: number;
};

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };
