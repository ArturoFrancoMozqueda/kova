import { LogoMark } from "pos-frontend";

export function Sizes() {
  return (
    <div className="flex items-end gap-6 p-6 text-kova-ink">
      <LogoMark size={24} title="kova" />
      <LogoMark size={32} title="kova" />
      <LogoMark size={48} title="kova" />
      <LogoMark size={64} title="kova" />
    </div>
  );
}

export function Tinted() {
  return (
    <div className="flex items-center gap-6 p-6">
      <span className="text-kova-ink">
        <LogoMark size={40} title="kova" />
      </span>
      <span className="text-kova-blue">
        <LogoMark size={40} title="kova" />
      </span>
      <span className="rounded-kova-md bg-kova-ink p-3 text-white">
        <LogoMark size={40} title="kova" />
      </span>
    </div>
  );
}
