---
name: task-scheduler
category: productivity
title: Yuki Scheduler — Pengingat & Tugas Terjadwal
description: Membuat pengingat otomatis, jadwal berulang, dan tugas terpicu waktu yang persisten lintas sesi.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: schedule_task
    description: Membuat pengingat atau tugas terjadwal baru (sekali atau berulang).
    parameters:
      type: object
      properties:
        title:
          type: string
          description: Nama singkat pengingat (misal "Review Anime Mingguan")
        description:
          type: string
          description: Deskripsi detail apa yang harus dilakukan saat waktu tiba
        schedule:
          type: string
          description: Jadwal dalam bahasa natural (misal "setiap Senin jam 8", "setiap hari jam 20:00", "30 menit lagi", "besok jam 9")
      required:
        - title
        - description
        - schedule
  - name: list_scheduled_tasks
    description: Menampilkan semua pengingat dan tugas terjadwal yang sedang aktif milik pengguna.
    parameters:
      type: object
      properties: {}
  - name: cancel_scheduled_task
    description: Membatalkan pengingat atau tugas terjadwal berdasarkan ID.
    parameters:
      type: object
      properties:
        task_id:
          type: integer
          description: ID tugas yang ingin dibatalkan (dari list_scheduled_tasks)
      required:
        - task_id
---

# Task Scheduler Skill

Gunakan skill ini ketika pengguna:
- Meminta pengingat ("ingatkan aku jam 8 besok...")
- Minta tugas berulang ("setiap Senin, ...")
- Mau lihat jadwal aktif ("jadwal aku apa aja?")
- Mau batalkan pengingat

## Format Jadwal yang Didukung
- `setiap hari jam 8` / `setiap hari jam 20:30`
- `setiap Senin jam 8` (Senin/Selasa/Rabu/Kamis/Jumat/Sabtu/Minggu)
- `setiap 30 menit` / `setiap 2 jam`
- `30 menit lagi` / `2 jam lagi`
- `besok jam 9`
