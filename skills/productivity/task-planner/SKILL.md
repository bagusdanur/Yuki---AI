---
name: task-planner
category: productivity
title: Task & Notes Planner
description: Kelola catatan, to-do list, agenda belajar, dan pengingat pengguna yang disimpan secara permanen.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: add_user_note
    description: Menyimpan catatan baru atau tugas ke dalam agenda pengguna.
    parameters:
      type: object
      properties:
        title:
          type: string
          description: Judul catatan atau nama tugas (misal "Daftar Tontonan Musim Depan", "Target Belajar Coding")
        content:
          type: string
          description: Isi detail catatan atau butir-butir tugas
        category:
          type: string
          description: Kategori catatan (misal "todo", "watchlist", "study", "general")
      required:
        - title
        - content
  - name: list_user_notes
    description: Melihat daftar catatan atau tugas yang tersimpan milik pengguna.
    parameters:
      type: object
      properties:
        category:
          type: string
          description: Filter kategori opsional ("todo", "watchlist", "study", atau biarkan kosong untuk semua)
  - name: delete_user_note
    description: Menghapus catatan atau tugas tertentu berdasarkan ID.
    parameters:
      type: object
      properties:
        note_id:
          type: integer
          description: ID catatan yang ingin dihapus
      required:
        - note_id
---

# Task Planner Skill

Gunakan skill ini ketika pengguna:
- Meminta dicatatkan sesuatu ("Yuki tolong catat...", "masukin ke to-do listku...").
- Menanyakan catatan/to-do yang pernah disimpan ("apa aja jadwalku?", "lihat daftar anime yang mau kutonton").
- Menghapus tugas yang sudah selesai.

## Panduan Penggunaan
- Simpan dengan judul dan isi yang rapi dan terstruktur.
- Tampilkan konfirmasi dengan gaya tsundere khas Yuki ("Hmph, sudah kucatat ya, jangan sampai kamu lupa!").
