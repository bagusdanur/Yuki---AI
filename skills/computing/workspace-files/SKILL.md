---
name: workspace-files
category: computing
title: Isolated Coding Workspace
description: Membaca, mencari, membuat, dan memperbaiki file hanya di workspace proyek terisolasi milik pengguna.
version: 1.0.0
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

# Isolated Coding Workspace

Gunakan skill ini untuk mengerjakan atau memperbaiki kode di workspace pengguna.

1. Selalu baca dan cari kode terkait sebelum mengubah file yang sudah ada.
2. Gunakan `replace_workspace_text` untuk bugfix; jangan membuat file pengganti baru.
3. `create_workspace_file` hanya untuk file yang belum ada atau memang diminta pengguna.
4. Pertahankan arsitektur, nama fungsi, dan bagian yang tidak berkaitan.
5. Setelah edit, baca ulang bagian yang berubah dan jelaskan perubahan nyata.
6. Tidak tersedia shell, SSH, PM2, `.env`, database, private key, atau project VPS lain.
7. Gunakan `get_workspace_diff` setelah edit dan `validate_workspace_project` sebelum menyatakan tugas selesai.
8. Gunakan `patch_workspace_files` jika perubahan harus konsisten pada beberapa file sekaligus.
9. Gunakan `rollback_workspace_file` jika patch menghasilkan regresi.
10. Gunakan `run_workspace_tests` hanya untuk test JavaScript yang sudah berada di workspace; runner memakai permission sandbox tanpa network, child process, atau akses filesystem luar.
