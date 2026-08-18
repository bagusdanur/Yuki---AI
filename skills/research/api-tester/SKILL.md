---
name: api-tester
category: research
title: REST API & HTTP Tester
description: Menguji endpoint REST API publik, webhook, atau healthcheck HTTP secara langsung dengan status code, latency ms, dan format JSON.
version: 1.0.0
author: Yuki Agent Team
tools:
  - name: http_api_request
    description: Melakukan request HTTP (GET, POST, PUT, DELETE) ke URL target dan mengembalikan data status dan response.
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL target lengkap yang ingin diuji (http:// atau https://)
        method:
          type: string
          description: Metode HTTP ("GET", "POST", "PUT", "DELETE", default "GET")
        headers:
          type: object
          description: Header request opsional (misal { "Content-Type": "application/json" })
        body:
          type: string
          description: Request body string (JSON atau text) untuk method POST/PUT
      required:
        - url
---

# API Tester Skill

Gunakan skill ini ketika pengguna:
- Meminta pengujian apakah sebuah API / endpoint sedang online / aktif.
- Meminta simulasi pemanggilan REST API atau webhook.
- Meminta pengecekan status code, headers, latency, atau format response JSON.

## Panduan Penggunaan
- Selalu tampilkan status code (misal `200 OK`, `404 Not Found`), latency waktu pengerjaan dalam milidetik, dan ringkasan body response.
