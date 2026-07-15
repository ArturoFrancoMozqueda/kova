// Color determinístico para el avatar de iniciales del sidebar — mismo email,
// mismo color, sin depender de una foto. Paleta curada (no HSL arbitrario)
// para garantizar contraste con texto blanco.
const AVATAR_PALETTE = [
  "#4F7EF7", // kova-blue
  "#1EBF8A", // kova-growth
  "#F59E0B", // amber
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#0EA5E9", // sky
] as const;

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}
