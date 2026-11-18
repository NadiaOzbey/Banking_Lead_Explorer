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
