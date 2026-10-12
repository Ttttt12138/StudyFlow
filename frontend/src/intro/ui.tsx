import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useReveal, useScramble } from "./motion";

/** Section heading that resolves out of scrambled glyphs the first time it scrolls into view. */
export function Heading({ level: Tag = "h2", text, className, id, ready = true }: { level?: "h1" | "h2"; text: string; className?: string; id: string; ready?: boolean }) {
  const [ref, visible] = useReveal<HTMLHeadingElement>();
  const shown = useScramble(text, visible && ready);
  return (
    <Tag ref={ref} className={className} id={id}>
      <span className="intro-visually-hidden">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </Tag>
  );
}

export function Reveal({ children, className = "", as: Tag = "div", style }: { children: ReactNode; className?: string; as?: "div" | "li" | "section"; style?: CSSProperties }) {
  const [ref, visible] = useReveal<HTMLDivElement>();
  return <Tag ref={ref as never} className={`intro-reveal${visible ? " is-visible" : ""} ${className}`} style={style}>{children}</Tag>;
}

/** Cards light up around the pointer; the position is passed to CSS as custom properties. */
export function trackPointer(event: PointerEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - box.top}px`);
}
