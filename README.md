# Fleet Manager

Next.js fleet management dashboard for reducing downtime, tracking 5000 km service intervals, COIDA & Roadworthy certificate reminders (20 days), bulk fuel impact analysis, document scanning via OpenRouter vision LLM, risk ranking, and AI recommendations.

## Features

- Service proximity indicator (km remaining + last service date/odometer)
- COIDA & Roadworthy expiry tracking with 20-day advance alerts
- Downtime view + suggested vehicle/driver shuffle candidates
- Bulk fuel reserve impact rating per vehicle
- Document scanner (phone photo → one OpenRouter vision call → extract type/plate/ID/holder/dates → match vehicle)
- Risk ranking (service + certificates + income exposure)
- AI Analytics section (OpenRouter) with actionable recommendations

## Tech Stack

- **Frontend**: Next.js 15 (App Router) + React + TypeScript + Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenRouter (vision model for documents + text model for analytics)
- **Hosting**: Vercel
- **Repo**: GitHub

## Deploy to Vercel (recommended)

### Option A – GitHub + Vercel (easiest)

1. Create a new GitHub repository and push this project:
   ```bash
   git init
   git add .
   git commit -m "Fleet Manager initial"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/fleet-manager.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import the GitHub repo.

3. In the Vercel project settings → **Environment Variables**, add:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service role key (optional but recommended) |
   | `OPENROUTER_API_KEY` | your OpenRouter API key (`sk-or-v1-...`) |
   | `NEXT_PUBLIC_SITE_URL` | `https://your-project.vercel.app` (after first deploy) |

4. Click **Deploy**. Vercel will automatically build and host the app.

5. After deploy, update `NEXT_PUBLIC_SITE_URL` if needed and redeploy.

### Option B – Vercel CLI

```bash
npm i -g vercel
vercel login
vercel          # follow prompts, link to existing or create new project
vercel --prod   # production deploy
```

Remember to set the same environment variables in the Vercel dashboard (or via `vercel env add`).

## Local Development

```bash
npm install
cp .env.example .env.local
# fill in Supabase + OpenRouter keys
```

Run the SQL in `supabase/schema.sql` inside your Supabase SQL editor.

```bash
npm run dev
```

Open http://localhost:3000

Without Supabase credentials the app uses realistic demo data so you can explore the UI immediately. OpenRouter key is required for live document scanning and AI analytics.

## Project Structure

```
src/
  app/
    page.tsx              # Main dashboard
    api/scan/route.ts     # Vision document extraction
    api/analytics/route.ts# AI recommendations
  components/
    DocumentScanner.tsx
    VehicleCard.tsx
  lib/
    supabase.ts
    utils.ts              # Risk, service, fuel calculations
  types/
supabase/
  schema.sql
```

## Notes

- Service interval defaults to 5000 km (editable per vehicle).
- Certificate reminders trigger at ≤ 20 days.
- Document scanner works best with clear photos of COIDA / Roadworthy certificates.
- Risk score weights: service 35% · certificates 40% · income exposure 25%.
