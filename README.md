# Yuki Agent v3.2 — Autonomous Companion

Yuki adalah companion dan agent berbasis Node.js + React/Vite dengan durable runs, planner, sandbox workspace per pengguna, scheduler + Web Push, structured memory, dynamic skills, bounded subagents, serta provider router yang dapat dipantau.

## Status v3.2

| Phase | Fitur | Status |
|---|---|---|
| 0–3 | Safety harness, durable run, planner, sandbox | Selesai |
| 4 | Scheduler dan notification center | Selesai |
| 5 | Artifact browser QA | Ditunda untuk menjaga resource VPS |
| 6 | Structured memory dan dynamic skills | Selesai |
| 7 | Isolated bounded subagents | Selesai |
| 8 | Provider router dan operations dashboard | Selesai |

## Menjalankan

```bash
npm ci
npm test
npm run build
npm start
```

Production berjalan melalui PM2 dan reverse proxy. Dashboard operasional tersedia di `/admin` dan wajib memakai sesi admin.

## Keamanan utama

- Yuki tidak mendapat shell VPS atau akses ke project lain.
- Workspace dipisahkan per pengguna dan menolak traversal/symlink escape.
- Subagent hanya memakai tool read-only, maksimal dua worker aktif.
- Provider hanya dicoba maksimal dua kali per request: primary lalu satu backup.
- Budget token/biaya menghentikan run dengan error eksplisit.

Konfigurasi dan prosedur Phase 8 ada di [docs/PHASE-8-OPERATIONS.md](docs/PHASE-8-OPERATIONS.md).

## Mengganti LLM

Login ke `/admin`, lalu buka **LLM providers**. Primary dan backup menerima endpoint OpenAI-compatible, model, API key, serta harga token opsional. Gunakan tombol test sebelum menyimpan. Perubahan aktif untuk request berikutnya tanpa restart PM2.

API key disimpan pada `.runtime-secrets/llm-providers.json` dengan permission `600` dan tidak pernah dikirim kembali ke dashboard.
