// Standalone, isolated export route for the Kova marketing showcase.
//
// This page exists ONLY to be screen-recorded into a social video — it is not
// part of normal browsing. It locks the page to an exact social canvas size and
// renders <KovaShowcase variant="standalone"> (which always animates).
//
// Usage:
//   /kova-showcase-video                    → portrait  1080×1350 (default)
//   /kova-showcase-video?format=portrait    → portrait  1080×1350
//   /kova-showcase-video?format=landscape   → landscape 1600×1200
//
// See KovaShowcase.tsx for full recording/export instructions. The animation is
// a deterministic 30s CSS loop, so any 30s capture is frame-identical.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { LandingStyleTag, themeVars } from "@/landing/landingTheme";
import KovaShowcase from "@/landing/showcase/KovaShowcase";

const CANVAS = {
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1600, height: 1200 },
} as const;

type Format = keyof typeof CANVAS;

export default function KovaShowcaseVideo() {
  const [params] = useSearchParams();
  const format: Format = params.get("format") === "landscape" ? "landscape" : "portrait";
  const { width, height } = CANVAS[format];

  // Keep this export page out of search indexes — it is a recording surface.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Kova — showcase (video export)";
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  return (
    // Full-viewport dark mat; the fixed-size canvas is centered for capture.
    <div
      className="lp-root"
      style={{
        ...themeVars("dark"),
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0B0D13",
        padding: 0,
      }}
    >
      <LandingStyleTag />
      <div
        // The exact social canvas. Record this box at 100% zoom.
        style={{ width, height, maxWidth: "100vw", maxHeight: "100vh", overflow: "hidden" }}
      >
        <KovaShowcase variant="standalone" format={format} />
      </div>
    </div>
  );
}
