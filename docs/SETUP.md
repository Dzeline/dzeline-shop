# Setup & Deployment

Running Dzeline Shop locally, configuring it, and shipping it.

## Local development

### Frontend

```bash
cd frontend
npm install
npm run dev              # → http://localhost:5173
```

On first run the setup wizard creates the shop and an admin. In development the admin PIN
is `1234`.

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm run lint` | ESLint over `src/` |
| `npm run verify:responsive` | Playwright layout + POS-flow checks at 4 viewports (needs `npm run dev` running) |
| `npm run generate-icons` | Regenerate PWA icons from the source SVG |

The frontend runs entirely without the backend — it is offline-first, so an unreachable API
only means sync retries later. **You do not need Render or Neon up to work on the UI.**

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env     # fill in values — see below
python run.py            # → http://localhost:8000
```

Interactive API docs: `http://localhost:8000/docs`.

### Testing on a phone

```bash
cd frontend
npm run dev -- --host
# open http://YOUR_LOCAL_IP:5173 on a phone on the same Wi-Fi
```

Camera barcode scanning needs a secure context — it works on `localhost`, but over a LAN IP
most browsers require HTTPS. Use a tunnel (ngrok, Cloudflare Tunnel) to exercise the
scanner properly on a real device.

### Testing offline behaviour

1. `npm run dev`
2. DevTools → Network → Offline
3. Reload — the app still works, and the amber offline banner appears
4. Go back online — sync catches up on the reconnect edge

## Environment variables

### Backend (`backend/.env`)

| Variable | Example | Required |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host/db` | yes |
| `ADMIN_SECRET` | 64-char random hex | yes |
| `ALLOWED_ORIGINS` | `https://dzeline.online` | yes |
| `MPESA_ENV` | `sandbox` or `production` | yes |
| `MPESA_CONSUMER_KEY` | from the Daraja portal | for M-Pesa |
| `MPESA_CONSUMER_SECRET` | from the Daraja portal | for M-Pesa |
| `MPESA_SHORTCODE` | `174379` (sandbox) | for M-Pesa |
| `MPESA_PASSKEY` | from the Daraja portal | for M-Pesa |
| `MPESA_SHORTCODE_TYPE` | `paybill` or `till` | for M-Pesa |
| `MPESA_CALLBACK_URL` | `https://dzeline-api.onrender.com/mpesa/callback` | for M-Pesa |
| `SMS_WEBHOOK_SECRET` | 32-char random hex | optional second factor on the SMS webhook |
| `ETIMS_ENV` | `sandbox` or `production` | for eTIMS |
| `ETIMS_TIN` · `ETIMS_BHF_ID` · `ETIMS_DEVICE_SERIAL` | from KRA | for eTIMS |
| `ANTHROPIC_API_KEY` | from console.anthropic.com | for invoice scanning |
| `PADDLE_HOME` | `/opt/paddle_models` | for invoice scanning |

Generate a secret:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Frontend (`frontend/.env.local`)

| Variable | Example |
|---|---|
| `VITE_API_URL` | `https://dzeline-api.onrender.com` |

Anything prefixed `VITE_` is compiled into the client bundle and is **public**. Never put a
secret behind that prefix.

## Deployment

| Layer | Platform | Config |
|---|---|---|
| Frontend | Vercel | `frontend/vercel.json`; auto-deploys on push to `main` |
| Backend | Render | `render.yaml` at the repo root; `rootDir: backend` |
| Database | Neon (PostgreSQL) | `DATABASE_URL`, set manually in the Render dashboard |

`render.yaml` also mounts a 2GB disk at `/opt/paddle_models` for the OCR models used by
invoice scanning, and declares every secret as `sync: false` so values are entered in the
dashboard rather than committed.

### A gitignore trap worth remembering

The Android TWA build uses `/app/` — **root-anchored**, so it matches only `./app/` and
never `backend/app/`. An earlier bare `app/` rule silently excluded every new file under
`backend/app/` from Render's deploy artifact, which fails in a thoroughly confusing way:
the deploy succeeds and the code is simply missing. Do not "tidy" that leading slash.

### Tenant provisioning

A shop needs a tenant record before its tills can sync:

```bash
curl -X POST https://dzeline-api.onrender.com/admin/tenants \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name": "Shop Name"}'
```

The response contains the raw API key **once** — it is stored hashed and cannot be read
back. Lost keys are rotated, not recovered.

## Android APK

The PWA is wrapped as an Android APK with Google's bubblewrap — a TWA shell around the
hosted site, so there is no second codebase and no separate release to keep in step.

```bash
npm run build-apk        # from the repo root
```

The script handles icons, keystore signing, `assetlinks.json` and the bubblewrap build.
Distribute the signed APK directly (WhatsApp, download link); no Play Store listing needed.

The TWA manifest (`twa-manifest.json`) stays `orientation: portrait` — that build is the
phone distribution. The web manifest in `vite.config.js` is `any`, because an installed
desktop till window is landscape.

## Thermal printers

Two paths, both from `services/thermalPrinter.js`:

- **Web Bluetooth (ESC/POS)** — pairs BLE printers directly. Profiles for Rongta, Sewoo and
  Microchip are tried in order; the chosen device name is remembered in `localStorage`.
  Chrome/Edge on Android and desktop only — Safari has no Web Bluetooth.
- **Browser print** — a 58mm monospace HTML receipt through `window.print()`, for USB and
  OS-paired printers. Always available.

For a shop with one printer and several tills, the **print-job queue** is the third option:
tills enqueue jobs to the backend and the device marked as the hub in Settings prints them.
