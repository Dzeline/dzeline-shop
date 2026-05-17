# Dzeline Shop - Offline-First POS System

**Supermarket point-of-sale system built for Kenya's small businesses**

[![License: Private](https://img.shields.io/badge/License-Private-red.svg)](LICENSE)
[![Phase: 1 Complete](https://img.shields.io/badge/Phase-1%20Complete-success)](HANDOFF.md)

## 🎯 Project Vision

A mobile-first, offline-capable digital shop platform that works reliably in areas with unstable internet connectivity. Built specifically for small-to-medium supermarkets in Kenya.

## ✨ Features (Phase 1 Complete)

- ✅ **100% Offline Operation** - Works without internet
- ✅ **Product Catalog** - Browse & search 10+ products
- ✅ **Shopping Cart** - Add, remove, adjust quantities
- ✅ **VAT Calculation** - Automatic 16% Kenya VAT
- ✅ **Mobile-First UI** - Optimized for phones/tablets
- ✅ **IndexedDB Storage** - Local-first data persistence
- ✅ **Progressive Web App** - Installable on any device

## 🚧 Coming Soon (Phase 2-4)

- 🔜 **Cash Payments** - Record cash transactions
- 🔜 **M-Pesa Integration** - STK Push + offline fallback
- 🔜 **Receipt Generation** - KRA-compliant receipts
- 🔜 **Bluetooth Printing** - Thermal printer support
- 🔜 **Cloud Sync** - Backup to server when online
- 🔜 **Multi-Device** - Sync across multiple registers
- 🔜 **Analytics Dashboard** - Sales reports & insights

## 🛠️ Tech Stack

### Frontend (Phase 1)

- **React 19.2** - UI framework
- **Vite 8.0** - Build tool
- **Tailwind CSS 4.3** - Styling
- **Dexie.js 4.4** - IndexedDB wrapper
- **Zustand 5.0** - State management
- **PWA** - Service Workers for offline

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

| Phase                          | Status      | Completion |
| ------------------------------ | ----------- | ---------- |
| **Phase 1: Core Shop**         | ✅ Complete | 100%       |
| **Phase 2: Payments**          | 🔜 Next     | 0%         |
| **Phase 3: Sync & Backend**    | 📋 Planned  | 0%         |
| **Phase 4: Advanced Features** | 📋 Planned  | 0%         |

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

**Built with ❤️ in Kenya for Kenyan businesses**
