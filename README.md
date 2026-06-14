# Dzeline Shop - Offline-First POS System

Supermarket point-of-sale system built for Kenya's small businesses

[![License: Private](https://img.shields.io/badge/License-Private-red.svg)](LICENSE)
[![Phase: A Complete](https://img.shields.io/badge/Phase-A%20Complete-success)](HANDOFF.md)

## 🎯 Project Vision

A mobile-first, offline-capable digital shop platform that works reliably in areas with unstable internet connectivity. Built specifically for small-to-medium supermarkets in Kenya.

## ✨ Features

- ✅ **100% Offline Operation** - Works without internet
- ✅ **Product Catalog** - Browse, search, barcode scan
- ✅ **Shopping Cart** - Add, remove, adjust quantities
- ✅ **VAT Calculation** - Inclusive 16% Kenya VAT with KRA receipt
- ✅ **Payments** - Cash, M-Pesa STK Push, Pochi la Biashara
- ✅ **Transaction History** - Last 50 sales, expandable, void support
- ✅ **Bottom Tab Navigation** - Products, Cart, Stock, Reports, Settings panels
- ✅ **Role-Based Access Control** - 6 roles: Admin, Sub-Admin, Stock Keeper, Sales Manager, Cashier, Custom
- ✅ **Staff PIN Login** - Per-staff PIN with SHA-256 hashing
- ✅ **Stock Management** - Receiving, suppliers, reorder alerts, inventory by category
- ✅ **Daily Summary & Analytics** - Today / This Week / This Month with cashier breakdown
- ✅ **Product Images** - Camera capture → base64 in IndexedDB
- ✅ **eTIMS / KRA** - Settings panel for KRA PIN and filing
- ✅ **Progressive Web App** - Installable, offline-first, auto-update banner

## 🚧 Planned

- 🔜 **Multi-device sync** - WebSocket real-time sync (Phase B)
- 🔜 **Financial dashboard** - Cost vs revenue, profit margins (Phase C)
- 🔜 **AI invoice scanning** - Camera → OCR → auto-fill stock receive (Phase D)
- 🔜 **Bluetooth thermal printer** - Web Bluetooth + ESC/POS

## 🛠️ Tech Stack

### Frontend (Phase 1–2)

- **React 19.2** - UI framework
- **Vite 8.0** - Build tool
- **Tailwind CSS 4.3** - Styling (CSS-first, `@theme` variables)
- **Dexie.js 4.4** - IndexedDB wrapper (atomic transactions)
- **Zustand 5.0** - Cart state with `persist` middleware
- **PWA** - Service Workers for offline, Web App Manifest

### Backend (Phase 3 - Planned)

- **FastAPI** - Python API framework
- **PostgreSQL 15** - Primary database
- **Redis** - Caching & queue
- **Celery** - Background jobs

### Infrastructure

- **Cloudflare** - CDN & SSL
- **DigitalOcean** - VPS hosting
- **GitHub Actions** - CI/CD

## 📁 Project Structure

dzeline-shop/
├── frontend/ # React PWA
│ ├── src/
│ │ ├── components/ # UI components
│ │ ├── services/ # Database & API
│ │ ├── store/ # State management
│ │ └── utils/ # Helpers & hooks
│ └── public/
├── backend/ # API (Coming in Phase 3)
├── docs/ # Documentation
├── HANDOFF.md # Project handoff document
└── README.md # This file

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Modern web browser (Chrome/Edge recommended)

### Installation

```bash
# Clone repository
git clone https://github.com/Dzeline/dzeline-shop.git
cd dzeline-shop

# Install dependencies
cd frontend
npm install

# Start development server
npm run dev

# Open browser to http://localhost:5173
```

### Test Offline Mode

1. Open DevTools (F12)
2. Network tab → Set to "Offline"
3. Refresh page
4. App continues working! ✅

### Test on Phone

```bash
# Start with network access
npm run dev -- --host

# Find your local IP
ipconfig  # Windows
ifconfig  # Mac/Linux

# Access from phone (same WiFi)
# http://YOUR_IP:5173
```

## 📊 Development Status

| Phase                                 | Status      |
| ------------------------------------- | ----------- |
| **Phase 1: Core Shop**                | ✅ Complete |
| **Phase 2: Payments**                 | ✅ Complete |
| **Phase 3: Staff / PIN**              | ✅ Complete |
| **Phase 4: Backend & Sync**           | ✅ Complete |
| **Phase 5: Advanced Features**        | ✅ Complete |
| **Phase E: Navigation Overhaul**      | ✅ Complete |
| **Phase A: RBAC**                     | ✅ Complete |
| **Phase B: Multi-device Sync**        | 📋 Planned  |
| **Phase C: Financial Intelligence**   | ✅ Complete |
| **Phase D: AI Invoice Scanning**      | 📋 Planned  |

See [HANDOFF.md](HANDOFF.md) for detailed development roadmap.

## 🇰🇪 Kenya-Specific Features

- **KRA Compliance** - Tax-compliant receipt format
- **M-Pesa Integration** - Popular mobile payment method
- **16% VAT** - Automatic tax calculation
- **Shilling Currency** - KES formatting
- **Offline-First** - Works in areas with poor connectivity
- **Mobile-Optimized** - Most users access via phones

## 📝 License

Private - © 2026 Dzeline Supermarket

## 👨‍💻 Developer

**Noxus Player** (Anubis101)

- Callsign: noxusdeline1001
- Domain: dzeline.com
- Location: Nairobi, Kenya

## 🤝 Contributing

This is a private project. For collaboration inquiries, contact via GitHub.

## 📞 Support

For issues or questions:

- Open an issue on GitHub
- See [HANDOFF.md](HANDOFF.md) for technical details

---

\*Built with ❤️ in Kenya for Kenyan businesses\*\*
