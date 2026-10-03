export const playerById = (s, id) => s.room?.players.find((p) => p.id === id) ?? null;
export const nameOf = (s, id) => playerById(s, id)?.name ?? "?";

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
