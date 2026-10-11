export type Evidence = { id: string; title: string; location: string; quote: string };
export type Field = { id: string; label: string; original: string | null; status: 'known' | 'estimated' | 'missing'; required: boolean; kind?: 'amount' | 'date' | 'currency'; evidence: Evidence[]; alternatives?: { value: string; source: string }[] };
export type Admission = { id: string; demo: boolean; fields: Field[] };
export type Review = { corrections: Record<string, string>; confirmed: boolean };
export type Scenario = 'complete' | 'missing' | 'conflict';
