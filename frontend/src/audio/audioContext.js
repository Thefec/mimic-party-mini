let ctx = null;

export function getAudioContext() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Browsers start audio suspended; call this from a click/keydown handler. */
export async function unlockAudio() {
  const c = getAudioContext();
  if (c.state === "suspended") await c.resume();
}
