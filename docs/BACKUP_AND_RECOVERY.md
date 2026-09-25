# Backup and recovery

How a shop gets its data back. Written 2026-09-26, before Neon is restored, so
the phasing assumes the backend comes back first.

**Status:** phases 1 and 2 are built and verified (`npm run verify:recovery`,
`npm run verify:backup`). Phases 3 and 4 need Neon.

## Where a shop's data actually lives

Two copies, and neither is a backup:

| | What it holds | What it survives |
|---|---|---|
| **The device** (IndexedDB) | everything, and it is the working copy | nothing — clearing site data destroys it |
| **The cloud** (Neon) | what has synced | a lost device, but not its own deletion |

Sync makes the two agree. It does not make either one recoverable, because both
converge on the *current* state: a product deleted by mistake is deleted
everywhere within 45 seconds, and there is nothing to go back to.

## What was broken, and what still is

Verified against the code, not assumed.

**Fixed — a replacement device now gets the shop's history.** `JoinShop` pulled
products, staff and settings and stopped. It now runs
`syncService.recoverEverything()`, which pulls sales, deliveries, suppliers and
payments as well, in dependency order, and reports the row counts it wrote.

**Fixed — history older than 35 days now arrives.** `pullTransactions` defaulted
to 35 days back when it had no watermark, then wrote a watermark and went
incremental, so the floor was permanent and there was no second chance to ask
for the rest. It now pulls from the beginning and pages.

**Still broken — several tables do not sync at all.** Purchase orders, shifts,
cash movements, void reasons. These exist only on the device that created them,
and each needs a backend table and endpoint, so they wait on Neon. Until then
the export file below is the only thing carrying them off the device.

**A bug found while fixing the above, worth recording.** Supplier payments never
found their invoice across devices: a payment travels with *cloud* receipt and
supplier ids, everything local joins on *local* ids, and both the push and the
pull stored them as they arrived. So the owner paid from their phone, the payment
landed on the staff's till attached to nothing, and the till went on showing the
full amount owed. Pulled deliveries had the same defect for their supplier. Both
directions now translate, and a payment whose invoice has no cloud id yet waits
rather than being orphaned on the server. **Any payment pushed before this fix
carries local ids on the server** and will need repairing or discarding once Neon
is back.

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

### Phase 1 — make sync actually recover a device *(done, bar the unsynced tables)*

The cheapest protection was the machinery already built. It did not finish the
job.

| Item | Status |
|---|---|
| A joining device pulls **everything** | **Done.** `recoverEverything()` pulls in order, with progress. Ordered, not parallel: line items resolve their product by cloud id, a delivery its supplier, a payment its delivery — pulled in the wrong order the rows arrive orphaned, and nothing later goes back to fix them |
| Drop the 35-day floor for a first pull | **Done.** No watermark now means from the beginning, paged 300 at a time |
| Joining a different shop leaves nothing behind | **Done** — not originally listed, found while doing the above. The wipe named nine tables by hand, so purchase orders, supplier payments, shifts and cash movements survived it, and a till moved between shops showed the first shop's payments. The list is now shared with restore so it cannot drift again |
| Show what is not backed up | **Done.** A red banner once the cloud has not been reached for a day, and the same fact in Settings. The offline banner says sales are saved locally and sync on reconnect, which says nothing about whether that ever happened |
| Sync the tables that do not | **Blocked on Neon** — purchase orders, shifts and cash movements each need a table and an endpoint |

Recovery takes the sync guard rather than skipping on it. A background tick
running alongside a recovery is exactly how the same cloud row gets inserted
twice, and the guard's own comment says so.

Verified by `npm run verify:recovery`, which intercepts the API with payloads
shaped like the real FastAPI response models: 420 sales over 400 days recovered
whole across two pages with the totals matching to the shilling, every line item
resolved, the owner's payments landing on the right invoice, a second run adding
nothing, and the push sending cloud ids rather than local ones.

### Phase 2 — an export the shop owns *(done)*

A file the shop can keep, mail to themselves, or hand to an accountant.
`services/backup.js`, offered in Settings. It answers "can my client get their
data out" with no dependency on us, and it works offline.

| Item | Status |
|---|---|
| **Full backup file** | **Done.** One JSON file of 15 tables, carrying its schema version, row counts and export date, so a restore can refuse a file it cannot honour instead of half-importing it. `print_jobs` is excluded: it is a transient outbox, and restoring one would reprint old receipts |
| **Restore from file** | **Done.** Replace, not merge — merging two divergent copies of a shop's history needs conflict rules nobody can state, and quietly producing a third version that matches neither is worse than being told to start clean. The confirmation shows the shop name and the row counts rather than asking "are you sure?" about a filename, and requires typing RESTORE |
| Photos are optional | **Done.** "Download backup" and "Without photos" |
| Verify on write | **Done.** The counts are re-read from the database after the file is built and compared against what went into it |

Two details worth keeping in mind. A restore **preserves this device's own
`device_id`** — adopting the backup's would make the till indistinguishable from
the one that made the file, and sync uses that id to tell its own rows from
another's. And it clears the pull watermarks, so the restored copy reconciles
with the cloud afterwards rather than silently diverging.

Verified by `npm run verify:backup`, which does the whole round trip: seed a
shop, export, wipe the database, restore, and check the sales total, the stock
count, what the supplier is owed and the shift's expected cash. Writing it found
a real bug — the filename used `toISOString()`, so a backup taken before 3am in
Nairobi was stamped with yesterday's date, which is exactly the detail that makes
somebody restore the wrong file.

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
