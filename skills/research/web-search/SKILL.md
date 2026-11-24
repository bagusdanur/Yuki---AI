---
name: web-search
category: research
title: Web Search & Research
description: Cari informasi aktual, berita anime, fakta real-time, rilis komik, atau artikel terkini dari internet.
version: 2.0.0
author: Yuki Agent Team
tools:
  - name: web_search
    description: Melakukan pencarian di internet untuk menemukan artikel, berita, atau data terkini.
    parameters:
      type: object
      properties:
        query:
          type: string
          description: Kata kunci atau pertanyaan pencarian (misal "jadwal rilis anime oshi no ko season 3" atau "harga tiket comifuro 2026")
        max_results:
          type: integer
          description: Jumlah hasil pencarian (default 4, maks 6)
      required:
        - query
---

# Web Search & Research (Claude Research Playbook)

Gunakan skill ini saat pertanyaan membutuhkan fakta terkini, rilis terbaru, dokumentasi resmi, harga/jadwal, atau verifikasi real-time.

## Alur Riset Akurat
1. **Query Spesifik:** Susun kata kunci padat tanpa kata pengisi; sertakan tahun atau nama versi bila relevan.
2. **Verifikasi Mendalam:** Jika snippet hasil pencarian belum cukup detail, lanjutkan dengan `read_url` pada sumber utama yang paling kredibel (dokumentasi resmi, media terpercaya).
3. **Sintesis Jujur & Terstruktur:**
   - Jawab langsung inti pertanyaan di paragraf pertama.
   - Pisahkan fakta terverifikasi dari rumor/belum dikonfirmasi.
   - Sertakan tautan sumber relevan dalam format markdown rapi.
   - Jika sumber tidak ditemukan atau saling bertentangan, katakan jujur — jangan pernah mengarang angka atau tanggal.
