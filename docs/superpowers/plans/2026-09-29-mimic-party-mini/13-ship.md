# Task 13: Reliability pass, README, deploy, git (with user approval)

**Files:**
- Create: `README.md`
- Modify: `frontend/src/config.js` (`PRODUCTION_SERVER`, after the first deploy)

**Interfaces:**
- Consumes: everything built so far.
- Produces: a deployed `https://mimic-party-mini.<subdomain>.workers.dev`, a downloadable `frontend/dist/mimic-party-mini.html` that works from disk, and (only if the user agrees) a git repository with one initial commit.

- [ ] **Step 1: Reliability checks against `npm run dev`**

Run each check and fix anything that fails. The unit tests already cover the server rules, so these checks target the client/server seams:
1. **Server restart mid-game:** stop `wrangler dev` during MIMIC. Every tab shows the yellow "Bağlantı koptu…" banner. Restart it: `wrangler dev` keeps Durable Object storage in `backend/.wrangler`, so the tabs rejoin and the game continues or ends cleanly. No tab is stuck on a blank screen.
2. **Replaced tab:** copy tab B's URL into a new tab and join with the same session (duplicate the tab; `sessionStorage` is copied on duplicate). The old tab shows "Oyun başka bir sekmede açıldı." and returns to the menu. The new tab plays on.
3. **Full room:** with 6 players in the lobby, a 7th gets "Oda dolu".
4. **Join after start:** a new tab joining a running game gets "Oyun çoktan başladı."
5. **Mic denied:** block the mic in site settings, then press record. You get the "Mikrofon izni verilmedi" toast, and the game keeps working for listening.
6. **Long session:** play 2 full games in a row with "Tekrar oyna". There must be no growing lag. Check Chrome's Task Manager: tab memory must not keep climbing, and WebGL contexts must not leak when the avatar editor is toggled many times.

- [ ] **Step 2: README**

`README.md`:
````markdown
# Mimic Party Mini

Arkadaşlarla tarayıcıda oynanan bir taklit oyunu. Biri ses çıkarır, diğerleri taklit eder; sunucu benzerliği puanlar.

## Gereksinimler
- Node.js 22+
- Masaüstü Chrome, Edge veya Firefox
- Yayınlamak için ücretsiz bir Cloudflare hesabı

## Kurulum
```
npm install
```

## Yerelde çalıştırma
```
npm run dev
```
`http://localhost:8787` adresini birkaç sekmede aç (her sekme ayrı bir oyuncudur).

## Testler
```
npm test            # backend + frontend birim testleri
npm run smoke       # npm run dev açıkken uçtan uca kontrol
```

## Geliştirici sayfaları
```
npm run prototype -w frontend   # 3D sahne prototipi -> frontend/prototype/dist/index.html
npm run audiolab -w frontend    # mikrofon + puanlama laboratuvarı -> frontend/prototype/dist/audio.html
```

## Yayınlama (Cloudflare Workers Free)
```
npx wrangler login      # bir kez
npm run deploy
```
Çıktıdaki `https://mimic-party-mini.<alt-alan>.workers.dev` adresini arkadaşlarına gönder.

HTML dosyasını tek başına (dosyadan açarak) da kullanmak istersen:
1. `frontend/src/config.js` içindeki `PRODUCTION_SERVER` değerini bu adresle değiştir.
2. `npm run build` → `frontend/dist/mimic-party-mini.html` dosyası tek başına çalışır.

## Nasıl çalışır
- Her oda bir Cloudflare Durable Object'tir; oyunun tüm kuralları sunucudadır (`backend/src/game.ts`, `backend/src/games/mimic.ts`).
- Tarayıcı sesi kaydeder, 16 kHz WAV'a çevirir ve ses özelliklerini (şiddet, perde, tını) çıkarır; puanı sunucu DTW ile hesaplar (`backend/src/scoring.ts`).
- Tasarım: `docs/superpowers/specs/2026-09-29-mimic-party-mini-design.md`
````

- [ ] **Step 3: Deploy (needs the user)**

Tell the user (in Turkish) that deploying needs a one-time Cloudflare login in their browser. Ask them to run `! npx wrangler login` in this session. When they confirm, run:
```
npm run deploy
```
Expected: wrangler prints the Worker URL `https://mimic-party-mini.<subdomain>.workers.dev` and the Durable Object migration `v1`.

Then:
1. Set `PRODUCTION_SERVER` in `frontend/src/config.js` to that URL (keep the comment), then run `npm run deploy` again so the downloadable HTML carries it too.
2. Run `SERVER=https://mimic-party-mini.<subdomain>.workers.dev npm run smoke`. In PowerShell: `$env:SERVER="https://…"; npm run smoke`. Expected: `SMOKE PASSED`.
3. Open the URL in two different browsers or computers and play one round. Also open `frontend/dist/mimic-party-mini.html` from disk and join the same room; it must connect to production.

- [ ] **Step 4: Git (ask first — never automatic)**

Ask the user whether they want to put the project under git now. Only if they say yes:
```
git init
git add -A
git status
```
Show the user the `git status` output and confirm that no `node_modules/`, `dist/` or `.wrangler/` files are staged. Then ask for (or propose) a commit message. Create the commit **without any `Co-Authored-By` or Claude attribution line**:
```
git commit -m "<message the user approved>"
```
If they say no, skip this step entirely.

- [ ] **Step 5: Final checkpoint**

- `npm test` passes.
- The smoke test passes against production.
- A real game with friends' computers works end to end.

Report to the user (in Turkish) with:
- the game URL
- how to share it (the link or the room code)
- the two dev pages (`npm run prototype -w frontend` for the 3D scene, `npm run audiolab -w frontend` for the mic/scoring lab)
- a reminder that `K` in `backend/src/scoring.ts` tunes scoring strictness if it feels too easy or too hard
