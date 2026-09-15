---
name: ryukomik-expert
category: media
title: Ryukomik Manga/Manhwa Expert
description: Mencari komik, manga, manhwa, dan manhua di Ryukomik secara mendalam, mengecek chapter terbaru, serta memberikan rekomendasi.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: search_ryukomik
    description: Mencari komik di database Ryukomik berdasarkan judul atau kata kunci.
    parameters:
      type: object
      properties:
        query:
          type: string
          description: Judul komik atau kata kunci (misal "Solo Leveling", "Magic Emperor", "Romance")
        filter_special:
          type: boolean
          description: Filter kategori khusus, bernilai true atau false (default false)
      required:
        - query
  - name: get_latest_comics
    description: Mengambil daftar komik dengan update chapter terbaru di Ryukomik.
    parameters:
      type: object
      properties:
        limit:
          type: integer
          description: Jumlah komik yang ingin diambil (default 6)
        genre:
          type: string
          description: Genre opsional untuk update terbaru, misalnya romance atau aksi
---

# Ryukomik Expert Skill

Gunakan skill ini ketika pengguna:
- Meminta rekomendasi komik, manga, manhwa, manhua.
- Menanyakan chapter terbaru dari suatu judul komik di Ryukomik.
- Menanyakan link baca komik terpercaya.

## Panduan Penggunaan
- Hubungkan dengan URL https://ryukomik.my.id.
- Untuk permintaan genre, jangan campurkan genre lain meskipun API sumber mengembalikannya.
- Jelaskan genre, format (MANHWA/MANGA/MANHUA), chapter terakhir, dan waktu update secara menarik.
