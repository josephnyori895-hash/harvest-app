# Harvest Family — Production Release Checklist

## Release gate

A release is considered ready only when the production GitHub Actions workflow completes successfully.

### Automated

- [ ] lint
- [ ] TypeScript check
- [ ] admin contract tests
- [ ] security contract tests
- [ ] high-severity dependency audit
- [ ] production frontend build
- [ ] Android release build
- [ ] APK signature verification
- [ ] D1 migrations
- [ ] Worker deployment
- [ ] authenticated production smoke test
- [ ] live APK SHA-256 matches the signed build
- [ ] worker CI syntax/migration/dry-run checks

### Runtime

- [ ] `GET /health` returns database and R2 readiness
- [ ] authenticated login succeeds
- [ ] `/api/me` returns the logged-in account
- [ ] feed loads
- [ ] presence loads
- [ ] chat history and conversations load
- [ ] groups load
- [ ] departments load
- [ ] APK downloads successfully

### Before church-wide distribution

- [ ] Confirm the release workflow is green.
- [ ] Install the APK on at least one real Android phone.
- [ ] Sign in as a normal member.
- [ ] Open Home/feed, Stories, Reels, Groups, Chat, Departments, Events and Giving.
- [ ] Send one test chat message to another test account.
- [ ] Upload one test image/video if media is enabled.
- [ ] Verify logout/login works.
- [ ] Do not distribute admin credentials.
- [ ] Keep the previous known-good commit identified for rollback.

## Recovery

Cloudflare D1 Time Travel provides point-in-time recovery for production D1 databases. Use it for database recovery rather than attempting to manually undo migrations. See the Cloudflare D1 Time Travel documentation: https://developers.cloudflare.com/d1/reference/time-travel/

Application rollback should go through GitHub Actions so the deployed Worker and APK remain traceable to a Git commit.

## Known limitation

Universal WebRTC calling cannot be guaranteed on every mobile network without a production TURN service. Do not advertise calling as universally reliable until TURN has been configured and tested on representative mobile networks.
