---
name: html-canvas-builder
title: Interactive HTML/Canvas Artifact Builder & Workspace
version: 1.1.0
category: computing
description: Merakit, membaca, memodifikasi, dan memperluas kode HTML5, Canvas, CSS, dan JavaScript interaktif mandiri (game, widget, chart visual, simulasi) secara persisten di Live Artifact Workspace.
tools:
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
---

# Interactive HTML/Canvas Artifact Builder & Workspace Skill

Skill ini digunakan untuk merakit kode antarmuka web interaktif, mini-game, visualisasi data, dan mengelola persistent artifact workspace seperti Hermes Agent.

## Panduan Penggunaan & Iterasi:
1. **Membaca Sebelum Mengubah:** Saat user meminta penambahan level (misal Level 4-5) atau perbaikan bug, periksa kode artifact aktif terlebih dahulu (`get_active_artifact` atau konteks aktif yang diinjeksi).
2. **Iterasi & Pertahankan Kode:** Jangan membuat game baru dari nol saat user meminta penambahan level/fitur. Pertahankan mekanika kontrol, visual neon, sound effect, dan kelas player yang sudah ada, lalu tambahkan level baru ke dalam array/logika game.
3. **Penyimpanan:** Gunakan `update_interactive_artifact` atau `build_interactive_artifact` untuk menyimpan perubahan ke Live Sandbox dan SQLite workspace.

