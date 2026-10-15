import { useCallback, useSyncExternalStore } from "react";
import { messages, type MessageKey } from "./messages";

// Interface language. Financial results, amounts and codes still come from Django; the backend
// localizes its own error messages from the Accept-Language header the API client sends.
export type Lang = "en" | "zh";
const STORAGE_KEY = "studyflow.lang";
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch { /* storage blocked: use the default */ }
  // English is the default whatever the browser language; the 中文 switch is remembered once chosen.
  return "en";
}

let current: Lang = initial();
syncDocument();

function syncDocument() {
  if (typeof document !== "undefined") document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
}

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* per-viewer convenience only */ }
  syncDocument();
  listeners.forEach((listener) => listener());
}

/** Value for the Accept-Language header; Django's LocaleMiddleware maps it to en / zh-hans. */
export function acceptLanguage(): string {
  return current === "zh" ? "zh-Hans" : "en";
}

/** BCP 47 locale for Intl formatting of dates and times shown next to translated text. */
export function intlLocale(lang: Lang = current): string {
  return lang === "zh" ? "zh-CN" : "en";
}

export function translate(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  // An unknown key (e.g. a new backend code mapped dynamically) shows the key rather than failing.
  const text: string = messages[lang][key] ?? messages.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  // Stable per language so callbacks and effects that depend on t do not rerun every render.
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  return { lang, setLang, t };
}

export type { MessageKey };
