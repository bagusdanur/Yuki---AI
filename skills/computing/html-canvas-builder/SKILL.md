---
name: html-canvas-builder
title: Interactive HTML/Canvas Artifact Builder
version: 1.0.0
category: computing
description: Merakit dan memvalidasi kode HTML5, Canvas, CSS, dan JavaScript interaktif mandiri (game, widget, chart visual, simulasi) untuk dirender di Live Artifact Viewer.
tools:
  - name: build_interactive_artifact
    description: Merakit mini-aplikasi web mandiri (HTML/CSS/JS/Canvas) yang langsung dapat dijalankan dan diinteraksikan oleh pengguna di jendela Live Artifact Preview.
    parameters:
      type: object
      properties:
        title:
          type: string
          description: Judul dari artifact atau mini-aplikasi (misal 'Kalkulator Sains', 'Snake Game 2D', 'Grafik Statistik').
        type:
          type: string
          enum: [html, javascript, svg]
          description: Tipe artifact, defaultnya 'html' untuk halaman lengkap mandiri.
        html_content:
          type: string
          description: Kode HTML lengkap (termasuk tag <style> dan <script> jika diperlukan) yang mandiri, responsif, dan siap dirender dalam iframe.
      required:
        - title
        - html_content
---

# Interactive HTML/Canvas Artifact Builder Skill

Skill ini digunakan untuk merakit kode antarmuka web interaktif, mini-game, visualisasi data grafik, atau alat kalkulator visual mandiri.

## Panduan Penggunaan:
1. Kode HTML harus **self-contained** (mencakup styling di dalam `<style>` dan logika interaksi di dalam `<script>`).
2. Gunakan CSS modern bernuansa dark mode, responsive layout, font sistem bersih, dan animasi halus.
3. Hindari dependency eksternal yang tidak perlu. Utamakan Vanilla JS dan HTML5 Canvas standar.
4. Gunakan tool ini setiap kali pengguna meminta pembuatan game, simulasi, widget interaktif, visualisasi diagram, atau komponen UI web.
