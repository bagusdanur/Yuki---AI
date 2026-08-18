---
name: code-scratchpad
category: computing
title: Code Scratchpad & Runner
description: Menjalankan kode JavaScript kecil di sandbox terisolasi untuk manipulasi data, regex, algoritma, atau simulasi.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: run_javascript_code
    description: Menjalankan snippet JavaScript kecil dan mengembalikan output / return value-nya.
    parameters:
      type: object
      properties:
        code:
          type: string
          description: Kode JavaScript yang akan dieksekusi (gunakan return value atau console.log)
      required:
        - code
---

# Code Scratchpad Skill

Gunakan skill ini ketika pengguna:
- Meminta pengujian regex, algoritma, atau kode JS sederhana.
- Meminta pemrosesan data teks/JSON yang kompleks.
- Meminta simulasi logika matematika atau string.

## Panduan Penggunaan
- Jalankan kode di sandbox yang aman dan berikan penjelasan singkat hasil eksekusinya.
