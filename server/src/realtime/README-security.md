Socket.IO security configuration

Set APP_ORIGINS to the exact browser origins allowed to establish realtime connections. Set JWT_SECRET to a random value of at least 32 characters. Production Docker Compose now requires both values instead of providing insecure defaults.
