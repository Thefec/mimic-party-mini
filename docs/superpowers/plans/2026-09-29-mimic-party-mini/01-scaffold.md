# Task 1: Workspaces, tooling, room codes

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/wrangler.toml`
- Create: `backend/src/random.ts`, `backend/src/roomCode.ts`
- Test: `backend/test/random.test.ts`, `backend/test/roomCode.test.ts`
- Create: `frontend/package.json`, `frontend/build.mjs`, `frontend/src/index.html`, `frontend/src/main.js` (stub), `frontend/src/styles.css` (stub)

**Interfaces:**
- Produces: `cryptoRandom(): number` in [0,1); `randomHex(random: () => number, length: number): string`; `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH`, `generateRoomCode(random?: () => number): string`, `isRoomCode(value: string): boolean`.
- Produces: `npm run build` → `frontend/dist/index.html` and `frontend/dist/mimic-party-mini.html`; `npm test` runs vitest in both workspaces.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "mimic-party-mini",
  "private": true,
  "workspaces": ["backend", "frontend"],
  "scripts": {
    "build": "npm run build -w frontend",
    "dev": "npm run build && npm run dev -w backend",
    "test": "npm test -w backend && npm test -w frontend",
    "deploy": "npm run build && npm run deploy -w backend",
    "prototype": "npm run prototype -w frontend",
    "smoke": "node backend/scripts/smoke.mjs"
  }
}
```

`.gitignore`:
```
node_modules/
frontend/dist/
frontend/prototype/dist/
backend/.wrangler/
.dev.vars
```

- [ ] **Step 2: Backend package files**

`backend/package.json`:
```json
{
  "name": "backend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "types": "wrangler types",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": [],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "test", "worker-configuration.d.ts"]
}
```

`backend/wrangler.toml`:
```toml
name = "mimic-party-mini"
main = "src/index.ts"
compatibility_date = "2026-09-01"

[assets]
directory = "../frontend/dist"
binding = "ASSETS"
run_worker_first = ["/api/*"]

[[durable_objects.bindings]]
name = "GAME_ROOM"
class_name = "GameRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["GameRoom"]
```

- [ ] **Step 3: Frontend package files**

`frontend/package.json`:
```json
{
  "name": "frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "prototype": "node build.mjs prototype",
    "audiolab": "node build.mjs audio",
    "test": "vitest run --passWithNoTests"
  }
}
```

`frontend/build.mjs` (final version — inlines one JS bundle and the CSS into an HTML template):
```js
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const r = (...p) => path.join(root, ...p);

async function buildSingleFile({ entry, template, css, outFiles }) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2022",
    legalComments: "none",
    write: false,
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const styles = (await Promise.all(css.map((f) => readFile(f, "utf8")))).join("\n");
  const html = (await readFile(template, "utf8"))
    .replace("<!--STYLE-->", () => `<style>${styles}</style>`)
    .replace("<!--SCRIPT-->", () => `<script>${js}</script>`);
  for (const out of outFiles) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, html);
  }
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`built ${outFiles.map((f) => path.relative(root, f)).join(", ")} (${kb} KB)`);
}

const target = process.argv[2] ?? "app";
if (target === "prototype" || target === "audio") {
  // Dev-only pages: prototype/index.html (3D scene, Task 8) and prototype/audio.html (mic + scoring lab, Task 10).
  const name = target === "prototype" ? "index" : "audio";
  await buildSingleFile({
    entry: r("prototype", target === "prototype" ? "prototype.js" : "audio.js"),
    template: r("prototype", `${name}.html`),
    css: [r("src", "styles.css")],
    outFiles: [r("prototype", "dist", `${name}.html`)],
  });
} else {
  await buildSingleFile({
    entry: r("src", "main.js"),
    template: r("src", "index.html"),
    css: [r("src", "styles.css")],
    outFiles: [r("dist", "index.html"), r("dist", "mimic-party-mini.html")],
  });
}
```

`frontend/src/index.html` (final version):
```html
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mimic Party Mini</title>
<!--STYLE-->
</head>
<body>
<canvas id="stage"></canvas>
<div id="labels"></div>
<div id="ui"></div>
<div id="banner" hidden></div>
<div id="toast" hidden></div>
<!--SCRIPT-->
</body>
</html>
```

`frontend/src/main.js` (stub, replaced in Task 10):
```js
document.getElementById("ui").textContent = "Mimic Party Mini";
```

`frontend/src/styles.css` (stub, replaced in Task 10):
```css
html, body { margin: 0; background: #2b1f4a; color: #fff8ec; font-family: system-ui, sans-serif; }
```

- [ ] **Step 4: Install dependencies**

Run (from `C:\Users\Batu\Desktop\mimic`):
```
npm install -D wrangler typescript vitest -w backend
npm install three -w frontend
npm install -D esbuild vitest happy-dom -w frontend
```
Expected: installs complete without errors, and a single root `package-lock.json` plus `node_modules/` exist.

- [ ] **Step 5: Generate Worker types**

Run: `npm run types -w backend`
Expected: `backend/worker-configuration.d.ts` is created and declares `interface Env { GAME_ROOM: DurableObjectNamespace<...>; ASSETS: Fetcher }`. The `GameRoom` class does not exist yet, so the type may reference a missing import. That is fine; Task 6 re-runs this step.

- [ ] **Step 6: Write failing tests**

`backend/test/random.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cryptoRandom, randomHex } from "../src/random";

describe("random", () => {
  it("cryptoRandom returns numbers in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const v = cryptoRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("randomHex returns lowercase hex of the requested length", () => {
    const hex = randomHex(cryptoRandom, 32);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  it("randomHex is deterministic for a fixed source", () => {
    expect(randomHex(() => 0, 4)).toBe("0000");
    expect(randomHex(() => 0.99999, 4)).toBe("ffff");
  });
});
```

`backend/test/roomCode.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateRoomCode, isRoomCode, ROOM_CODE_ALPHABET } from "../src/roomCode";

describe("room codes", () => {
  it("generates 5 characters from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(5);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  it("never uses ambiguous characters", () => {
    for (const ch of "O0I1L") expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });

  it("is deterministic for a fixed random source", () => {
    expect(generateRoomCode(() => 0)).toBe("AAAAA");
    expect(generateRoomCode(() => 0.99999)).toBe("99999");
  });

  it("isRoomCode rejects lowercase, wrong length and ambiguous chars", () => {
    expect(isRoomCode("A7K2P")).toBe(true);
    expect(isRoomCode("a7k2p")).toBe(false);
    expect(isRoomCode("A7K2")).toBe(false);
    expect(isRoomCode("A7K2PX")).toBe(false);
    expect(isRoomCode("O0I1L")).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm test -w backend`
Expected: FAIL — cannot resolve `../src/random` / `../src/roomCode`.

- [ ] **Step 8: Implement**

`backend/src/random.ts`:
```ts
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
```

`backend/src/roomCode.ts`:
```ts
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_RE.test(value);
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: PASS (7 tests).

- [ ] **Step 10: Verify the frontend build**

Run: `npm run build`
Expected: prints `built dist\index.html, dist\mimic-party-mini.html (… KB)`. Open `frontend/dist/index.html` in a text editor and confirm it contains `<style>` and `<script>` inline and no `<!--STYLE-->` / `<!--SCRIPT-->` markers.

- [ ] **Step 11: Checkpoint**

`npm test -w backend` passes and `npm run build` succeeds. No commit (see Global Constraints).
