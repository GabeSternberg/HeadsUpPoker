interface AvatarNamingContext {
  avatarMode: boolean;
  avatarAssignment: (string | null)[];
  players: ({ name: string } | null)[];
}

export function getDisplayName(room: AvatarNamingContext, index: number): string {
  if (room.avatarMode) {
    const role = room.avatarAssignment[index];
    if (role === 'G') return 'Gabe';
    if (role === 'L') return 'Liana';
    return 'Choose avatar';
  }
  const player = room.players[index];
  if (player) return player.name;
  return `Player ${index + 1}`;
}

export function mapNamesInText(room: AvatarNamingContext, text: string): string {
  if (!room.avatarMode) return text;
  let result = text;
  for (let i = 0; i < room.players.length; i++) {
    const player = room.players[i];
    if (!player) continue;
    const display = getDisplayName(room, i);
    if (display !== player.name) {
      result = result.split(player.name).join(display);
    }
  }
  return result;
}

export function syncAvatarPlayerNames(room: AvatarNamingContext): void {
  if (!room.avatarMode) return;
  for (let i = 0; i < room.players.length; i++) {
    const player = room.players[i];
    if (!player) continue;
    player.name = getDisplayName(room, i);
  }
}
