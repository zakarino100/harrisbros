# Harris Bros Leads

Standalone lightweight backend for Harris Brothers Facebook leads.

## Features
- Meta webhook verification and ingestion
- Graph API lead fetch by leadgen_id
- SQLite lead storage
- SMS alert to Rowdy on new lead
- Simple password-protected leads dashboard

## Setup
1. Copy `.env.example` to `.env`
2. Fill in Facebook and Twilio secrets
3. Install deps: `npm install`
4. Run locally: `npm run dev`

## Deploy
- Deploy as a separate Replit project
- Set env vars in Replit Secrets
- Use `npm install && npm run build && npm start`

## Webhook
- Verify URL: `/api/facebook/webhook`
- Use `FACEBOOK_WEBHOOK_VERIFY_TOKEN` as the verify token
