---
name: html-canvas-builder
title: Interactive HTML/Canvas Artifact Builder & Workspace
version: 2.0.0
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

# Interactive HTML/Canvas Artifact Builder (Claude Frontend Design Playbook)

Gunakan skill ini untuk membangun dan mengiterasi aplikasi web interaktif, landing page, dashboard, widget, visualisasi data, maupun mini-game 2D mandiri di Live Artifact Workspace.

## Alur Kerja & Iterasi Persisten
1. **Baca Dulu Sebelum Modifikasi:** Untuk perbaikan bug atau penambahan fitur/level pada artifact yang sudah ada, selalu panggil `get_active_artifact` (jika belum ada di konteks) dan pertahankan seluruh struktur, kontrol, dan identitas visual yang sudah berjalan.
2. **Pilih Tool Tepat:**
   - Game/app baru -> `build_interactive_artifact`.
   - Bugfix kecil/sedang -> `patch_interactive_artifact` (hemat token, patch atomik `old_text` -> `new_text`).
   - Perubahan struktur besar -> `update_interactive_artifact` dengan HTML lengkap.
3. **Kode Mandiri & Tuntas 100%:** Satu file HTML utuh sampai `</html>`, tanpa CDN eksternal yang tidak perlu, tanpa placeholder `// ...`, dan selalu responsif di layar HP maupun desktop.

## Standar Desain Produk (Claude Anti AI-Slop)
1. **Sistem Visual Disengaja:** Definisikan CSS custom properties semantik (`--bg`, `--surface`, `--fg`, `--muted`, `--border`, `--accent`, `--danger`) dengan skala spacing & tipografi yang konsisten.
2. **Satu Aksen Dominan:** Gunakan 1 warna aksen utama yang kuat; warna semantik lain hanya untuk status (sukses, peringatan, error).
3. **Hirarki & Interaksi Nyata:** Fokus pada kontras terbaca, grid bersih, whitespace lega, hover/focus/active state yang responsif, dan ikon SVG minimalis (bukan emoji sebagai ikon tombol).
4. **Larangan AI-Slop:** Hindari neon cyan/ungu default, glow berlebihan, glassmorphism murahan, gradient raksasa, blob dekoratif, atau kartu bersarang kecuali diminta eksplisit oleh tema user.
5. **Standar Mini-Game & Canvas:**
   - Gunakan `requestAnimationFrame` dengan delta-time yang stabil (clamp `dt` agar tidak melompat saat tab berpindah).
   - Wajib dukung **Keyboard (WASD/Arrow/Space)** DAN **kontrol sentuh on-screen** untuk HP.
   - Wajib memiliki state lengkap: start/HUD skor/pause/game-over/restart bersih tanpa memory leak listener.
   - Untuk board/grid game (catur, tic-tac-toe, puzzle): wajib kunci ukuran kotak dengan `grid-template-columns: repeat(N, minmax(0, 1fr))` & `grid-template-rows: repeat(N, minmax(0, 1fr))` + `line-height: 1; overflow: hidden` agar kotak tidak pernah memanjang/mengecil saat bidak berpindah, serta warnai bidak berdasarkan tim/pemain (bukan warna kotak papan).
