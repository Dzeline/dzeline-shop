# Dzeline Shop — offline-first POS

Point-of-sale for small and mid-size supermarkets in Kenya. Runs on a phone in the hand or
a desktop till, keeps selling when the internet drops, and reconciles when it returns.

![License: Private](https://img.shields.io/badge/License-Private-red.svg)
[![Phase: Field-Ready](https://img.shields.io/badge/Phase-Field--Ready-success)](HANDOFF.md)

## Why it exists

Connectivity in the target market is intermittent, and a till that stops selling when the
line drops is worse than no till at all. Every action writes locally first and returns
immediately; nothing on the sell path waits for the network.

## Features

**Selling** — product grid with live search and barcode scanning (camera, or a USB/Bluetooth
wedge scanner on a desktop till); continuous scanning that keeps the camera open across a
whole basket; a cart that stays visible while you shop; Cash, M-Pesa STK Push and Pochi la
Biashara; VAT-inclusive KRA receipts; transaction history with void.

**Stock** — staged receiving that separates the attendant who records a delivery from the
manager who prices it; supplier directory with WhatsApp and email purchase orders; reorder
alerts; CSV import; AI invoice scanning from a photo.

**Staff** — six roles from Admin to Cashier plus a custom role, PIN login with SHA-256
hashing, per-role navigation.

**Reporting** — daily, weekly, monthly and yearly summaries with cashier breakdown; P&L with
margin, COGS and stock valuation; accountant-ready CSV export.

**Compliance** — KRA eTIMS VSCU device init, product registration and invoice submission,
with sequential invoice numbers.

**Platform** — installable PWA with offline caching and update prompts; Android APK via TWA;
multi-device sync of products, staff, settings, suppliers, receipts and sales; Bluetooth
thermal printing with a shared-printer queue for multi-till shops.

## Tech

| Layer | Stack |
|---|---|
| Frontend | React 19 · Vite 8 · Tailwind CSS 4 (CSS-first `@theme`) · Dexie 4 · Zustand 5 · vite-plugin-pwa |
| Backend | FastAPI · Pydantic v2 · SQLAlchemy 2 · PostgreSQL |
| Hosting | Vercel (frontend) · Render (API) · Neon (database) |

## Quick start

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173, admin PIN 1234 in dev
```

The frontend runs standalone — the backend is only needed for sync, payments and eTIMS.
Backend setup, environment variables and deployment are in [docs/SETUP.md](docs/SETUP.md).

## Documentation

| Document | Covers |
|---|---|
| [HANDOFF.md](HANDOFF.md) | Current state, what shipped, known issues, what's next |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works: sync model, schemas, RBAC, VAT, code standards |
| [docs/API.md](docs/API.md) | Backend endpoints, auth, client call sites |
| [docs/SETUP.md](docs/SETUP.md) | Local dev, env vars, deployment, printers, APK |
| [docs/UI_OVERHAUL_PLAN.md](docs/UI_OVERHAUL_PLAN.md) | The cross-device UI work, phase by phase |

## Repository layout

```text
dzeline-shop/
├── frontend/            React PWA — see frontend/README.md
├── backend/             FastAPI service
├── android-sms-listener/  Android app forwarding M-Pesa SMS for reconciliation
├── docs/                Architecture, API, setup, UI plan
├── scripts/             build-apk
├── render.yaml          Backend deploy config
└── HANDOFF.md
```

## Built for Kenya

KRA eTIMS compliance · M-Pesa STK Push and Pochi la Biashara · 16% inclusive VAT in KES ·
SMS reconciliation for when the payment callback never arrives · offline-first throughout.

---

Private — © 2026 Dzeline Supermarket · Nairobi, Kenya · dzeline.com
