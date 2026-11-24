---
name: url-reader
category: research
title: Web Page & Article Reader
description: Membaca dan mengekstrak teks ringkas dari tautan web atau artikel online.
version: 2.0.0
author: Yuki Agent Team
tools:
  - name: read_url
    description: Mengambil konten teks, HTTP response headers publik, dan sinyal tech stack (framework, CDN, fonts, scripts, API) dari URL halaman web.
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL lengkap halaman yang ingin dibaca (misal https://example.com)
      required:
        - url
---

# Web Page Reader & Tech-Stack Inspector (Claude Research Playbook)

Gunakan skill ini saat pengguna memberikan URL untuk dirangkum, diperiksa isinya, atau dianalisis teknologi / tech stack-nya.

## Panduan Analisis Web & Tech Stack
1. **Satu Panggilan Utama Dulu:** Panggil `read_url` pada URL utama. Output sudah menyertakan `headers`, `techStack` (dengan bukti konkret), `scripts`, `stylesheets`, dan `content`.
2. **Jangan Menebak-nebak Path Acak:** Jangan membuang panggilan ke `/wp-json`, `/wp-login.php`, atau `/_next/static` jika `techStack` dan `headers` sudah jelas menunjukkan framework aktual (misal SvelteKit, Astro, Nuxt, dsb.).
3. **Laporkan Berbasis Bukti:** Kelompokkan temuan secara rapi (*Framework Frontend, CDN/Server, Styling/Fonts, Analytics/Script, Struktur/API*) dan sebutkan bukti nyatanya (nama header/asset). Jika sesuatu tidak terlihat dari luar (misal database backend), nyatakan jujur bahwa tidak dapat dipastikan dari sisi klien.
