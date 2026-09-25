# Backend API Reference

FastAPI service backing the Dzeline Shop PWA. Interactive docs at `/docs` on any running
instance.

- **Production**: `https://dzeline-api.onrender.com`
- **Local**: `http://localhost:8000`

## Authentication

Every route except the four below requires a tenant API key:

```http
X-API-Key: <tenant api key>
```

The key is hashed and resolved to a tenant by `Depends(get_tenant)`, which also checks the
tenant is active and within its billing window. A device holding the key acts for the whole
shop — there is no per-user API auth; staff PINs gate the UI only.

| Route | Auth instead |
| --- | --- |
| `/health` | public |
| `/admin/*` | `X-Admin-Secret` header |
| `/sms/webhook` | `?key=` tenant API key in the URL, plus `X-SMS-Secret` when the server has one configured |
| `/mpesa/callback` | restricted to Safaricom IP ranges |

Clients must build headers with `apiHeaders()` / `apiGetHeaders()` from
`frontend/src/utils/apiHeaders.js` rather than assembling them by hand.

## Idempotency

Every sync upload is idempotent by `local_id` — the device's own row id. A retried push
after a dropped connection updates rather than duplicates. Preserve this on any new sync
endpoint: the client retries freely and assumes it is safe.

---

## Products

| Method | Path | Description |
| --- | --- | --- |
| GET | `/products/` | List the tenant's catalogue |
| POST | `/products/` | Create a product |
| PUT | `/products/{id}` | Update a product |
| DELETE | `/products/{id}` | Delete a product |
| GET | `/products/low-stock` | Products at or below `reorder_level` |

## Staff

Cloud roster behind the multi-device staff sync. Deletes are soft (tombstoned) so an
offline delete is not resurrected by a pull.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/staff` | List staff |
| POST | `/staff` | Create staff member |
| PUT | `/staff/{id}` | Update staff member |
| DELETE | `/staff/{id}` | Soft-delete staff member |

## Suppliers

| Method | Path | Description |
| --- | --- | --- |
| GET | `/suppliers` | List suppliers |
| POST | `/suppliers` | Create supplier |
| PUT | `/suppliers/{id}` | Update supplier |
| DELETE | `/suppliers/{id}` | Soft-delete supplier |

## Shop settings

Cloud mirror of per-shop settings, so a second till adopts the shop's configuration instead
of being set up from scratch.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/settings` | Read shop settings |
| PUT | `/settings` | Replace shop settings |

## Sync — transactions

| Method | Path | Description |
| --- | --- | --- |
| POST | `/sync/transactions` | Upload a completed sale with line items (idempotent by `local_id`) |
| GET | `/sync/transactions` | List synced transactions (`skip`, `limit`) |
| GET | `/sync/status` | `{ synced_transactions: int }` |

## Stock receipts

| Method | Path | Description |
| --- | --- | --- |
| POST | `/stock-receipts` | Upload a receipt and its items (idempotent by `local_id`) |
| PUT | `/stock-receipts/{id}` | Update a receipt — how a manager activates a draft recorded on another device |
| GET | `/stock-receipts` | List receipts (most recent first) |

`PUT` matters: unlike transactions, a receipt is legitimately mutated by a device other
than the one that created it.

## Supplier payments

Money paid against supplier invoices. Shared because the owner pays and the
staff receive, usually on different devices.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/supplier-payments?since=` | Payments recorded since a timestamp |
| POST | `/supplier-payments` | Record a payment (idempotent by device + local id) |

A payment is never edited after the fact — a correction is another row.

## Print jobs

Shared-printer queue. A till with no printer enqueues a job per sale; the device marked as
the hub in Settings polls and prints.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/print-jobs` | Enqueue a receipt for the hub to print |
| GET | `/print-jobs` | Hub polls for pending jobs |
| PUT | `/print-jobs/{id}` | Mark a job printed or failed |

## M-Pesa

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/mpesa/stk-push` | `X-API-Key` | Initiate STK Push against the customer's phone |
| POST | `/mpesa/callback` | Safaricom IPs | Daraja posts the result here |
| GET | `/mpesa/status/{id}` | `X-API-Key` | Poll the tracked `StkRequest` |
| GET | `/mpesa/stk-query/{id}` | `X-API-Key` | Ask Daraja directly, bypassing the callback |

## SMS verification

Fallback for when the Daraja callback never arrives: the shop's Android SMS listener
forwards M-Pesa confirmation texts, and tills reconcile against them.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/sms/webhook?key=<api-key>` | `?key=` + `X-SMS-Secret` | Receive an M-Pesa SMS from the shop device |
| GET | `/sms/verified-codes?since=` | `X-API-Key` | Pull this tenant's codes since a timestamp |

The `?key=` parameter is **required** — it says which shop the payment belongs
to. It used to be optional, and a webhook authenticated by the shared secret
alone stored its codes with `tenant_id = NULL`, which `verified-codes` then
returned to *every* tenant: one shop could read another's confirmation codes,
amounts and customer names, and reconcile its own sales against them. Unscoped
writes are now rejected and reads are scoped strictly to the caller.

Codes are matched on **both code and amount** during reconciliation. A code
alone would clear a sale of any size.

## eTIMS / KRA

| Method | Path | Description |
| --- | --- | --- |
| GET | `/etims/status` | Device status and environment |
| GET / POST | `/etims/config` | Read / write KRA credentials |
| POST | `/etims/branches` | Query the KRA branch registry |
| POST | `/etims/device/init` | Initialise the VSCU device with KRA |
| POST | `/etims/items/register` | Register product codes with KRA |
| POST | `/etims/submit-batch` | Submit sales invoices |

## AI invoice scanning

Rate limited to **6 requests per minute per tenant**. Needs `ANTHROPIC_API_KEY` set on the
backend.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/scan/invoice` | Base64 invoice photo → `{ supplier, invoice_number, items[] }` |

## Admin

All require `X-Admin-Secret`. These manage tenants, not shop data.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/admin/tenants` | Create a tenant — returns the raw API key **once** |
| GET | `/admin/tenants` | List tenants |
| GET | `/admin/tenants/{id}` | Get one tenant |
| PATCH | `/admin/tenants/{id}` | Update plan or active flag |
| POST | `/admin/tenants/{id}/rotate-key` | Rotate the API key |
| POST | `/admin/tenants/{id}/claim-legacy-data` | Adopt pre-multi-tenant rows |

## Health

```http
GET /health  →  { "status": "ok" }
```

Public, and the endpoint uptime checks should hit.

---

## Client call sites

Where each endpoint is actually called from, for tracing a change through the frontend:

| File | Endpoint | Trigger |
| --- | --- | --- |
| `sync.js` | `/sync/transactions` | Reconnect, and after each sale |
| `sync.js` | `/stock-receipts` (POST, PUT, GET) | Reconnect; manager activation |
| `sync.js` | `/products` (push, pull) | Reconnect; 45s pull interval |
| `sync.js` | `/staff` (push, pull) | Reconnect; 45s pull interval |
| `sync.js` | `/suppliers` (push, pull) | Reconnect; 45s pull interval |
| `sync.js` | `/settings` (push, pull) | Reconnect; settings save |
| `sync.js` | `/print-jobs` | After a sale; hub polling |
| `sync.js` | `/supplier-payments` (push, pull) | On recording a payment; reconnect; 45s pull |
| `sync.js` | `/mpesa/stk-push`, `/mpesa/status/{id}`, `/mpesa/stk-query/{id}` | M-Pesa checkout, STK polling |
| `sync.js` | `/sms/verified-codes` | Reconnect reconciliation |
| `etims.js` | all `/etims/*` | eTIMS panel |
| `StockReceiving.jsx` | `/scan/invoice` | Invoice photo scan |
