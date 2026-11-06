# Architecture rules

- Capture Sheets reporting from existing message, analytics and ticket inserts through isolated, exception-safe database triggers; reporting must never block support operations.
- Deliver reporting through a server-only persistent outbox with stable session/attempt keys, bounded retries and wake-on-enqueue processing; keep original GLPI payloads and AI behavior unchanged.
- Export only allowlisted reporting fields and HMAC-pseudonymized user IDs through an authenticated, paginated server endpoint; never export personal details or transcript content.