---
name: delegate-task
category: computing
title: Yuki Subagent — Paralel Task Delegation
description: Membagi task kompleks menjadi beberapa subtask yang dikerjakan secara paralel oleh subagent terisolasi, lalu hasilnya dirangkum.
version: 1.0.0
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

# Delegate Task Skill

Gunakan skill ini ketika:
- Task terlalu kompleks untuk diselesaikan dalam satu langkah
- Perlu riset beberapa aspek yang bisa dikerjakan bersamaan
- Perlu membandingkan beberapa sumber/sudut pandang sekaligus

## Contoh Penggunaan

**User:** "Bandingkan 3 anime isekai terbaik musim ini dari berbagai sisi"

**Delegation:**
- Subtask 1: "Cari sinopsis dan rating Mushoku Tensei Season 3"
- Subtask 2: "Cari sinopsis dan rating That Time I Got Reincarnated as a Slime"
- Subtask 3: "Cari review penonton dan skor MAL untuk kedua anime tersebut"

## Batasan
- Maksimal 4 subtask paralel
- Setiap subagent timeout setelah 45 detik
- Subagent tidak bisa spawn subagent lagi
