// design-sync only: extends the app's Tailwind config with a curated safelist
// so the CSS shipped to claude.ai/design carries the Kova utility vocabulary
// even for classes not currently used in app source. Run from frontend/:
//   npx tailwindcss -c ../.design-sync/tailwind.dssync.config.js -i src/styles.css -o .ds-css/compiled.css
import base from "../frontend/tailwind.config.js";

const COLOR_NAMES =
  "kova-blue|kova-blue-light|kova-ink|kova-mist|kova-growth|kova-muted|kova-tertiary|kova-border|kova-danger|kova-danger-foreground|kova-on-ink|kova-ink-border|background|foreground|card|card-foreground|muted|muted-foreground|primary|primary-foreground|secondary|secondary-foreground|accent|accent-foreground|destructive|destructive-foreground|success|success-foreground|warning|warning-foreground|warning-strong|border|input|ring|popover|popover-foreground|white|black|transparent";

export default {
  ...base,
  content: ["./src/**/*.{ts,tsx}", "./index.html", "../.design-sync/previews/**/*.tsx"],
  safelist: [
    { pattern: /^(flex|inline-flex|grid|block|inline-block|hidden)$/ },
    { pattern: /^(flex-row|flex-col|flex-wrap|flex-1|flex-none|shrink-0|grow)$/ },
    { pattern: /^items-(start|center|end|baseline|stretch)$/ },
    { pattern: /^justify-(start|center|end|between|around|evenly)$/ },
    { pattern: /^grid-cols-(1|2|3|4|5|6|12)$/ },
    { pattern: /^col-span-(1|2|3|4|6|12)$/ },
    { pattern: /^gap(-x|-y)?-(0|1|2|3|4|5|6|8|10|12)$/ },
    { pattern: /^space-(x|y)-(0|1|2|3|4|5|6|8)$/ },
    {
      pattern:
        /^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-(0|1|2|3|4|5|6|7|8|10|12|16)$/,
    },
    {
      pattern:
        /^(w|h)-(3|4|5|6|8|9|10|11|12|14|16|20|24|32|40|48|64|full|auto|fit)$/,
    },
    { pattern: /^(min-h|min-w|max-h)-(0|full|screen|fit)$/ },
    { pattern: /^max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|full|prose)$/ },
    { pattern: /^text-(left|center|right|xs|sm|base|lg|xl|2xl|3xl|4xl)$/ },
    { pattern: /^font-(normal|medium|semibold|bold)$/ },
    {
      pattern:
        /^(uppercase|capitalize|truncate|tabular-nums|leading-none|leading-tight|leading-relaxed|tracking-wide|tracking-tight|whitespace-nowrap|antialiased|italic|underline|line-through|overflow-hidden|overflow-auto|relative|absolute|fixed|sticky|inset-0|top-0|bottom-0|left-0|right-0|z-10|z-20|z-50|mx-auto|select-none|pointer-events-none|opacity-50|opacity-60|opacity-70|opacity-80|duration-150|duration-200|duration-300|animate-pulse|cursor-pointer|divide-y|sr-only)$/,
    },
    { pattern: new RegExp(`^(bg|text|border|ring|divide)-(${COLOR_NAMES})$`) },
    { pattern: new RegExp(`^bg-(${COLOR_NAMES})$`), variants: ["hover"] },
    {
      pattern:
        /^(bg-white|bg-kova-ink|bg-kova-mist|bg-kova-blue|bg-kova-growth|bg-kova-danger|bg-warning|bg-success|bg-destructive|bg-primary)\/(5|10|15|20|30|40|50|60|70|80|90)$/,
    },
    { pattern: /^rounded(-t|-b|-l|-r)?(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?$/ },
    { pattern: /^rounded-kova-(sm|md|lg|xl)$/ },
    { pattern: /^border(-t|-b|-l|-r)?(-0|-2|-4)?$/ },
    { pattern: /^shadow(-sm|-md|-lg|-xl|-2xl|-none)?$/ },
    { pattern: /^shadow-kova-(card|card-hover|hero)$/ },
    { pattern: /^bg-kova-grad-(blue|mint|sky)$/ },
    { pattern: /^animate-(fade-in|slide-in-right|scale-in|pulse-soft|slide-up)$/ },
    { pattern: /^animate-(fade-out|scale-out|slide-down)$/ },
    // Motion vocabulary. `transition-all` is deliberately absent — the DS bans
    // it (see conventions.md), so publishing it would advertise the
    // anti-pattern. Name the properties instead.
    { pattern: /^transition(-none|-colors|-opacity|-shadow|-transform)?$/ },
    {
      pattern:
        /^duration-(press|quick|hover|panel|modal|celebrate|panel-exit|modal-exit)$/,
    },
    { pattern: /^ease-(standard|entrance|exit|spring|linear|in|out|in-out)$/ },
  ],
};
