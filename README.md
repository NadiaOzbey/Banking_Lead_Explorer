# Lead Explorer

A demo for importing fictional company records and granting clients access to selected records.

## Run locally on Windows

From PowerShell 7 with Docker Desktop running:

```powershell
if (!(Test-Path -LiteralPath .env)) {
    'POSTGRES_PASSWORD=' + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)) |
        Set-Content -LiteralPath .env
}
docker compose up --build --wait -d
docker compose cp web:/data/caddy/pki/authorities/local/root.crt ./.env.local-ca.pem
curl.exe --fail --ssl-no-revoke --cacert .env.local-ca.pem https://localhost:8443/api/health
```

Open https://localhost:8443. If your browser shows a certificate warning, trust the certificate copied from your own running Caddy container with `certutil.exe -user -addstore Root .\.env.local-ca.pem`, then reload.

Create a demo admin:

```powershell
$env:ADMIN_EMAIL = Read-Host 'Administrator email'
$env:ADMIN_PASSWORD = Read-Host 'Administrator password' -MaskInput
try {
    docker compose exec -T --env ADMIN_EMAIL --env ADMIN_PASSWORD api node dist/api/admin.js
} finally {
    Remove-Item Env:ADMIN_EMAIL,Env:ADMIN_PASSWORD
}
```

Upload `fixtures/synthetic-profiles.csv` as admin. Create an access code for a client email and profile `SYNTH-001`. Register with that email, sign in as the client, and redeem the code. The client can search and open the assigned lead. All other lead records contribute only to an aggregate count.

## Architecture and security

Caddy serves the React frontend over HTTPS and forwards API requests to Express. The API uses Sequelize with PostgreSQL. Versioned migrations run at startup. Passwords use bcrypt. Session cookies use HttpOnly, Secure, and SameSite. Mutation requests require the configured origin and a CSRF header. Profile queries enforce client assignments on the server. Uploads are validated before a transactional import and formula-like cells are escaped.

The importer requires UTF-8 CSV with the columns `id,name,region,sector,signal`. The fixture contains fictional records for local testing.

## Checks

With Node.js 24, run `npm ci`, `npm run lint`, and `npm test`. The CI workflow also runs integration tests against PostgreSQL, reports coverage, audits dependencies, scans for secrets, and builds both Docker images.

The `loadtest/` directory contains a seed script and a k6 scenario for a local demo environment. See the source scripts for configuration.

CI audits production dependencies separately and logs the full dependency audit. It temporarily accepts [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) only in the full audit while the production audit passes. Remove this exception once an upstream fix is available.

## Staging and production on Render

Deployment jobs are opt-in. Create GitHub environments named `staging` and `production` and restrict both to the `main` branch. Configure required reviewers for production and enable **Prevent self-review**. Disable administrator bypass if available.

Create two dedicated Render Node web services linked to this repository and two separate PostgreSQL databases. Set both services to use branch `main` with Auto-Deploy off.

| Render setting | Value |
| --- | --- |
| Build command | `bash deploy/build.sh` |
| Start command | `bash deploy/start.sh` |
| Health check | `/api/health` |
| `APP_ORIGIN` | HTTPS origin of this service, without a trailing slash |
| `DATABASE_URL` | Connection string for this service's database |
| `NODE_VERSION` | `24` |
| `SKIP_INSTALL_DEPS` | `true` |

To create a demo administrator, optionally set both `ADMIN_EMAIL` and `ADMIN_PASSWORD` directly on the service for its first successful boot. Remove both settings after confirming login. Use synthetic data only.

In each GitHub environment, set the variable `RENDER_SERVICE_ID` to its own `srv-...` ID and the secret `RENDER_API_KEY` to a key authorized to deploy that service. Use a service-scoped key where available. Set repository variables `STAGING_URL` and `PRODUCTION_URL` to the corresponding public HTTPS origins. The database connection strings stay in the respective Render services' environment settings.

Set the repository variable `ENABLE_STAGING` to `true` after configuring staging. A push or merge to `main` then runs verification, deploys that commit, and checks its SHA at `/api/health`. Set `ENABLE_PRODUCTION` to `true` after configuring production and its reviewer rule. Manually run **Lead Explorer CI** from `main`. The workflow checks staging before requesting approval and again after approval, then deploys and smoke-tests the production commit.

Render starts an initial deployment when you create a web service. Leave production APP_ORIGIN unset during creation so the application cannot start. With Auto-Deploy off, add the production environment settings using **Save only**. Then use the approved workflow for the first successful application deployment.
