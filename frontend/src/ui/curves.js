// Same normalization as the server (backend/src/scoring.ts) so what you see is what is scored.
function energyCurve(f) {
  const max = Math.max(...f.energy);
  return f.energy.map((v) => (Math.min(0, Math.max(-40, v - max)) + 40) / 40);
}

function pitchCurve(f) {
  const voiced = f.pitch.filter((p) => p > 0).sort((a, b) => a - b);
  if (!voiced.length) return f.pitch.map(() => null);
  const ref = voiced[voiced.length >> 1];
  return f.pitch.map((p) => (p > 0 ? Math.max(-12, Math.min(12, 12 * Math.log2(p / ref))) : null));
}

/** Top half: loudness (rhythm). Bottom half: melody in semitones (±12). */
export function drawCurves(canvas, original, imitation, color) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = (canvas.width = Math.round(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.round(canvas.clientHeight * dpr));
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (!original) return;
  const frames = Math.max(original.energy.length, imitation?.energy.length ?? 0, 2);
  const x = (i) => (i / (frames - 1)) * w;
  const half = h / 2;

  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = dpr;
  g.beginPath();
  g.moveTo(0, half);
  g.lineTo(w, half);
  g.stroke();

  const line = (values, top, toY, style, width) => {
    g.strokeStyle = style;
    g.lineWidth = width * dpr;
    g.lineJoin = "round";
    g.beginPath();
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      const y = top + toY(v);
      if (pen) g.lineTo(x(i), y);
      else g.moveTo(x(i), y);
      pen = true;
    });
    g.stroke();
  };
  const energyY = (v) => (1 - v) * (half - 8 * dpr) + 4 * dpr;
  const pitchY = (v) => ((12 - v) / 24) * (half - 8 * dpr) + 4 * dpr;

  line(energyCurve(original), 0, energyY, "rgba(255,255,255,0.9)", 4);
  line(pitchCurve(original), half, pitchY, "rgba(255,255,255,0.9)", 4);
  if (imitation) {
    line(energyCurve(imitation), 0, energyY, color, 3);
    line(pitchCurve(imitation), half, pitchY, color, 3);
  }
}
