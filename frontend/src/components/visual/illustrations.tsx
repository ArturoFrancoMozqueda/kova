/**
 * Spot illustrations for empty states. Inline SVG (no files to precache),
 * brand tokens only, purely decorative: the empty state's title and body
 * carry the meaning.
 */
export type IllustrationName = "register" | "receipt" | "box" | "people" | "calendar" | "chart" | "clipboard" | "truck" | "chat" | "tasks";

const ink = "var(--kova-ink)";
const blue = "var(--kova-blue)";
const soft = "color-mix(in srgb, var(--kova-blue) 14%, white)";
const paper = "#FFFFFF";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden="true" focusable="false" className="shrink-0">
      <ellipse cx="60" cy="86" rx="44" ry="6" fill={soft} />
      {children}
    </svg>
  );
}

const shapes: Record<IllustrationName, React.ReactNode> = {
  register: <>
    <rect x="22" y="44" width="76" height="36" rx="8" fill={ink} />
    <rect x="30" y="20" width="44" height="30" rx="5" fill={paper} stroke={ink} strokeWidth="3" />
    <rect x="36" y="28" width="22" height="4" rx="2" fill={blue} />
    <rect x="36" y="36" width="30" height="3" rx="1.5" fill={soft} />
    <circle cx="40" cy="62" r="3" fill={paper} /><circle cx="52" cy="62" r="3" fill={paper} /><circle cx="64" cy="62" r="3" fill={paper} />
    <rect x="76" y="56" width="14" height="12" rx="3" fill={blue} />
  </>,
  receipt: <>
    <path d="M36 12h48v68l-6-4-6 4-6-4-6 4-6-4-6 4-6-4-6 4z" fill={paper} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
    <rect x="44" y="24" width="32" height="4" rx="2" fill={blue} />
    <rect x="44" y="36" width="24" height="3" rx="1.5" fill={soft} /><rect x="44" y="44" width="28" height="3" rx="1.5" fill={soft} />
    <rect x="44" y="58" width="32" height="5" rx="2.5" fill={ink} />
  </>,
  box: <>
    <path d="M24 34l36-16 36 16v38L60 86 24 72z" fill={paper} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
    <path d="M24 34l36 16 36-16M60 50v36" fill="none" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
    <path d="M42 26l36 16v10" fill="none" stroke={blue} strokeWidth="4" strokeLinecap="round" />
  </>,
  people: <>
    <circle cx="46" cy="36" r="12" fill={blue} /><path d="M24 78c2-16 12-24 22-24s20 8 22 24z" fill={blue} />
    <circle cx="76" cy="40" r="10" fill={paper} stroke={ink} strokeWidth="3" /><path d="M58 80c2-13 9-20 18-20s16 7 18 20z" fill={paper} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
  </>,
  calendar: <>
    <rect x="26" y="20" width="68" height="60" rx="8" fill={paper} stroke={ink} strokeWidth="3" />
    <rect x="26" y="20" width="68" height="16" rx="8" fill={ink} />
    <rect x="38" y="14" width="5" height="12" rx="2.5" fill={blue} /><rect x="77" y="14" width="5" height="12" rx="2.5" fill={blue} />
    {[0, 1, 2, 3].map(column => [0, 1].map(row => <rect key={`${column}-${row}`} x={36 + column * 13} y={44 + row * 14} width="8" height="8" rx="2" fill={column === 2 && row === 0 ? blue : soft} />))}
  </>,
  chart: <>
    <rect x="22" y="16" width="76" height="64" rx="8" fill={paper} stroke={ink} strokeWidth="3" />
    <rect x="34" y="52" width="10" height="18" rx="2" fill={soft} /><rect x="50" y="40" width="10" height="30" rx="2" fill={soft} /><rect x="66" y="30" width="10" height="40" rx="2" fill={blue} />
    <path d="M34 44l18-10 14 6 18-14" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  clipboard: <>
    <rect x="30" y="18" width="60" height="64" rx="8" fill={paper} stroke={ink} strokeWidth="3" />
    <rect x="46" y="12" width="28" height="12" rx="4" fill={ink} />
    <path d="M40 42l5 5 9-10" fill="none" stroke={blue} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="60" y="40" width="20" height="4" rx="2" fill={soft} /><rect x="40" y="58" width="40" height="4" rx="2" fill={soft} /><rect x="40" y="68" width="28" height="4" rx="2" fill={soft} />
  </>,
  truck: <>
    <rect x="16" y="34" width="54" height="34" rx="5" fill={paper} stroke={ink} strokeWidth="3" />
    <path d="M70 44h16l12 12v12H70z" fill={blue} />
    <circle cx="34" cy="72" r="7" fill={ink} /><circle cx="84" cy="72" r="7" fill={ink} />
    <rect x="26" y="44" width="24" height="4" rx="2" fill={soft} />
  </>,
  chat: <>
    <rect x="18" y="20" width="58" height="38" rx="10" fill={paper} stroke={ink} strokeWidth="3" /><path d="M32 58l-4 12 14-12" fill={paper} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
    <rect x="52" y="40" width="52" height="30" rx="10" fill={blue} />
    <rect x="28" y="32" width="30" height="4" rx="2" fill={soft} /><rect x="28" y="42" width="20" height="4" rx="2" fill={soft} />
  </>,
  tasks: <>
    <rect x="26" y="18" width="68" height="62" rx="8" fill={paper} stroke={ink} strokeWidth="3" />
    {[0, 1, 2].map(row => <g key={row}><rect x="36" y={30 + row * 16} width="9" height="9" rx="2.5" fill={row === 0 ? blue : soft} /><rect x="50" y={32 + row * 16} width={row === 2 ? 22 : 34} height="4" rx="2" fill={soft} /></g>)}
  </>,
};

export function EmptyIllustration({ name }: { name: IllustrationName }) {
  return <Frame>{shapes[name]}</Frame>;
}
