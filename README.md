# Dzeline Shop — Offline-First POS System

Supermarket point-of-sale system built for Kenya's small businesses.

[![License: Private](https://img.shields.io/badge/License-Private-red.svg)](LICENSE)
[![Phase: Field-Ready](https://img.shields.io/badge/Phase-Field--Ready-success)](HANDOFF.md)

## Project Vision

A mobile-first, offline-capable digital shop platform that works reliably in areas with unstable internet connectivity. Built specifically for small-to-medium supermarkets in Kenya.

## Features

### Sales

- 100% Offline Operation — works without internet; sales save locally and sync automatically
- Product Catalog — browse, search, barcode scan (camera OCR)
- Shopping Cart — add, remove, adjust quantities
- VAT Calculation — inclusive 16% Kenya VAT with KRA receipt
- Payments — Cash, M-Pesa STK Push, Pochi la Biashara
- Transaction History — last 50 sales, expandable, void support
- Offline indicator banner — amber bar shows when offline, disappears on reconnect

### Staff

- Role-Based Access Control — 6 roles: Admin, Sub-Admin, Stock Keeper, Sales Manager, Cashier, Custom
- Staff PIN Login — per-staff PIN with SHA-256 hashing
- Bottom Tab Navigation — Products, Cart, Stock, Reports, Settings panels

### Stock

- Stock Receiving — attendant submits delivery with qty, unit cost, expiry date, condition (Good / Short Expiry / Damaged)
- Staged Pricing Review — manager reviews pending deliveries, sets selling prices, activates stock
- Stock increments only on manager activation, not on submission
- Supplier management, reorder alerts, inventory by category
- AI Invoice Scanning — camera → Claude Haiku vision → auto-fills supplier, invoice no., line items

### Printing

- Bluetooth Thermal Printer — Web Bluetooth ESC/POS for BLE receipt printers (Rongta, Sewoo, Microchip)
- Browser Print Fallback — 58mm HTML receipt via `window.print()` for USB or OS-paired printers
- Printer pairing in Settings

### Analytics

- Daily Summary — Today / This Week / This Month with cashier breakdown
- Finance tab — P&L, margin, COGS, stock valuation, top products by profit

### Compliance

- eTIMS / KRA — full VSCU device init, product registration, invoice submission
- KRA-format receipts with sequential invoice numbers

### Platform

- Progressive Web App — installable, offline-first, auto-update banner
- Android APK — TWA wrapper (bubblewrap) for direct distribution
- Multi-tenant backend — FastAPI + PostgreSQL, syncs sales + stock receipts on reconnect

## Tech Stack

### Frontend

- **React 19** — UI framework
- **Vite 8** — build tool
- **Tailwind CSS 4** — CSS-first (`@theme` variables)
- **Dexie.js 4** — IndexedDB wrapper (atomic transactions, v9 schema)
- **Zustand 5** — cart, staff, nav, settings state with `persist` middleware
- **PWA** — Service Workers (Workbox) for offline, Web App Manifest

### Backend

- **FastAPI** — Python API framework
- **SQLAlchemy 2** — ORM with `pool_pre_ping` + `pool_recycle` for Render Postgres
- **PostgreSQL 15** — primary database (Render managed)
- **psycopg2** — Postgres driver

### Infrastructure

- **Vercel** — frontend CDN + HTTPS
- **Render** — backend API + managed Postgres

## Project Structure

```text
dzeline-shop/
├── frontend/
│   └── src/
│       ├── components/       # UI components
│       ├── services/         # db.js (Dexie v9), sync.js, thermalPrinter.js, etims.js
│       ├── store/            # Zustand stores
│       └── utils/            # apiHeaders, permissions, hooks
├── backend/
│   └── app/
│       ├── routers/          # products, sync, mpesa, etims, admin, scan, stock_receipts
│       ├── models.py         # SQLAlchemy ORM models
│       ├── deps.py           # get_tenant dependency
│       └── main.py
├── HANDOFF.md
└── README.md
```

## Quick Start

```bash
# Frontend
cd frontend
npm install
npm run dev           # → http://localhost:5173
# First run: setup wizard creates admin + seeds products
# Default admin PIN (dev only): 1234
```

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env  # fill in values
python run.py         # → http://localhost:8000
# Docs: http://localhost:8000/docs
```

## Development Status

| Phase | Theme | Status |
| --- | --- | --- |
| 1 | Core POS (products, cart, IndexedDB) | ✅ |
| 2 | Payments + receipts (Cash, M-Pesa, Pochi) | ✅ |
| 3 | Staff / PIN login | ✅ |
| 4 | Backend, sync, transaction history | ✅ |
| 5 | Product editing, Pochi, analytics, scanner | ✅ |
| E | Navigation overhaul (bottom tab + inline panels) | ✅ |
| A | RBAC — granular role-based permissions | ✅ |
| C | Financial intelligence / P&L | ✅ |
| D | AI invoice scanning | ✅ |
| F | Offline reliability + thermal printing + staged stock receiving | ✅ |
| B | Real-time multi-device sync (WebSocket) | 📋 Planned |

See [HANDOFF.md](HANDOFF.md) for full technical details.

## Kenya-Specific Features

- KRA eTIMS compliance — VSCU device init, invoice submission
- M-Pesa STK Push + Pochi la Biashara payments
- 16% inclusive VAT with KES formatting
- SMS M-Pesa code reconciliation (offline confirmation)
- Offline-first for areas with poor connectivity
- Mobile-optimized for phone-first users

## License

Private — © 2026 Dzeline Supermarket

## Developer

**Noxus Player** (Anubis101) · Nairobi, Kenya · dzeline.com
