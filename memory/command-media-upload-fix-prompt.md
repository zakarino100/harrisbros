# COMMAND — Media Upload Fix Prompt

_Saved 2026-03-29 — confirmed shipped and working 2026-03-29_

---

**Fix three issues with the media upload flow:**

**1. Supabase Storage (persistent uploads)**
Wire the media upload endpoint to use Supabase Storage via `@supabase/supabase-js` with the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets already configured. Upload files to a bucket called `media` — create it if it doesn't exist with public read access. After upload, return the permanent public URL from Supabase and store that URL on the post record. Do not use local/temp disk or Replit's object store.

**2. Block post submission until upload completes**
The "Post" / submit button must be disabled and non-submittable while an upload is in progress. The upload promise must fully resolve (or reject) before the form can be submitted. If the upload fails, show an error and keep the form open — never submit a post with an unresolved or failed media URL.

**3. Mobile Safari video compatibility**
When a video is selected, transcode or validate that the output format is H.264/AAC in an MP4 container before or after upload, since mobile Safari does not reliably support WebM or other codecs. If transcoding isn't feasible on the backend, at minimum accept only `.mp4`, `.mov`, and `.m4v` on the file picker (these are natively compatible with Safari) and reject other video formats with a clear error message to the user.
