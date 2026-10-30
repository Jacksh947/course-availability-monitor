# Course availability monitor

A small, read-only monitor for a PeopleSoft/SOLUS class-availability table. It uses Playwright rather than a paid AI browsing service.

## Current status

Local availability-rule, encryption, browser-extraction, notification-deduplication, five-day reporting and session-restore tests pass. A live check in a fresh browser successfully reopened the configured SOLUS course and read its availability using the saved sign-in. Each installation must verify access from a GitHub-hosted runner and real notification delivery before enabling the schedule. Scheduling is disabled by default.

## What it checks

Each successful check verifies the configured course, term and class number before reading status, class capacity, enrolment, available seats, waitlist capacity and waitlist total.

It alerts when waitlist room appears or increases; status changes to Waitlist; course seats appear or increase; status changes to Open; or class/waitlist capacity increases. It uses observed values rather than predicting what a fixed number of departures will do. Seats shown while status is Closed are treated as a reported opportunity, not guaranteed eligibility to enrol.

Identical observations do not cause repeated alerts. If access or parsing fails, the monitor reports an interruption instead of presenting old counts as current. It never enrols, joins a waitlist, swaps or drops a class.

## Five-day status reports

The first reporting period starts with the first cloud check. Every five elapsed days, a status notification is sent regardless of whether openings were detected. Opening alerts are independent and are sent as soon as the next scheduled check detects them.

If healthy checks detected no openings, the status says **Five-day update: no openings detected**. If an opening occurred and later disappeared, the report preserves that history instead of saying there were none. If checks failed, a long gap occurred, or too few checks ran, it explicitly reports incomplete monitoring. “No openings detected” describes the sampled checks, not a guarantee that no brief opening occurred between checks.

The regular checker sends the report when due. A separate lightweight hourly workflow provides backup reporting if the browser job fails before it can run the checker. Both use the same concurrency lock and encrypted state to prevent duplicate reports. A GitHub outage, exhausted quota or notification-service failure can still prevent delivery; unconditional delivery cannot be guaranteed by a free hosted service. Failed report delivery preserves the reporting period for a retry.

## Free cloud design

Use standard GitHub-hosted Ubuntu runners in a public repository. The workflow refuses to run in a private repository, uses no paid browser/model service, and uploads no screenshots, page captures or artifacts. Scheduling is requested at 10-minute intervals, away from the start of the hour, but GitHub may delay or drop scheduled runs. Free hosting is not an exact-time or uptime guarantee.

The workflow remains off until the repository variable `MONITOR_ENABLED` is set to `true`. Manual checks and a test notification are available independently. Scheduling must only be enabled after a live cloud check and notification delivery have been verified.

## Privacy and notifications

The public source contains no target course, account details or saved sign-in. Target settings and the initial session are supplied through repository secrets. Rolling browser state and prior observations are encrypted with AES-256-GCM before being stored on a separate `monitor-state` branch. The encryption key remains a repository secret. Public commit/run timing and generic alert issue titles remain visible.

Notifications use GitHub issues assigned to the repository owner. Their text is generic and contains no course counts or portal data. The owner must enable GitHub email or mobile notifications for assignments and confirm receipt of a test notification. If the GitHub API or runner itself fails, the in-script notification may also fail; GitHub Actions failure notifications should be enabled as an additional signal. A separate external watchdog is not included.

Only the owner should have write access to this repository: anyone able to change workflows can potentially access its secrets. There are no pull-request or untrusted-code workflow triggers.

## Setup with Codex

1. Install the project dependency and browser: `npm ci --ignore-scripts`, then `npx playwright install chromium`.
2. Keep a private configuration file outside the repository, with `login_url`, `entry_url`, `course`, `term` and `class_number`. The target values are intentionally absent from this source.
3. Run `node src/login.mjs PRIVATE_CONFIG_PATH PRIVATE_SESSION_PATH`. Sign in manually in the separate browser and open the class's **Class Availability** tab. Return to the local **Save monitor sign-in** tab and save.
4. Set `MONITOR_CONFIG_PATH` and `MONITOR_SESSION_PATH` to those private files, then run `node src/check.mjs --local`. Resolve any navigation error before deployment. The adapter verifies the term, opens the course from Recently Viewed or searches for its course code, and then opens the configured lecture's Class Availability tab. If the portal resets to a different term or page layout, it stops and reports an interruption.
5. Review and approve publication of this generic source in a public GitHub repository.
6. Run `node src/prepare-secrets.mjs PRIVATE_CONFIG_PATH PRIVATE_SESSION_PATH PRIVATE_SECRETS_DIRECTORY`. Upload the resulting `STATE_KEY`, `SESSION_INITIAL` and `MONITOR_CONFIG` files as repository secrets. Do not paste their contents into chat or commit them to Git.
7. Manually run the workflow in `check` mode and verify cloud access. Then run `test_alert` and confirm an email or push arrives.
8. Enable the schedule by setting `MONITOR_ENABLED=true`.

When SOLUS requests MFA again, repeat manual login and update the `SESSION_INITIAL` secret. Keep the existing `STATE_KEY`; the monitor recognizes a newer saved login. Never remove MFA or put a Queen's password in the repository.

## Verification

Run `npm test`. Tests use synthetic course data and local browser fixtures, not the live portal. Passing them does not establish that SOLUS will accept a session from a GitHub-hosted IP address or keep that session valid for weeks.

## References

- [Playwright authentication and saved browser state](https://playwright.dev/docs/auth)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub scheduled workflow limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
