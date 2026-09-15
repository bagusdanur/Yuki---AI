---
name: html-canvas-builder
title: Interactive HTML/Canvas Artifact Builder & Workspace
version: 1.2.0
category: computing
description: Merakit, membaca, memodifikasi, dan memperluas kode HTML5, Canvas, CSS, dan JavaScript interaktif mandiri (game, widget, chart visual, simulasi) secara persisten di Live Artifact Workspace.
tools:
  - name: validate_interactive_artifact
  - name: build_interactive_artifact
    description: Merakit mini-aplikasi web mandiri baru (HTML/CSS/JS/Canvas) yang langsung dapat dijalankan oleh pengguna di Live Artifact Preview dan disimpan ke persistent workspace.
    parameters:
      type: object
      properties:
        title:
          type: string
          description: Judul dari artifact atau mini-aplikasi (misal 'Retro Platformer', 'Snake Game 2D').
        type:
          type: string
          enum: [html, javascript, svg]
          description: Tipe artifact, defaultnya 'html'.
        html_content:
          type: string
          description: Kode HTML lengkap mandiri, responsif, dan siap dirender.
      required:
        - title
        - html_content
  - name: get_active_artifact
    description: Mengambil dan membaca seluruh isi kode, versi, serta metadata dari artifact aktif yang sedang dibuka/dikerjakan oleh user saat ini di workspace.
    parameters:
      type: object
      properties: {}
  - name: read_artifact_file
    description: Membaca isi file artifact spesifik berdasarkan ID.
    parameters:
      type: object
      properties:
        id:
          type: string
          description: ID unik artifact (misal 'art_xxxx').
      required:
        - id
  - name: update_interactive_artifact
    description: Memodifikasi, memperbaiki bug, atau menambahkan level/fitur baru pada artifact yang sudah ada, menaikkan nomor versi (v1 -> v2), dan menyimpannya ke workspace.
    parameters:
      type: object
      properties:
        id:
          type: string
          description: ID artifact yang diperbarui (opsional jika memperbarui yang aktif).
        title:
          type: string
          description: Judul artifact.
        html_content:
          type: string
          description: Seluruh kode HTML/JS lengkap hasil modifikasi/penambahan fitur.
        patch_note:
          type: string
          description: Ringkasan perbaikan atau penambahan yang dilakukan (misal 'Menambahkan Level 4 dan Level 5').
      required:
        - html_content
  - name: patch_interactive_artifact
    description: Memperbaiki bagian kecil artifact aktif dengan old_text/new_text tanpa mengirim ulang seluruh HTML.
---

# Interactive HTML/Canvas Artifact Builder & Workspace Skill

Skill ini digunakan untuk merakit kode antarmuka web interaktif, mini-game, visualisasi data, dan mengelola persistent artifact workspace seperti Hermes Agent.

## Panduan Penggunaan & Iterasi:
1. **Membaca Sebelum Mengubah:** Saat user meminta penambahan level (misal Level 4-5) atau perbaikan bug, periksa kode artifact aktif terlebih dahulu (`get_active_artifact` atau konteks aktif yang diinjeksi).
2. **Iterasi & Pertahankan Kode:** Jangan membuat game baru dari nol saat user meminta penambahan level/fitur. Pertahankan mekanika kontrol, identitas visual yang sudah dipilih user, sound effect, dan kelas player, lalu tambahkan level baru ke dalam array/logika game.
3. **Penyimpanan:** Untuk bugfix gunakan `patch_interactive_artifact` agar hemat token. Gunakan `update_interactive_artifact` hanya jika struktur besar memang harus berubah, dan `build_interactive_artifact` hanya untuk game baru.

## Standar Desain Anti AI-Slop

1. Mulai dari sistem visual yang tenang: token semantik `--background`, `--foreground`, `--surface`, `--muted`, `--border`, `--primary`, `--danger`, dan skala radius/spacing yang konsisten.
2. Gunakan satu warna aksen utama. Warna lain hanya untuk makna seperti sukses, peringatan, dan error.
3. Utamakan hierarchy, grid, whitespace, tipografi system-ui, focus state, kontras, dan responsivitas—bukan dekorasi efek.
4. Hindari default neon cyan/ungu, glow, text-shadow, glassmorphism, gradient besar, blob dekoratif, kartu bersarang, semua sudut terlalu bulat, serta hero dengan copy generik.
5. Jangan memakai emoji sebagai ikon tombol. Gunakan SVG sederhana atau teks yang jelas.
6. Untuk game, pilih art direction yang spesifik (editorial, paper-cut, pixel, arcade CRT, hand-drawn, board-game, industrial) sesuai tema. Neon hanya boleh digunakan jika user meminta cyberpunk/neon secara eksplisit.
7. Live Artifact harus mandiri. Jangan menambahkan CDN/library eksternal hanya untuk meniru shadcn; terapkan pola komponen dan tokennya langsung dalam HTML/CSS.
