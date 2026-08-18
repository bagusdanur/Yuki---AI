---
name: datetime-helper
category: productivity
title: Datetime & Timezone Assistant
description: Mengetahui tanggal, jam, hari, selisih waktu, atau hitung mundur ke tanggal tertentu secara presisi.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: get_current_time
    description: Mengambil waktu dan tanggal saat ini dalam zona waktu Indonesia (WIB, WITA, WIT) atau UTC.
    parameters:
      type: object
      properties:
        timezone:
          type: string
          description: Zona waktu yang dicari ("WIB", "WITA", "WIT", "UTC", default "WIB")
  - name: calculate_date_difference
    description: Menghitung selisih hari atau durasi antara hari ini dengan tanggal target di masa lalu atau masa depan.
    parameters:
      type: object
      properties:
        target_date:
          type: string
          description: Tanggal target dalam format YYYY-MM-DD (misal "2026-12-31")
      required:
        - target_date
---

# Datetime Helper Skill

Gunakan skill ini ketika pengguna bertanya:
- Jam berapa sekarang / hari apa sekarang.
- Berapa hari lagi menuju tanggal rilis anime, event, atau ulang tahun.
- Konversi waktu antar zona waktu.
