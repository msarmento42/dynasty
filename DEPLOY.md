# Deploying Dynasty App to Railway

## What's already done

- `Dockerfile` — multi-stage build: Node 20 builds the React frontend, Python 3.11 serves it
- `railway.toml` — Dockerfile builder, health check wired to `/health`, `mkdir -p /data` in start command
- `backend/main.py` — `/health` endpoint + SERVE_STATIC logic (auto-serves React build in production)
- `backend/database.py` — reads `DB_PATH` env var so the SQLite file lives on a persistent Railway Volume

---

## Deploy in 5 steps

### 1. Create a Railway account

Go to [railway.app](https://railway.app) and sign in with GitHub.

### 2. New Project from GitHub

- Click **New Project** → **Deploy from GitHub repo**
- Select **msarmento42/dynasty**
- Railway detects the Dockerfile automatically and starts building

### 3. Add a Volume for SQLite persistence

Railway's filesystem is ephemeral — every redeploy wipes it. A Volume survives.

In your Railway project:
- Click **+ New** → **Volume**
- Set **Mount Path** to `/data`

Without this step the database resets on every deploy.

### 4. Set environment variables

In the Railway project dashboard → **Variables** tab, add:

| Variable | Value |
|----------|-------|
| `DB_PATH` | `/data/dynasty.db` |
| `SERVE_STATIC` | `true` |

Railway sets `PORT` automatically — do not override it.

Optional: if you ever run the API from a separate frontend dev server, add:
| `ALLOWED_ORIGINS` | `http://localhost:5173` |

### 5. Generate a public domain

- **Settings** → **Networking** → **Generate Domain**
- Your app goes live at something like `https://dynasty-production-xxxx.up.railway.app`

---

## Initial data sync

After deploy, visit your Railway URL + `/fantasy/sync` to pull your Sleeper leagues, rosters, and players into the DB:

```
https://your-railway-url.up.railway.app/fantasy/sync
```

---

## Redeploys

Railway auto-deploys on every push to `main`. No manual action needed.

---

## Local development

```bash
# Backend (from repo root)
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

The frontend dev server proxies `/fantasy`, `/api`, and `/health` to `localhost:8000` via Vite config.

---

## Health check

Railway pings `GET /health` to verify the container is up. It returns:

```json
{"status": "ok"}
```

---

## Free tier limits (as of 2025)

- 500 hours/month execution time on Hobby plan ($5/mo removes the limit)
- Volume storage: 1 GB included
- Build minutes: 500/month

The dynasty app is well within free tier for personal use.
