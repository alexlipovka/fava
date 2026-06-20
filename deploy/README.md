# Fava Deployment

Multi-user Fava with Keycloak OIDC authentication and per-ledger RBAC.

## Architecture

```
Nginx Proxy Manager (existing, TLS)
  ├── auth.DOMAIN → keycloak:8080
  └── DOMAIN      → oauth2-proxy:4180 → fava:5000
```

oauth2-proxy validates OIDC tokens from Keycloak and injects
`X-Auth-Request-Email` and `X-Auth-Request-Groups` headers. Fava reads
these headers to enforce the `allowed_groups` option declared in each
`.beancount` file.

## Per-ledger access control

Add to your `.beancount` files:

```beancount
; Shared ledger — accessible to anyone in the 'family' group
2024-01-01 custom "fava-option" "allowed_groups" "family"

; Private ledger — only alice (by email or by her personal group)
2024-01-01 custom "fava-option" "allowed_groups" "alice alice@example.com"

; No option = open to all authenticated users
```

Group names are space-separated and matched case-insensitively against
the `groups` claim in the Keycloak OIDC token. Each user's email is also
checked as an implicit group identity.

## Local development

Runs a full Keycloak + oauth2-proxy + Fava stack locally over plain HTTP.
Test users and groups are pre-configured via `keycloak-seeds/fava-realm.json` —
no manual Keycloak UI setup required on first boot.

```bash
# One-time setup: create your local env file
cp .env.example .env.local

# Edit .env.local and fill in:
#   OAUTH2_COOKIE_SECRET=$(openssl rand -hex 16)   ← must be exactly 16, 24 or 32 bytes
#   BEANCOUNT_DIR=/path/to/your/beancount
#   BEANCOUNT_FILE=/beancount/example.beancount

docker compose --env-file .env.local -f docker-compose.local.yml up -d
```

- Fava:           http://host.docker.internal:4180
- Keycloak admin: http://host.docker.internal:8080/admin  (admin / admin)
- Test users:
  - `alice@example.com` / `alice123` — groups: `family`, `alice`
  - `bob@example.com` / `bob123` — groups: `family`, `bob`

> **Note:** `.env.local` is gitignored. Never commit secrets.
>
> Keycloak only imports the realm seed on first boot. To re-import after
> changes to `fava-realm.json`, remove the `keycloak_data_local` volume:
> `docker compose -f docker-compose.local.yml down -v && docker compose --env-file .env.local -f docker-compose.local.yml up -d`

## Production deployment

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set FAVA_DOMAIN, BEANCOUNT_DIR, BEANCOUNT_FILE, passwords
```

### 2. Update oauth2-proxy.cfg

Replace `${FAVA_DOMAIN}` with your actual domain in `oauth2-proxy.cfg`:

```bash
sed -i "s/\${FAVA_DOMAIN}/fava.example.com/g" oauth2-proxy.cfg
```

### 3. Update keycloak realm seed for production

Copy and edit `keycloak-seeds/fava-realm.json`:
- Set `redirectUris` to `https://YOUR_DOMAIN/oauth2/callback`
- Set `secret` to the value you put in `OAUTH2_CLIENT_SECRET`
  (generate with `openssl rand -hex 32`)
- Remove or change the test user credentials

### 4. Start services

```bash
docker compose up -d
```

### 5. Configure Nginx Proxy Manager

Add two proxy hosts in NPM:

| Domain | Forward Host | Forward Port | SSL |
|--------|-------------|--------------|-----|
| `fava.yourdomain.com` | `oauth2-proxy` | `4180` | Let's Encrypt + Force SSL |
| `auth.yourdomain.com` | `keycloak` | `8080` | Let's Encrypt + Force SSL |

### 6. Manage users in Keycloak

Go to `https://auth.yourdomain.com/admin` → realm `fava`:
- **Users**: create accounts, set email (must match `allowed_groups` entries)
- **Groups**: create groups matching the names used in your `.beancount` files
- **Users → Groups tab**: assign each user to their groups

Keycloak only imports the realm seed on first boot. After that, manage
users through the admin UI. Re-deploying with `docker compose up` is safe.
