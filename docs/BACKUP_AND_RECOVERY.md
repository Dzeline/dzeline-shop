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

### Phase 3 — use what Neon already gives us *(needs Neon)*

Checked against Neon's docs and the account's own plan page rather than assumed:

| | Free | **Launch (our plan)** | Scale |
|---|---|---|---|
| Instant restore window | 6 hours | **up to 7 days** | up to 30 days |
| Object storage | 5 GB included | $0.023/GB-month | $0.023/GB-month |

Three things follow, and they change what is worth building.

**Most of "restore a deleted thing" is already paid for.** Neon's instant
restore works by **branching** — it creates a new branch at a past timestamp
rather than rolling the live database back. For a multi-tenant database that is
exactly the right shape: to fix one shop you branch at the moment before the
mistake, read that shop's rows out of the branch, and put them back, without a
big-bang restore that touches every other tenant. That is a runbook, not a
feature to build.

**The window is configurable and is not free.** It is set in the Neon console
under Settings → Instant restore, and history storage is billed at $0.20/GB-month,
so a longer window costs more. **Check what ours is actually set to** — the
plan allows *up to* 7 days, which is not the same as having 7. Decide it
deliberately; 7 days is the ceiling on Launch either way.

**Seven days does not cover the failure we actually had.** Instant restore, the
branches, and Neon's object storage all live inside the same Neon account — the
account that was suspended a fortnight ago for non-payment. A suspension, a
closed account, or a billing dispute takes out the database and every backup of
it at the same moment, and it is the one outage this project has actually
experienced. **At least one copy has to live outside the Neon account.**

So:

| Item | Work |
|---|---|
| Set the history window deliberately | Console → Settings → Instant restore. Decide the number against the $0.20/GB-month it costs, and write it down |
| A branch-and-extract runbook | The steps to recover one tenant from a branch without touching the others. Rehearsed once, written down, not invented during an incident |
| Nightly per-tenant export | JSON per tenant. Neon object storage is S3-compatible and cheap, so it is the obvious first destination |
| **A second destination outside Neon** | The point of the exercise. Anywhere not billed by the same account — another provider's bucket, or the owner's own Google Drive |
| An admin restore path | `/admin/tenants/{id}/restore`, behind `X-Admin-Secret`, for when a shop calls in a panic |

What is explicitly **not** worth building: our own point-in-time recovery.
Neon's is better than anything we would write, and within its window it is the
right tool. The gap to fill is beyond that window and outside that account.

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
- ~~Where do server-side backups live?~~ **Answered.** Neon's own object storage
  for the routine copy, and a second destination outside the Neon account for
  the copy that has to survive the account itself. The suspension in September
  2026 is the argument.
- **Is a backup encrypted?** It contains hashed PINs and full financial history.
  If it leaves the shop's device, that question needs an answer.

## The standing rule

**A backup nobody has restored is not a backup.** Every phase above should end
with restoring onto a spare device and checking the numbers match — the sales
total, the stock count, the supplier balance. Testing the write path alone is
how organisations discover their backups were empty.
