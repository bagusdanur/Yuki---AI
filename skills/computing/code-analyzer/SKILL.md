---
name: code-analyzer
category: computing
title: Code Analyzer & Debugger
description: Menganalisis sintaks kode, mendeteksi bug, memeriksa format JSON/SQL/JS/Python, dan memberikan rekomendasi optimasi logika.
version: 2.0.0
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

# Code Analyzer & Systematic Debugger (Claude-Grade Playbook)

Gunakan skill ini saat pengguna mengirim potongan kode untuk di-debug, di-review, di-refactor, atau divalidasi (JS/TS, Python, HTML, CSS, SQL, JSON).

## Alur Analisis & Debugging
1. **Validasi Sintaks Aktual:** Panggil `analyze_code_syntax` pada kode yang dikirim user untuk menangkap error sintaks, kurung tidak seimbang, atau pola rawan bug secara objektif.
2. **Audit Menyeluruh:** Periksa 4 aspek utama:
   - *Correctness & Edge Cases:* null/undefined, off-by-one, async/await tanpa `try/catch`, race condition, tipe data.
   - *Security:* XSS (`innerHTML`), SQL injection, kebocoran secret, validasi input.
   - *Performance:* loop bersarang tak perlu, re-render berlebih, query N+1.
   - *Maintainability:* penamaan jelas, pemisahan tanggung jawab.
3. **Format Output Wajib:**
   - **Akar Masalah:** Sebutkan baris/simbol spesifik dan kenapa error terjadi.
   - **Perbaikan Lengkap:** Berikan kode hasil perbaikan yang **utuh, langsung bisa dijalankan, tanpa placeholder `// ...`** sambil mempertahankan nama fungsi/struktur asli user.
   - **Ringkasan Perubahan:** 2–4 poin singkat apa yang diubah dan kenapa.
