// Color determinístico para avatares de iniciales (barra lateral, clientes,
// equipo) — mismo nombre, mismo color, sin depender de una foto. Cada tono
// supera 5:1 con texto blanco, incluso a 11 px (WCAG AA).
const AVATAR_PALETTE = [
  "#2F5BD3", // azul Kova (5.9:1)
  "#0F7A57", // verde (5.3:1)
  "#B45309", // ámbar (5.0:1)
  "#6D28D9", // violeta (7.1:1)
  "#BE185D", // rosa (6.0:1)
  "#0369A1", // cielo (5.9:1)
] as const;

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}
