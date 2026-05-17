# Swell Lead Notification Cron - Error Log

**Date:** May 14, 2026 - 12:06 AM EDT  
**Cron ID:** 31406cfd-699f-457d-b640-efe7595058b3

## Error

**Database Connection Failed**

- Host: `db.yrwuxcgvnzrzufcimrxl.aws-1-us-east-1.pooler.supabase.com:5432`
- Error: `getaddrinfo ENOTFOUND` (DNS resolution failure)
- Status: No SMS alerts sent, database not reached

## Impact

Unsent lead SMS notifications cannot be processed. Owners won't be alerted to new Swell leads.

## Action Required

1. ✅ Verify Supabase service/pooler is online
2. ✅ Check network connectivity from cron host
3. ✅ Confirm database hostname is current
4. ✅ Retry the cron job once connectivity is restored

---

If this persists, update the database credentials in cron task 31406cfd-699f-457d-b640-efe7595058b3 or disable it until Supabase is accessible.
