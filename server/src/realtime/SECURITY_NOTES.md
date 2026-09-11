Socket.IO hardening in this branch requires:

- JWT_SECRET set to at least 32 characters.
- APP_ORIGINS set to exact allowed browser origins.
- Authenticated Socket.IO connections only.
- Bounded payloads and per-user event rate limits.
- DM receipt and typing events bound to the authenticated conversation.
- Group joins and sends checked against database membership.
