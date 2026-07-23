import { Logo } from "pos-frontend";

export function Horizontal() {
  return (
    <div className="flex items-center gap-8 p-6 text-kova-ink">
      <Logo variant="horizontal" size={28} />
      <Logo variant="horizontal" size={40} />
    </div>
  );
}

export function OnDark() {
  return (
    <div className="flex items-center gap-8 rounded-kova-lg bg-kova-ink p-6 text-white">
      <Logo variant="horizontal" size={32} />
      <Logo variant="isotipo" size={32} />
    </div>
  );
}
