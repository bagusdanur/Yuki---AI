---
name: code-analyzer
category: computing
title: Code Analyzer & Debugger
description: Menganalisis sintaks kode, mendeteksi bug, memeriksa format JSON/SQL/JS/Python, dan memberikan rekomendasi optimasi logika.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: analyze_code_syntax
    description: Memeriksa sintaks kode, validitas struktur, dan memberikan feedback analisis teknis.
    parameters:
      type: object
      properties:
        code:
          type: string
          description: Potongan kode atau teks yang ingin dianalisis
        language:
          type: string
          description: Bahasa pemrograman (misal "javascript", "json", "python", "html", "css", "sql")
      required:
        - code
---

# Code Analyzer Skill

Gunakan skill ini ketika pengguna:
- Mengirimkan kode yang error atau bertanya mengapa kodenya tidak berjalan.
- Meminta code review, refactoring, atau pengecekan bug.
- Meminta validasi format JSON, SQL query, regex, atau logika algoritma.

## Panduan Penggunaan
1. Periksa kode secara cermat.
2. Jelaskan letak kesalahan, baris yang bermasalah, dan berikan solusi kode perbaikan yang bersih dan optimal.
