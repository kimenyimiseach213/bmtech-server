# BMTECH API

NestJS 11 API for the BMTECH Next.js storefront and administrator dashboard. PostgreSQL is the data store and Prisma owns the schema.

## Run locally on Windows

Use Node.js 20.11.1 or later (or Node.js 22 or later), npm, and Docker Desktop.

1. In PowerShell, open this folder and create a private environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `backend/.env`. Replace `JWT_SECRET` with a random value of at least 32 characters and `ADMIN_BOOTSTRAP_TOKEN` with a different random one-time value. Do not commit `.env` or share the bootstrap token.

   Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` to credentials from your email provider. Set `BMTECH_NOTIFICATION_EMAIL` as the fallback recipient, or enter the CEO/company inbox under **Company settings → Public email and enquiry inbox**. An address saved in Company settings takes priority and can be changed later. New contact messages, quotation requests, and technician bookings will be saved in the dashboard and emailed to that inbox. Reviews are not emailed. SMTP credentials stay in this backend environment file; do not put them in the frontend `.env.local`.

For Neon, keep the pooled connection string in `DATABASE_URL` and set `DIRECT_URL` to the matching direct connection string for the same database and branch. The backend uses Prisma's Neon driver adapter for runtime queries and Prisma's direct URL for database migrations. Keep `sslmode=require` and any other parameters copied from Neon. The local Docker example uses the same URL for both variables.

3. Start the local PostgreSQL database:

   ```powershell
   docker compose up -d
   ```

4. Install the API packages, generate Prisma Client, and create the initial database migration:

   ```powershell
   npm install
   npm run prisma:generate
   npm run prisma:migrate -- --name init
   ```

5. Start the API in development mode:

   ```powershell
   npm run dev
   ```

   The API listens at `http://localhost:3001/api/v1`; interactive API docs are at `http://localhost:3001/docs`.

6. In another PowerShell window, create the first administrator once. Use your own email, display name, and password (at least 12 characters); there is no default admin account or password:

   ```powershell
   $setupToken = 'the-one-time-value-from-backend/.env'
   $headers = @{ 'x-admin-bootstrap-token' = $setupToken }
   $body = @{ email = 'your-admin-email@example.com'; name = 'BMTECH Admin'; password = 'choose-a-unique-password-of-12-or-more-characters' } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri 'http://localhost:3001/api/v1/admin/auth/bootstrap' -Headers $headers -ContentType 'application/json' -Body $body
   Remove-Variable setupToken, headers, body
   ```

7. Remove `ADMIN_BOOTSTRAP_TOKEN` from `backend/.env` and restart the API. The bootstrap endpoint also refuses to create another administrator after the first account exists.

8. Set the frontend's server-only API origin in `frontend/.env.local`:

   ```dotenv
   BMTECH_API_BASE_URL=http://localhost:3001
   ```

   Start the frontend from the project root with `Set-Location frontend; npm run dev`. To start both apps together, use `Set-Location frontend; npm run dev:all`. Visit `/en/admin/login` and use the account you created in step 6.

After signing in, create active categories before creating products, then add product photos from the product editor. A fresh database starts empty; it does not seed sample products or customer records.

## API behavior

- Admin endpoints require a valid bearer token backed by an active database session. The Next.js same-origin API proxy stores the login token in an HttpOnly cookie and forwards it to NestJS; logout revokes the token's session and clears that cookie.
- Public checkout accepts product slugs and quantities. The API recalculates prices from PostgreSQL, snapshots each order line, checks/decrements stock transactionally, creates an unverified payment record, and returns the saved order reference and WhatsApp URL.
- Product uploads accept JPEG, PNG, WebP, or GIF files up to `MAX_UPLOAD_BYTES`. Local uploads use `UPLOAD_DIRECTORY`; Vercel uploads use persistent public Blob storage configured by `BLOB_READ_WRITE_TOKEN`.
- Payment verification updates both payment and order status in one transaction and writes an administrator audit log.
- Customer quotations, bookings, messages, and reviews are stored with pending moderation/review states. Reviews are not automatically approved.

## Production setup

Use a managed PostgreSQL database and strong unique secrets from the deployment secret store. Set `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `PUBLIC_API_ORIGIN`, and `FRONTEND_ORIGIN` for the target environment. Run `npm run prisma:deploy` once for schema migrations and `npm run build` before starting the compiled server. Keep `ADMIN_BOOTSTRAP_TOKEN` only for the one-time initial setup, then remove it. For Vercel, configure `BLOB_READ_WRITE_TOKEN`; see `../frontend/docs/vercel-deployment.md`.

## Current scope

This backend implements the routes in `docs/api-contract.md`. Deployment instructions for both apps are in `../frontend/docs/vercel-deployment.md`. It is a single-admin application: authorized onboarding is limited to the one-time bootstrap token endpoint; there is no public signup route, forgot-password flow, payment gateway, or multi-admin role system. The local Docker database credentials are for development only.
