---
name: safe-calculator
category: computing
title: Safe Mathematical Calculator
description: Melakukan kalkulasi matematika presisi, persentase, trigonometri, dan perhitungan angka tanpa risiko kesalahan aritmatika.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: calculate_expression
    description: Menghitung hasil dari ekspresi matematika (misal "15% dari 450000", "(125 * 4) / 10", "Math.sqrt(144) + 10").
    parameters:
      type: object
      properties:
        expression:
          type: string
          description: Rumus atau ekspresi matematika
      required:
        - expression
---

# Safe Calculator Skill

Gunakan skill ini ketika pengguna meminta perhitungan matematika, anggaran/budget, diskon belanja, atau angka statistik.

## Panduan Penggunaan
- Hitung dengan tepat dan akurat.
- Tampilkan penjelasan langkah kalkulasi jika pengguna membutuhkannya.
