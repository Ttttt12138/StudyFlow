import type { ReactNode } from "react";
import { useEmbedded } from "./context";

export function ModulePresentation({ className, fullPage, children }: {
  className: string; fullPage: ReactNode; children: ReactNode;
}) {
  return useEmbedded() ? <div className={`embedded-module ${className}`}>{children}</div> : fullPage;
}
