const listeners = new Set();

export const state = {
  connection: "idle",
  self: null,
  room: null,
  phaseData: null,
  roundResult: null,
  standings: null,
  clockOffset: 0,
  local: { error: null, errorAt: 0 },
};

export function update(mutator) {
  mutator(state);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const serverNow = () => Date.now() + state.clockOffset;
export const selfPlayer = () => state.room?.players.find((p) => p.id === state.self?.id) ?? null;
export const isHost = () => !!state.self && state.room?.hostId === state.self.id;

export function resetRoom() {
  update((s) => {
    s.self = null;
    s.room = null;
    s.phaseData = null;
    s.roundResult = null;
    s.standings = null;
  });
}

export function showError(code) {
  update((s) => {
    s.local.error = code;
    s.local.errorAt = Date.now();
  });
}
