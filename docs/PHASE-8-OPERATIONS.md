# Phase 8 — Provider Router & Operations Dashboard

## Perilaku router

Urutan produksi saat ini:

1. `nebula` — 9Router Harbor DeepSeek.
2. `nebulaTerra` — 9Router Gemini Flash sebagai backup.

Setiap request maksimal melakukan dua attempt. Provider dengan circuit `open` dilewati. Setelah cooldown, status berubah menjadi `half_open`; satu request percobaan menentukan apakah circuit kembali `closed` atau terbuka lagi.

Default:

- Circuit terbuka setelah 3 kegagalan berurutan.
- Cooldown 60 detik.
- Budget agent run 120.000 token.
- Budget estimasi agent run USD 0,25.
- Subagent memakai budget lebih kecil: 30.000 token/USD 0,08 per worker.

## Environment

| Variable | Default | Fungsi |
|---|---:|---|
| `YUKI_PROVIDER_CIRCUIT_FAILURES` | `3` | Kegagalan berurutan sebelum circuit open |
| `YUKI_PROVIDER_COOLDOWN_MS` | `60000` | Waktu sebelum half-open |
| `YUKI_AGENT_TOKEN_BUDGET` | `120000` | Batas token satu parent run |
| `YUKI_AGENT_COST_BUDGET_USD` | `0.25` | Batas estimasi biaya satu parent run |
| `NEBULA_INPUT_COST_PER_MILLION` | `0` | Harga input untuk estimasi dashboard |
| `NEBULA_OUTPUT_COST_PER_MILLION` | `0` | Harga output |
| `GEMINI_INPUT_COST_PER_MILLION` | `0` | Harga input backup |
| `GEMINI_OUTPUT_COST_PER_MILLION` | `0` | Harga output backup |

Isi harga sesuai tarif provider agar estimasi biaya bermakna. Nilai nol tidak memblokir request tetapi dashboard menampilkan biaya nol.

## Dashboard /admin

Panel **LLM operations** menampilkan jumlah call/token sejak PM2 terakhir dimulai, estimasi biaya, circuit, success rate, latency, error terakhir, dan alert. Metrik reset saat PM2 restart. Dashboard tidak menampilkan prompt, pesan pengguna, API key, atau isi tool.

## Deployment

```bash
git pull
npm ci
npm test
npm run build
pm2 restart yuki-ai
pm2 save
pm2 logs yuki-ai --lines 100
```

Acceptance check:

1. `test-provider-router-v32.mjs` lulus.
2. Dashboard /admin menampilkan panel provider setelah login.
3. Request normal tercatat pada provider primary.
4. Rate limit membuka circuit setelah threshold dan hanya satu backup dicoba.
5. Budget exhaustion menghasilkan `LLM_BUDGET_EXHAUSTED`, bukan loop provider.
