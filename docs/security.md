# Security

The threat model, and the control that answers each threat. Every item here is
covered by a test in `e2e/failures.spec.ts` or `backend/tests/`.

## Who we are defending against

1. **An anonymous visitor** trying to reach owner-only functions or read
   another person's data.
2. **A signed-in user** trying to escalate to owner.
3. **Someone with a share link** trying to reach files they were not given.
4. **Malicious file content**, including archives crafted to escape extraction.
5. **Automated abuse**: credential stuffing, scraping, download flooding.

## Authentication

- Passwords hashed with **Argon2id** (19 MiB, t=2, p=1). Never logged, never
  returned, never in an audit entry.
- Sessions are opaque random tokens in `httpOnly`, `SameSite=Lax` cookies,
  `Secure` in production. Only a keyed **hash** of the token is stored, so a
  database leak yields nothing usable.
- Sign-in returns one message and comparable timing whether the account exists
  or the password is wrong. Password reset gives the same answer either way.
- Changing a password ends every other session. Suspending an account ends all
  of its sessions immediately.
- Verification and reset tokens are single-use, hashed, and expire in an hour.

## Authorization

Checked server-side on every protected route, in this order: authenticate →
authorize → validate → act. Frontend visibility is not a control. The admin
route redirecting is a convenience; the API returning 403 is the control.

The owner role cannot be suspended or deleted through the admin API, so the
site cannot be locked out of its own administration.

## File upload

Files are treated as untrusted even though only the owner can upload them.

| Risk | Control |
| --- | --- |
| Executable disguised as an asset | Extension allowlist per purpose, plus magic-byte verification of the **stored** bytes. `MZ` and `ELF` headers are refused outright. |
| Script-bearing markup | `.html`, `.svg`, `.php` and friends are denied for resource files. SVG is allowed only for owner-controlled site branding. |
| Zip-slip / path traversal | Archive central directory is scanned for `../`, absolute and drive-letter paths. A match deletes the object and fails the session. |
| Truncated or swapped payload | Stored size is compared to declared size; mismatches are deleted rather than published. |
| Filename injection into storage | Keys are generated server-side. The uploaded name is display-only and sanitised for `Content-Disposition`. |
| Oversized upload | Per-purpose byte limits, enforced before a signed URL is issued and again on completion. |
| Orphaned objects | Uploads land in `staging/` and are promoted only on success; a job aborts and cleans up anything abandoned. |

The platform never executes an uploaded file. Scripts, extensions and installers
are stored and served as opaque bytes.

## Download access

- The public token is unguessable, carries no storage information, and is
  checked against resource status on every request.
- The signed URL returned is short-lived (5 minutes by default) and treated as a
  bearer credential: never logged, never used as the canonical share URL.
- The media route only serves keys that a **published or unlisted row actually
  references**, so a guessed or traversed key cannot reach an arbitrary object.
  Version files are excluded from it entirely, because they are downloads, not media.
- Signed local-storage URLs are HMAC-signed over their full parameter set and
  compared in constant time, so a tampered key or expiry is rejected.

## Rate limiting

Keyed on a hashed IP, so no raw addresses are stored. Limits are set to be
invisible during normal use and to bite on abuse: sign-in and registration are
tight; browsing is generous, because reading a library is not an attack.

Registration allows 30 per hour per address. A single shared address (an
office, a campus, a carrier NAT) should never reach that in honest use, but a
script will. Failed sign-ins are counted and successful ones are not, so someone
guessing passwords is throttled while a person who mistypes once is not.

## Transport and headers

Helmet sets a strict Content-Security-Policy with no external script or font
origins, `frame-ancestors 'none'`, `object-src 'none'` and HSTS. CORS applies to
the API only and refuses by omitting headers rather than by throwing, because a policy
decision should not become a 500 for the caller.

## Privacy

Only email, display name and authentication state are stored for an account.
Analytics records device class and referrer, never a raw IP. Users can delete
their account, which removes their sessions, saves, notifications and
preferences; download events survive with a null user so aggregate counts stay
honest.

## Logging

Structured logs carry request id, route, status, latency and user id. Passwords,
session tokens, storage credentials and signed URLs are redacted at the logger,
not at each call site.

## Operational notes

- Secrets come from the environment and are validated at boot. Production
  refuses to start with a local storage driver or insecure cookies.
- `AUTH_SECRET` derives session and token hashes; rotating it signs everyone out
  and invalidates outstanding verification and reset links. That is intentional.
- The one thing this design does not include is malware scanning of uploaded
  archives. Signature and structure checks catch disguises and traversal, but
  not a genuinely malicious script the owner uploads believing it is safe. If
  the library ever accepts third-party submissions, that gap must be closed
  before it does.
