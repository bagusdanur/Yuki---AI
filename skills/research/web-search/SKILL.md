---
name: web-search
category: research
title: Web Search & Research
description: Cari informasi aktual, berita anime, fakta real-time, rilis komik, atau artikel terkini dari internet.
version: 1.0.0
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

# Web Search Skill

Gunakan skill ini ketika pengguna menanyakan hal-hal yang membutuhkan informasi terkini di luar basis pengetahuan statis, seperti:
- Berita anime/manga terbaru, jadwal tayang, rumor adaptasi, atau studio animasi.
- Fakta terkini, definisi istilah baru, berita teknologi, atau event pop-culture.
- Pencarian referensi umum dari internet.

## Panduan Penggunaan
- Buat kata kunci pencarian yang spesifik dan efektif (gunakan kata kunci inti).
- Rangkum hasil pencarian secara akurat dan padat dalam gaya khas Yuki.
- Cantumkan sumber/link jika relevan untuk mempermudah pengguna membaca lebih lanjut.
