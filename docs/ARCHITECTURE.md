# Dzeline Shop - System Architecture

## Overview

Offline-first Progressive Web App with eventual consistency sync pattern.

## Architecture Diagram

┌─────────────────────────────────────┐
│ Mobile Device (Cashier Phone) │
│ │
│ ┌──────────────────────────────┐ │
│ │ React PWA (Frontend) │ │
│ │ - UI Components │ │
│ │ - State (Zustand) │ │
│ │ - Service Workers │ │
│ └──────────────────────────────┘ │
│ ↕ │
│ ┌──────────────────────────────┐ │
│ │ IndexedDB (Dexie.js) │ │
│ │ - Products │ │
│ │ - Transactions │ │
│ │ - Sync Queue │ │
│ └──────────────────────────────┘ │
└─────────────────────────────────────┘
↕ (when online)
┌─────────────────────┐
│ Cloud Server │
│ - FastAPI │
│ - PostgreSQL │
│ - Redis │
└─────────────────────┘

## Data Flow

### Sale Transaction (Offline)

1. Cashier selects products → Cart (Zustand)
2. Checkout → Create transaction record
3. Store in IndexedDB (local)
4. Add to sync queue
5. Generate receipt → Print via Bluetooth

### Sync (When Online)

1. Detect internet connection
2. Read sync queue from IndexedDB
3. POST transactions to API
4. Receive confirmation
5. Mark as synced in IndexedDB
6. Clear from queue

## Technology Decisions

### Why PWA?

- Works offline immediately
- No app store approval
- Instant updates
- Cross-platform (Android, iOS, Desktop)

### Why IndexedDB?

- Large storage capacity (50MB+)
- Async API (doesn't block UI)
- Structured data with indexes
- Native browser support

### Why Zustand?

- Lightweight (1KB)
- Simple API
- No boilerplate
- React hooks integration

## Security Considerations

- Sensitive data encrypted in IndexedDB
- HTTPS only in production
- API authentication via JWT
- Rate limiting on sync endpoint
- M-Pesa credentials in environment variables

## Scalability

**Phase 1-2:** Single device, local-only
**Phase 3:** Multiple devices, cloud sync
**Phase 4:** Multiple locations, advanced analytics
