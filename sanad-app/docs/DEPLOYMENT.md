# Deploying SANAD

This is the checklist for running SANAD with real people's information. The public GitHub Pages site is a
**browser demo** with synthetic data only. It must never be used for real people.

## 1. What runs where

| Part | What it is |
|---|---|
| Server (`server/`) | Node.js 22 + Express. Serves the API and the built web app from one process on `PORT`. |
| Data | One JSON file (`SANAD_DATA`, default `data/sanad.json`), replaced in one step on every change, plus uploaded files in a `files/` folder next to it. |
| Web app (`dist/`) | Built with `npm run build`; served by the same server. |
| Optional AI model | Only when `ANTHROPIC_API_KEY` is set; used server-side for the assistant's written overview. |

## 2. Settings (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV=production` | yes | Turns off demo mode and turns on HSTS by default. |
| `SANAD_DEMO=0` | yes (implied by production) | No demo accounts list, no workspace reset, no demo hints. |
| `SANAD_ORG_NAME`, `SANAD_ADMIN_NAME`, `SANAD_ADMIN_EMAIL`, `SANAD_ADMIN_PASSWORD` | first start only | Creates an empty workspace with one care coordinator. Password at least 12 characters. Remove the password from the environment after the first start. |
| `SANAD_DATA` | yes | Path to the data file on persistent, backed-up storage (in Docker: `/data/sanad.json`). |
| `PORT` | no | Default 4000. |
| `SANAD_SESSION_HOURS` | no | Sign-in length, default 12. |
| `SANAD_LOGIN_ATTEMPTS`, `SANAD_LOGIN_WINDOW_MINUTES` | no | Failed sign-ins before a pause (default 5 per 15 minutes per email; 4× that per address). |
| `SANAD_TRUST_PROXY=1` | behind a proxy | Use the proxy's client address for sign-in limits. |
| `SANAD_HSTS` | no | Defaults on in production; only behind HTTPS. |
| `ANTHROPIC_API_KEY`, `SANAD_MODEL`, `SANAD_MODEL_TIMEOUT_MS` | optional | AI overview for the assistant. Without it the assistant is rule-based and says so. |

SANAD refuses to start outside demo mode if the data file still contains accounts with the demo password, or if a
new workspace has no first coordinator.

## 3. Start

With Docker (image tested in this build):

```
docker build -t sanad .
docker run -d --name sanad -p 4000:4000 -v sanad-data:/data \
  -e SANAD_ORG_NAME="Your organisation" -e SANAD_ADMIN_NAME="First Coordinator" \
  -e SANAD_ADMIN_EMAIL=coordinator@example.org -e SANAD_ADMIN_PASSWORD='a long passphrase' \
  -e SANAD_TRUST_PROXY=1 sanad
```

Without Docker: `npm ci && npm run build`, set the variables above, then `npm start`.

## 4. Before real use — checklist

- [ ] HTTPS in front of SANAD (reverse proxy such as nginx, Caddy or a cloud load balancer), HTTP redirected to HTTPS.
- [ ] `NODE_ENV=production`, a new data file, first coordinator created, and the admin password removed from the environment.
- [ ] Data file and `files/` folder on encrypted, persistent storage; `npm run backup` (or volume snapshots) scheduled and a restore tested.
- [ ] Health checks wired: `GET /api/health` (process up) and `GET /api/ready` (data can be saved, background checks running).
- [ ] Logs collected: one JSON line per API request (route, status, time; no bodies, ids, tokens or query strings), sign-in failures, browser errors.
- [ ] Someone watches **Settings → System status** (coordinators and admins) or the logs for server errors and sign-in pauses.
- [ ] Organisation admins and coordinators created and verified; guardian authority verified with real evidence.
- [ ] Data protection review for your country (in the UAE, for example, health data rules and consent records) and a retention policy for audit logs and uploaded files.
- [ ] If the AI model is enabled: a data-processing agreement with the provider, and only the overview feature uses it.
- [ ] Email/SMS delivery: **not built**. Notifications are in-app only until a provider is connected.

## 5. Known limits of this deployment model

- One server process with a JSON data file: suitable for a pilot (hundreds of people), not for large scale or several
  servers. Moving to a database (for example PostgreSQL) is the next step for scale.
- Uploaded files are checked by type and size but **not virus-scanned**; connect a scanner before accepting files from the public.
- No single sign-on, no two-factor sign-in yet.
- Sessions are bearer tokens kept in the browser tab (sessionStorage); live updates pass the token in the event-stream address, so the proxy must not log full URLs for `/api/events`.
