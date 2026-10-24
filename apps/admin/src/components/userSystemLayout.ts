export const USER_CARD = { width: 248, height: 208, columnGap: 48, rowGap: 32 } as const;

/** Keep the account path level; pack identity access below the person. */
export function userSystemLayout(roleIds: string[], deviceIds: string[]) {
  const column = USER_CARD.width + USER_CARD.columnGap;
  const row = USER_CARD.height + USER_CARD.rowGap;
  const positions: Record<string, { x: number; y: number }> = {
    organization: { x: 0, y: 0 },
    person: { x: column, y: 0 },
    identity: { x: column, y: row * (1 + Math.max(0, roleIds.length - 1) / 2) },
    account: { x: column * 2, y: 0 },
  };
  roleIds.forEach((id, i) => { positions[id] = { x: column * 2, y: (i + 1) * row }; });
  deviceIds.forEach((id, i) => { positions[id] = { x: column * 3, y: i * row }; });
  return positions;
}
