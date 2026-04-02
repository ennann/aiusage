# AIUsage Server Deployment Skill

You are deploying the AIUsage server stack (Cloudflare Worker + D1 Database + Dashboard) for the user.

## Prerequisites

Before starting, verify:
1. **Node.js >= 18** — run `node --version`
2. **pnpm** — run `pnpm --version`; if missing: `npm i -g pnpm`
3. **Cloudflare account** — the user must have one (free tier is enough)
4. **Wrangler CLI** — comes with `pnpm install`; the user must run `npx wrangler login` interactively (you cannot do this for them)

## Option A: One-Click Setup (Recommended)

If the user has already cloned the repo:

```bash
cd <repo-root>
pnpm install
pnpm setup
```

`pnpm setup` is an interactive wizard that handles everything: D1 creation, secret generation, migration, build, and deploy. It prints the dashboard URL, SITE_ID, and ENROLL_TOKEN at the end.

**You cannot run `pnpm setup` directly** because it requires interactive input. Instead, tell the user to run it and provide you with the output values (SITE_ID and ENROLL_TOKEN).

## Option B: Automated Step-by-Step

If you need to script the deployment or the user prefers manual control:

### Step 1: Clone and install

```bash
git clone https://github.com/ennann/aiusage.git
cd aiusage
pnpm install
```

### Step 2: Verify Cloudflare login

Ask the user to run `npx wrangler login` if they haven't already. Verify with:

```bash
npx wrangler whoami
```

This must show an account name. If it fails, the user needs to log in first.

### Step 3: Create D1 database

```bash
npx wrangler d1 create aiusage-db
```

Capture the `database_id` (UUID) from the output.

### Step 4: Generate wrangler.jsonc

Write `packages/worker/wrangler.jsonc` using the template at `packages/worker/wrangler.jsonc.example`. Replace:
- `"your-worker-name"` → a name the user chooses (default: `aiusage`)
- `"your-d1-database-name"` → `aiusage-db`
- `"your-d1-database-id"` → the UUID from Step 3

### Step 5: Generate secrets

Generate 4 cryptographic secrets:

```bash
# SITE_ID: a stable identifier for this deployment
SITE_ID="site_$(openssl rand -hex 8)"

# ENROLL_TOKEN: shared secret for device registration
ENROLL_TOKEN="$(openssl rand -hex 16)"

# DEVICE_TOKEN_SECRET: HMAC key for signing device tokens
DEVICE_TOKEN_SECRET="$(openssl rand -hex 32)"

# PROJECT_NAME_SALT: HMAC key for project name masking
PROJECT_NAME_SALT="$(openssl rand -hex 16)"
```

### Step 6: Set secrets on Worker

Each secret must be piped to wrangler (run from `packages/worker/`):

```bash
cd packages/worker
echo -n "$SITE_ID" | npx wrangler secret put SITE_ID
echo -n "$ENROLL_TOKEN" | npx wrangler secret put ENROLL_TOKEN
echo -n "$DEVICE_TOKEN_SECRET" | npx wrangler secret put DEVICE_TOKEN_SECRET
echo -n "$PROJECT_NAME_SALT" | npx wrangler secret put PROJECT_NAME_SALT
```

### Step 7: Run D1 migration

```bash
npx wrangler d1 migrations apply aiusage-db --remote
```

### Step 8: Build

```bash
cd <repo-root>
pnpm build
```

### Step 9: Deploy

```bash
cd packages/worker
npx wrangler deploy
```

Capture the Worker URL from the output (e.g., `https://aiusage.<subdomain>.workers.dev`).

### Step 10: Verify

```bash
curl -s https://<worker-url>/api/v1/health | head
```

Should return `{"ok":true,"siteId":"site_...","service":"aiusage",...}`.

## Output

After deployment, give the user these values — they'll need them to connect devices:

| Value | Example | Purpose |
|-------|---------|---------|
| **Dashboard URL** | `https://aiusage.xxx.workers.dev` | Public dashboard |
| **SITE_ID** | `site_a1b2c3d4e5f6` | Deployment identifier |
| **ENROLL_TOKEN** | `a1b2c3d4...` | Device registration secret |

Then guide the user to set up the controller on each device (see `skills/setup-controller.md`).

## Troubleshooting

- **"Not logged in"** → User must run `npx wrangler login` interactively
- **"Database already exists"** → Reuse existing: `npx wrangler d1 list` to find the ID
- **"Nothing to migrate"** → Database schema already applied, safe to continue
- **Build fails** → Run `pnpm install` first; check Node.js >= 18
