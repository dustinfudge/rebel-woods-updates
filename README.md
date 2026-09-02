# Rebel Woods Horse Care

A private, mobile-first Progressive Web App for horse care information and continuous horse-specific conversations.

## Product rules

- Owners and authorized family members have equal access to their assigned horses.
- Rebel Wranglers can see every horse and communicate with owners and family members.
- Only administrators can manage horses, users, feed, supplements, medications, fields, herds, and special requirements.
- Each horse has one continuous conversation supporting text, up to 10 photos, and three 60-second videos per message.
- Every participant can see named read receipts. Staff dashboards show days since the last administrator or Rebel Wrangler message.
- Conversation messages are immutable. Administrators may hide a message while its audit record remains intact.
- Only administrators can change a horse’s field and herd.
- Medication history remains available after a medication is completed or discontinued.

## Architecture

```text
app/                         Static Next.js App Router pages
components/                  Realtime conversation, care, setup, push, and PWA components
lib/                         Typed Supabase client and domain rules
pwa/                         Strict TypeScript service worker source
public/                      PWA icons and generated service worker
supabase/migrations/         PostgreSQL schema, indexes, triggers, RLS, and storage policies
types/supabase.ts            Supabase database TypeScript types
.github/workflows/ci.yml     Pull-request quality gate
.github/workflows/deploy.yml GitHub Pages deployment
```

The browser receives only the Supabase project URL and publishable key. Database RLS policies remain the security boundary. Service-role keys and VAPID private keys must never be placed in GitHub Pages or variables prefixed with `NEXT_PUBLIC_`.

## Local commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` creates the GitHub Pages-ready static site in `out/` and compiles `pwa/service-worker.ts` into the browser service worker.

## Supabase connection

1. Create a Supabase project.
2. Run every file in `supabase/migrations/` in filename order through the Supabase SQL editor or CLI.
3. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
4. Configure the Supabase Auth site URL and allowed redirect URL to match the final GitHub Pages address, including `/auth/callback/`.
5. Regenerate `types/supabase.ts` after every schema migration:

```bash
pnpm dlx supabase gen types typescript --project-id YOUR_PROJECT_REF --schema public > types/supabase.ts
```

## GitHub Pages connection

Add these repository Actions secrets before deploying:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

In the repository Pages settings, select **GitHub Actions** as the publishing source. Pull requests run linting, strict TypeScript checks, automated tests, and the production build. Pushes to `main` repeat verification and publish `out/`.

## Push delivery

The app stores each opted-in device in `push_subscriptions`. Database triggers create notification records for conversation messages, care changes, and medication changes. A Supabase Edge Function and database webhook must send those records using the private VAPID key; that private delivery step is configured when the Supabase project is connected.

Conversation retention is configured per organization. The cleanup function removes expired conversation messages and their storage objects while preserving care information, medication history, access, and last-staff-contact dates. Do not schedule the function until its deployment and a dry-run review are complete.
