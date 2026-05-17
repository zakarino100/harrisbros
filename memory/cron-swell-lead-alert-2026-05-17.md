# Swell Lead Notification Reconciliation - Failed Run

**Date:** Sunday, May 17th, 2026 - 4:39 PM EDT  
**Cron ID:** 31406cfd-699f-457d-b640-efe7595058b3  
**Status:** ❌ FAILED

## Error
```
FATAL ERROR: getaddrinfo ENOTFOUND db.yrwuxcgvnzrzufcimrxl.pooler.supabase.com
```

## What Happened
- Attempted to connect to Supabase PostgreSQL database
- DNS lookup failed for pooler hostname
- No leads were processed
- No SMS alerts were sent

## Likely Causes
1. Network/firewall blocking AWS Supabase connections
2. DNS resolution failure (may be transient)
3. Invalid or outdated hostname in config
4. ISP/network-level blocking

## Action Required
- Verify network connectivity to AWS
- Check Supabase pooler status
- Verify hostname is current: `db.yrwuxcgvnzrzufcimrxl.pooler.supabase.com`
- Check firewall rules allow outbound HTTPS to Supabase

## Next Steps
- Cron will retry at next scheduled run
- Manual check recommended if connectivity persists
