# Swell Lead Notification Cron — Connection Error

**Date:** May 14, 2026 - 11:30 PM ET
**Cron ID:** 31406cfd-699f-457d-b640-efe7595058b3

## Error
Cannot resolve Supabase host: `db.yrwuxcgvnzrzufcimrxl.aws-1-us-east-1.pooler.supabase.com`

## Issue
The hostname provided may be malformed or the cron environment lacks internet connectivity.

## Action Needed
1. Verify Supabase pooler hostname (standard format: `db.[project-ref].pooler.supabase.com`)
2. Check network connectivity in cron environment
3. Provide corrected hostname

## Script Location
`.cron/swell-lead-notification.js` — ready to retry once hostname is verified

## Expected Behavior
When connection succeeds:
- Query for leads created in last 48 hours with `sms_alert_sent = false`
- Send SMS alert from tenant's Twilio number to owner phone
- Update database to mark alerts as sent
- Return `NO_REPLY` if no leads, or alert count on success
