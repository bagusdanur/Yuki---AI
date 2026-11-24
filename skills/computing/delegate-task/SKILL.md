---
name: delegate-task
category: computing
title: Yuki Subagent — Paralel Task Delegation
description: Membagi task kompleks menjadi beberapa subtask yang dikerjakan secara paralel oleh subagent terisolasi, lalu hasilnya dirangkum.
version: 2.0.0
author: Yuki Agent Team
tools:
  - name: delegate_tasks
    description: Membagi task besar menjadi 2-4 subtask paralel yang dikerjakan oleh subagent mandiri secara bersamaan, lalu hasilnya digabungkan.
    parameters:
      type: object
      properties:
        tasks:
          type: array
          description: Daftar 2-4 subtask spesifik yang akan dikerjakan paralel (setiap item adalah string deskripsi tugas)
          items:
            type: string
        shared_context:
          type: string
          description: Konteks bersama yang diberikan ke semua subagent (topik utama, batasan, dll)
      required:
        - tasks
---

# Parallel Subagent Orchestration (Claude Multi-Agent Playbook)

Gunakan skill ini saat tugas mencakup beberapa aspek independen (misal membandingkan beberapa teknologi/anime/sumber, riset multi-sudut, atau analisis paralel).

## Prinsip Dekomposisi
1. **Subtask Independen & Tidak Tumpang Tindih:** Setiap item di `tasks` harus punya tujuan tunggal yang jelas dan format hasil yang terukur.
2. **Konteks Bersama Ringkas:** Isi `shared_context` dengan batasan utama (tahun, bahasa, kriteria perbandingan) agar semua worker konsisten.
3. **Sintesis Agent Utama:** Setelah semua worker selesai, gabungkan temuan dalam tabel/ringkasan terpadu, soroti perbedaan antar sumber, dan laporkan bila ada subtask yang gagal tanpa mengarang datanya.

## Batasan Sistem
- Maksimal 4 subtask (2 worker aktif paralel, timeout 45 detik per worker).
- Worker bersifat read-only dan tidak dapat spawn subagent lagi.
