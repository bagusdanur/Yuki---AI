---
name: workspace-files
category: computing
title: Isolated Coding Workspace
description: Membaca, mencari, membuat, dan memperbaiki file hanya di workspace proyek terisolasi milik pengguna.
version: 2.0.0
author: Yuki Agent Team
tools:
  - name: list_workspace_files
  - name: read_workspace_file
  - name: search_workspace_code
  - name: create_workspace_file
  - name: replace_workspace_text
  - name: get_workspace_diff
  - name: rollback_workspace_file
  - name: patch_workspace_files
  - name: validate_workspace_project
  - name: run_workspace_tests
---

# Isolated Coding Workspace (Claude Code-Grade Playbook)

Gunakan skill ini untuk inspeksi, debugging, refactoring, dan implementasi kode di workspace terisolasi milik pengguna.

## Alur Kerja Wajib (Jangan Lompati Tahap)
1. **Pahami & Peta Struktur:** Panggil `list_workspace_files` atau `search_workspace_code` dulu untuk menemukan file & simbol yang relevan — jangan menebak path atau isi file.
2. **Baca Sebelum Edit:** Panggil `read_workspace_file` pada file target untuk memahami konteks sekitar dan mendapatkan `hash` terbaru.
3. **Diagnosis Root Cause:** Jelaskan akar masalah secara konkret (file, fungsi, baris, penyebab) sebelum menulis perubahan.
4. **Patch Minimal & Atomik:**
   - Gunakan `replace_workspace_text` (1 file) atau `patch_workspace_files` (2–10 file terkait) dengan `expected_hash` terbaru.
   - Jangan pernah menulis ulang seluruh file atau membuat file pengganti baru jika hanya memperbaiki bug.
   - `create_workspace_file` hanya untuk file baru yang memang belum ada atau diminta eksplisit.
   - Dilarang menulis placeholder seperti `// ... rest of code` atau `// TODO`.
5. **Verifikasi Wajib:**
   - Panggil `get_workspace_diff` untuk memastikan perubahan bersih dan tidak merusak bagian lain.
   - Panggil `validate_workspace_project` (dan `run_workspace_tests` bila ada file test).
   - Jika validasi/test gagal, perbaiki segera atau panggil `rollback_workspace_file` — jangan pernah mengklaim berhasil saat validasi gagal.

## Batasan Keamanan
- Hanya beroperasi di workspace pengguna; tidak ada akses shell, SSH, `.env`, database host, atau project lain.
