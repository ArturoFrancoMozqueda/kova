// Design-sync bundle entry — exports the Kova product UI kit for the
// claude.ai/design import (see .design-sync/config.json). Not part of the
// app build; keep in sync with src/components when adding reusable pieces.
export * from "./src/components/ui/arc-kicker";
export * from "./src/components/ui/badge";
export * from "./src/components/ui/button";
export * from "./src/components/ui/card";
export * from "./src/components/ui/confirm-dialog";
export * from "./src/components/ui/dialog";
export * from "./src/components/ui/input";
export * from "./src/components/ui/label";
export * from "./src/components/ui/route-fallback";
export * from "./src/components/ui/select";
export * from "./src/components/ui/skeleton";
export * from "./src/components/ui/stat-tile";
export * from "./src/components/ui/ticket";
export * from "./src/components/ui/toast";
export * from "./src/components/ui/view-header";
export * from "./src/components/ui/view-layout";
export * from "./src/components/ui/view-states";
export { default as Logo, LogoMark } from "./src/components/brand/Logo";
export * from "./src/components/brand/RealTime";
export { cn } from "./src/lib/utils";
// Router context for previews/designs that render router-aware components
// (ViewPermissionDenied renders a react-router <Link>).
export { MemoryRouter } from "react-router-dom";
