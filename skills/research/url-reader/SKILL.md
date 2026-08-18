---
name: url-reader
category: research
title: Web Page & Article Reader
description: Membaca dan mengekstrak teks ringkas dari tautan web atau artikel online.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: read_url
    description: Mengambil dan merangkum konten teks dari URL halaman web atau artikel.
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL lengkap halaman yang ingin dibaca (misal https://example.com/berita-anime)
      required:
        - url
---

# URL Reader Skill

Gunakan skill ini ketika pengguna memberikan URL tautan langsung atau ketika kamu menemukan link menarik dari hasil pencarian web dan perlu membaca isi lengkapnya.

## Panduan Penggunaan
- Pastikan URL valid dan menggunakan protokol http/https.
- Ekstrak poin-poin terpenting dari artikel.
