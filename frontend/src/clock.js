/** Estimate serverTime - clientTime from ping/pong samples, trusting the lowest round trip. */
export function estimateOffset(samples) {
  if (!samples.length) return 0;
  let best = samples[0];
  for (const s of samples) if (s.receivedAt - s.t < best.receivedAt - best.t) best = s;
  const rtt = best.receivedAt - best.t;
  return best.serverTime - (best.t + rtt / 2);
}
