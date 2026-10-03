# Mimic Party Mini

Arkadaşlarla tarayıcıda oynanan 3D bir taklit oyunu. Sırası gelen oyuncu bir ses çıkarır, diğerleri onu taklit eder; sunucu taklitlerin orijinale ne kadar benzediğini (ritim, melodi, tını) puanlar.

- 2–6 oyuncu, masaüstü Chrome / Edge / Firefox
- Hesap yok, veritabanı yok; oda kodu ya da link ile katılım
- Backend: Cloudflare Workers + Durable Objects (ücretsiz plan yeterli)
- Frontend: tek bir HTML dosyası (Three.js içine gömülü)

## Gereksinimler

- [Node.js](https://nodejs.org) 22 veya üstü
- Yayınlamak için ücretsiz bir [Cloudflare](https://dash.cloudflare.com/sign-up) hesabı

## Kurulum

```bash
npm install
```

## Yerelde çalıştırma

```bash
npm run dev
```

`http://localhost:8787` adresini birkaç sekmede aç — her sekme ayrı bir oyuncudur. Kapatmak için terminalde **Ctrl+C**.

## Cloudflare'e yayınlama (deploy)

1. **Cloudflare'e bir kez giriş yap** (tarayıcı açılır, izin verirsin):

   ```bash
   npx wrangler login
   ```

2. **Yayınla:**

   ```bash
   npm run deploy
   ```

   Bu komut önce oyunu derler (`frontend/dist`), sonra Worker'ı ve oda sunucusunu (Durable Object) yükler. Çıktının sonunda şuna benzer bir adres görürsün:

   ```
   https://mimic-party-mini.<senin-alt-alanın>.workers.dev
   ```

   İlk yayında Cloudflare senden bir `workers.dev` alt alan adı seçmeni isteyebilir; panelde **Workers & Pages** bölümünden bir kez seçmen yeterli.

3. **Oyna:** Bu adresi arkadaşlarına gönder. Odayı kuran kişi lobideki **"Linki kopyala"** ile doğrudan oda linkini de paylaşabilir.

4. **Güncelleme:** Kodda değişiklik yaptıktan sonra tekrar `npm run deploy` yeterli.

### (İsteğe bağlı) HTML dosyasını tek başına dağıtmak

Oyun, Worker'ın adresinden açıldığında sunucuyu kendisi bulur. `mimic-party-mini.html` dosyasını **dosyadan çift tıklayarak** açmak istersen:

1. `frontend/src/config.js` içindeki `PRODUCTION_SERVER` değerini yukarıdaki `workers.dev` adresiyle değiştir.
2. `npm run deploy` (veya sadece `npm run build`) çalıştır.
3. `frontend/dist/mimic-party-mini.html` artık tek başına çalışır.

### Ücretsiz plan hakkında

Ücretsiz Workers planı bu oyun için fazlasıyla yeterli (günde 100.000 istek, SQLite tabanlı Durable Objects). Odalar boş kaldıktan 10 dakika sonra kendiliğinden silinir; kalıcı veri tutulmaz.

## Testler

```bash
npm test          # backend + frontend birim testleri
npm run smoke     # uçtan uca kontrol (önce başka bir terminalde npm run dev)
```

Yayındaki sürümü kontrol etmek için:

```bash
SERVER=https://mimic-party-mini.<alt-alan>.workers.dev npm run smoke
```

## Geliştirici sayfaları

```bash
npm run prototype -w frontend   # 3D sahne prototipi  -> frontend/prototype/dist/index.html
npm run audiolab -w frontend    # mikrofon + puanlama laboratuvarı -> frontend/prototype/dist/audio.html
```

Ses laboratuvarı mikrofon istediği için `localhost` üzerinden açılmalı (ör. `npx http-server frontend/prototype/dist -p 5173`).

## Nasıl çalışır

- Her oda bir Cloudflare **Durable Object**'tir; oyunun tüm kuralları sunucudadır (`backend/src/game.ts`, `backend/src/games/mimic.ts`). İstemci asla puan göndermez.
- Tarayıcı sesi kaydeder, 16 kHz WAV'a çevirir ve ses özelliklerini çıkarır (şiddet, perde, tını; `frontend/src/audio/features.js`).
- Sunucu taklidi orijinalle **DTW** ile hizalayıp puanlar (`backend/src/scoring.ts`): ritim %40 + melodi %40 + tını %20. Ses yüksekliği ve ince/kalın ses farkı puanı etkilemez.
- Puanlama çok kolay/zor gelirse `backend/src/scoring.ts` içindeki `K` değerlerini büyüt/küçült.

Tasarım dokümanı: `docs/superpowers/specs/2026-09-29-mimic-party-mini-design.md`
