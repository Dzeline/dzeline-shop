# Backup and recovery

How a shop gets its data back. Written 2026-09-26, before Neon is restored, so
the phasing assumes the backend comes back first.

## Where a shop's data actually lives

Two copies, and neither is a backup:

| | What it holds | What it survives |
|---|---|---|
| **The device** (IndexedDB) | everything, and it is the working copy | nothing — clearing site data destroys it |
| **The cloud** (Neon) | what has synced | a lost device, but not its own deletion |

Sync makes the two agree. It does not make either one recoverable, because both
converge on the *current* state: a product deleted by mistake is deleted
everywhere within 45 seconds, and there is nothing to go back to.

## What is broken today

Verified against the code, not assumed:

**A replacement device does not get the shop's history.** `JoinShop` pulls
products, staff and settings — and stops. No transactions, no stock receipts, no
suppliers, no purchase orders, no payments. A shop whose only till is stolen
gets a working catalogue and an empty past.

**Even on an existing device, history older than 35 days never arrives.**
`pullTransactions` uses a stored watermark, and with no watermark it defaults to
`Date.now() - 35 days`. A device that has never pulled will never see anything
older.

**Several tables do not sync at all.** Purchase orders, shifts, cash movements,
void reasons. These exist only on the device that created them.

**Nothing is point-in-time.** There is no snapshot, so there is no answer to "we
deleted the wrong thing an hour ago".

**The invoice photos are the largest thing in the database** and live in the
same place as everything else, so any export has to reckon with size.

## What we are protecting against

Ranked by how likely they are in this market, which is not the same as how
dramatic they sound:

1. **A phone is lost, stolen, sold, or dies.** Overwhelmingly the most common.
2. **Browser storage is cleared** — a "clear cache to fix it" from a helpful
   nephew, or an aggressive storage reclaim on a cheap Android.
3. **Somebody deletes the wrong thing** and does not notice for a day.
4. **The shop stops paying** and wants their data — a fair expectation, and one
   worth being able to meet on demand rather than as a favour.
5. **We lose the backend.** Unlikely with a managed Postgres, but the whole
   point of a backup is that likelihood is not the test.

Note that (1) and (2) are already *mostly* covered by sync — except for the gaps
above, which is why closing them is phase 1 rather than building anything new.

## The plan

### Phase 1 — make sync actually recover a device *(no backend work)*

The cheapest protection is the machinery already built. Right now it does not
finish the job.

| Item | Work |
|---|---|
| A joining device pulls **everything** | `JoinShop` should pull transactions, receipts, suppliers, orders and payments, not just the catalogue — with a progress indicator, since this is minutes on a slow connection |
| Drop the 35-day floor for a first pull | When there is no watermark, pull from the beginning; keep the watermark only for incremental pulls afterwards |
| Sync the tables that do not | Purchase orders, shifts, cash movements |
| Show what is not backed up | The offline banner says data is saved locally; it should also say when the last successful sync was. "Last synced 3 days ago" is the only warning a shop will ever get before losing a phone |

This alone turns "my phone died" from a disaster into an inconvenience, and it
needs nothing from Neon.

### Phase 2 — an export the shop owns *(no backend work)*

A file the shop can keep, mail to themselves, or hand to an accountant.

| Item | Work |
|---|---|
| **Full backup file** | One JSON file of every table, versioned with the schema number, downloaded from Settings |
| **Restore from file** | Import on a fresh device, with a clear warning that it replaces what is there |
| Photos are optional | Invoice images dominate the size; offer "with photos" and "without", because a 200MB file will not leave a Kenyan phone |
| Verify on write | Re-read and count the rows after generating, so a truncated file is caught then rather than on the day it is needed |

This is the one that answers "can my client get their data out" without any
dependency on us, and it works offline.

A backup that has never been restored is a guess. The restore path should be
exercised on a spare device before this is offered to anyone.

### Phase 3 — server-side snapshots *(needs Neon)*

| Item | Work |
|---|---|
| Confirm Neon's own PITR | Neon has branching and point-in-time restore on paid plans. **Check what the plan actually includes before building anything** — if PITR covers it, most of this phase is configuration, not code |
| Nightly per-tenant export | A JSON or SQL dump per tenant to object storage, kept ~30 days |
| Tenant-scoped restore | Restoring one shop must not touch another — the thing that makes a shared database frightening |
| An admin restore path | `/admin/tenants/{id}/restore`, behind `X-Admin-Secret`, because this is our lever when a shop calls in a panic |

Order matters: find out what Neon already gives you before writing a backup
system. Rebuilding a database's own PITR badly is a common and expensive mistake.

### Phase 4 — self-service recovery *(needs Neon)*

| Item | Work |
|---|---|
| "Download my data" in Settings | Pulls a full tenant export from the backend |
| Snapshot list with dates | So a shop can ask for *yesterday*, not just "a backup" |
| Undo for destructive actions | Soft-delete already exists for staff and suppliers; extend it to products so "restore deleted product" is a button rather than a restore |

## Decisions to make before building

- **How far back does a shop's data go?** Unlimited history makes the first pull
  on a new device slow and the export large. A retention policy (say, full
  detail for 12 months, summaries beyond) is a product decision with a real
  bearing on both.
- **Who may export?** A full export is every price, cost and customer the shop
  has. It should be `admin` only, and it should be noticeable that it happened.
- **Where do server-side backups live?** Object storage in the same region is
  simplest; a different provider protects against the case where Neon itself is
  the problem, which is the case worth protecting against.
- **Is a backup encrypted?** It contains hashed PINs and full financial history.
  If it leaves the shop's device, that question needs an answer.

## The standing rule

**A backup nobody has restored is not a backup.** Every phase above should end
with restoring onto a spare device and checking the numbers match — the sales
total, the stock count, the supplier balance. Testing the write path alone is
how organisations discover their backups were empty.
