import { useMemo } from "react";

/**
 * Fixed scenery behind the app's glass panels, echoing /intro: fog with a glow in the current
 * module's colour (set in theme.css), soft bokeh and two chrome strands. Without something
 * behind them, frosted panels would read as flat dark cards.
 */
export function AppBackdrop() {
  const dots = useMemo(() => {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    return Array.from({ length: 60 }, () => {
      const size = 3 + random() ** 2 * 24;
      return { size, left: random() * 100, top: random() * 100, teal: random() < 0.3, opacity: 0.25 + random() * 0.55 };
    });
  }, []);
  return (
    <div className="app-backdrop" aria-hidden="true">
      {dots.map((dot, i) => (
        <span key={i} className={`app-bokeh${dot.teal ? " is-teal" : ""}${dot.size > 14 ? " is-soft" : ""}`}
          style={{ width: dot.size, height: dot.size, left: `${dot.left}%`, top: `${dot.top}%`, opacity: dot.opacity }} />
      ))}
      <svg className="app-strands" viewBox="0 0 400 1000" preserveAspectRatio="none">
        <defs>
          <linearGradient id="app-chrome" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".05" /><stop offset=".45" stopColor="#e9f4f1" stopOpacity=".7" /><stop offset="1" stopColor="#fff" stopOpacity=".08" />
          </linearGradient>
        </defs>
        <path d="M250 -20 C 80 160, 360 330, 200 500 S 60 820, 240 1020" fill="none" stroke="url(#app-chrome)" strokeWidth="2.2" />
        <path d="M150 -20 C 330 170, 40 340, 210 500 S 360 830, 170 1020" fill="none" stroke="url(#app-chrome)" strokeWidth="2.2" />
        <circle className="app-strand-node" cx="205" cy="497" r="4" />
      </svg>
      <div className="app-grain" />
    </div>
  );
}
