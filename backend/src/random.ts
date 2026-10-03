/** Uniform random number in [0, 1) from the platform CSPRNG. */
export function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

export function randomHex(random: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(random() * 16).toString(16);
  return out;
}
