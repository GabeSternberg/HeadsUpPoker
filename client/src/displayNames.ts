import { GameState } from './types';

export function getDisplayName(
  gameState: GameState,
  index: number,
  fallback?: string
): string {
  if (gameState.avatarMode) {
    const role = gameState.avatarAssignment[index];
    if (role === 'G') return 'Gabe';
    if (role === 'L') return 'Liana';
    return 'Choose avatar';
  }
  const player = gameState.players[index];
  if (player) return player.name;
  return fallback ?? `Player ${index + 1}`;
}

export function buildNameMap(gameState: GameState): Record<string, string> {
  if (!gameState.avatarMode) return {};
  const map: Record<string, string> = {};
  gameState.players.forEach((p, i) => {
    if (!p) return;
    const display = getDisplayName(gameState, i);
    if (display !== p.name) map[p.name] = display;
  });
  return map;
}

export function resolveEntry(entry: string, nameMap: Record<string, string>): string {
  let s = entry;
  for (const [raw, display] of Object.entries(nameMap)) {
    s = s.split(raw).join(display);
  }
  return s;
}
