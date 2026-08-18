---
name: browser-agent
category: research
title: Yuki Browser — Web Automation & Scraping
description: Membuka halaman web nyata dengan browser headless, membaca konten halaman yang membutuhkan JavaScript, mengambil screenshot, dan mengekstrak data dari elemen spesifik.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: browse_page
    description: Membuka URL dengan browser nyata, menunggu JavaScript selesai render, lalu mengekstrak teks konten dan link dari halaman tersebut.
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL lengkap halaman yang ingin dibuka (https://...)
        wait_for:
          type: string
          description: Kondisi tunggu rendering ("networkidle2" untuk halaman kompleks, "domcontentloaded" untuk cepat)
      required:
        - url
  - name: screenshot_url
    description: Mengambil screenshot halaman web dan mengembalikannya sebagai gambar untuk ditampilkan ke pengguna.
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL halaman yang ingin di-screenshot
        full_page:
          type: boolean
          description: Screenshot seluruh halaman atau hanya viewport (default false)
      required:
        - url
  - name: browser_extract
    description: Mengekstrak data spesifik dari elemen HTML menggunakan CSS selector.
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL halaman
        selector:
          type: string
          description: CSS selector elemen yang ingin diekstrak (misal "h1", ".price", "#main p")
        attribute:
          type: string
          description: Atribut yang diambil ("text", "href", "src", default "text")
      required:
        - url
        - selector
---

# Browser Agent Skill

Gunakan skill ini ketika:
- URL yang ingin dibaca membutuhkan JavaScript untuk render kontennya
- Perlu membaca konten halaman SPA (React/Vue/Next.js apps)
- Perlu screenshot halaman untuk ditampilkan ke user
- Perlu ekstrak data dari halaman dengan struktur HTML spesifik
- Tool `read_url` biasa tidak berhasil membaca konten yang diharapkan

## Catatan
- Tool ini lebih lambat dari `read_url` biasa (~5-15 detik)
- Tidak bisa mengakses localhost atau jaringan internal
- Screenshot dikembalikan sebagai base64 image
