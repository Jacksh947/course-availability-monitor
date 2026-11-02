# Course availability monitor

A small, read-only monitor for a PeopleSoft/SOLUS class-availability table. It uses Playwright rather than a paid AI browsing service.

## Current status

Local availability-rule, encryption, browser-extraction, notification-deduplication, five-day reporting and session-restore tests pass. A live check in a fresh browser successfully reopened the configured SOLUS course and read its availability using the saved sign-in. Each installation must verify access from a GitHub-hosted runner and real notification delivery before enabling the schedule. Scheduling is disabled by default.

## What it checks

Each successful check verifies the configured course, term and class number before reading status, class capacity, enrolment, available seats, waitlist capacity and waitlist total.

It alerts when waitlist room appears or increases; status changes to Waitlist; course seats appear or increase; status changes to Open; or class/waitlist capacity increases. It uses observed values rather than predicting what a fixed number of departures will do. Seats shown while status is Closed are treated as a reported opportunity, not guaranteed eligibility to enrol.

Identical observations do not cause repeated alerts. A check that cannot verify availability retries up to three times in separate browsers, with short backoffs, before reporting an interruption. Each attempt starts with the last verified saved session. A successful retry stays quiet unless availability changed. When AUTH_CREDENTIALS is configured, expired sign-in is renewed with a dedicated standard authenticator entry. Each run submits a password and code at most once. Rejected credentials or an unexpected verification challenge block further automatic login attempts until an owner requests fresh_check; a distinct alert requests attention. Old counts are never presented as current. It never enrols, joins a waitlist, swaps or drops a class.

SOLUS can return an otherwise valid session to **Select a Value** after inactivity. The monitor selects only the exact configured term from that chooser, then verifies the term, course and class again. A different active term is rejected; the monitor does not read a similarly numbered class from another term.

## Five-day status reports

The first reporting period starts with the first cloud check. Every five elapsed days, a status notification is sent regardless of whether openings were detected. Opening alerts are independent and are sent as soon as the next scheduled check detects them.

If healthy checks detected no openings, the status says **Five-day update: no openings detected**. If an opening occurred and later disappeared, the report preserves that history instead of saying there were none. If checks failed, a long gap occurred, or too few checks ran, it explicitly reports incomplete monitoring. “No openings detected” describes the sampled checks, not a guarantee that no brief opening occurred between checks.

The regular checker sends the report when due. A separate lightweight workflow, scheduled every ten minutes between browser checks, provides backup reporting if the browser job fails before it can run the checker. It also warns once when no verified check has been recorded for the configured grace period (60 minutes for a 30-minute check interval), unless an existing interruption has already been reported. Recovery sends a resumed notice. Both workflows use the same concurrency lock and encrypted state to prevent duplicate reports. The health workflow shares GitHub's hosting and scheduler, so an outage affecting both workflows can delay the warning as well as the checks. Unconditional delivery cannot be guaranteed by a free hosted service. Failed report delivery preserves the reporting period for a retry.

## Free cloud design

Use standard GitHub-hosted Ubuntu runners in a public repository. The workflow refuses to run in a private repository, uses no paid browser/model service, and publishes no screenshots, page text or artifacts. Production checks should be dispatched every 30 minutes by an external scheduler. GitHub native cron at minutes 17 and 47 is only a backup; GitHub may delay or drop scheduled runs. Free hosting is not an exact-time or uptime guarantee.

The workflow remains off until the repository variable `MONITOR_ENABLED` is set to `true`. Manual checks and a test notification are available independently. Scheduling must only be enabled after a live cloud check and notification delivery have been verified.

## Privacy and notifications

The public source contains no target course, account details or saved sign-in. Target settings and the initial session are supplied through repository secrets. Rolling browser state and prior observations are encrypted with AES-256-GCM before being stored on a separate `monitor-state` branch. Failed checks also store bounded page text from the configured portal in that encrypted state for troubleshooting; successful checks clear it. The encryption key remains a repository secret. Public commit/run timing and generic alert issue titles remain visible.

Notifications use GitHub issues assigned to the repository owner. Their text is generic and contains no course counts or portal data. The owner must enable GitHub email or mobile notifications for assignments and confirm receipt of a test notification. If the GitHub API or runner itself fails, the in-script notification may also fail; GitHub Actions failure notifications should be enabled as an additional signal. An optional HEALTHCHECK_URL secret pings hc-ping.com only after a fresh validated read, notifications and state persistence succeed. Configure a separate Healthchecks.io check to detect missing completions independently of GitHub. Trigger acceptance alone does not prove a course check succeeded.

Only the owner should have write access to this repository: anyone able to change workflows can potentially access its secrets. There are no pull-request or untrusted-code workflow triggers.

## Setup with Codex

1. Install the project dependency and browser: `npm ci --ignore-scripts`, then `npx playwright install chromium`.
2. Keep a private configuration file outside the repository, with `login_url`, `entry_url`, `course`, `term` and `class_number`. The target values are intentionally absent from this source.
3. Run `node src/login.mjs PRIVATE_CONFIG_PATH PRIVATE_SESSION_PATH`. Sign in manually in the separate browser and open the class's **Class Availability** tab. Return to the local **Save monitor sign-in** tab and save.
4. Set `MONITOR_CONFIG_PATH` and `MONITOR_SESSION_PATH` to those private files, then run `node src/check.mjs --local`. Resolve any navigation error before deployment. The adapter selects the exact configured term if SOLUS has returned to its chooser, opens the course from Recently Viewed or searches for its course code, and then opens the configured lecture's Class Availability tab. If the active term or page layout cannot be verified, it retries and reports an interruption.
5. Review and approve publication of this generic source in a public GitHub repository.
6. Run `node src/prepare-secrets.mjs PRIVATE_CONFIG_PATH PRIVATE_SESSION_PATH PRIVATE_SECRETS_DIRECTORY`. Upload the resulting `STATE_KEY`, `SESSION_INITIAL` and `MONITOR_CONFIG` files as repository secrets. Do not paste their contents into chat or commit them to Git.
7. Manually run the workflow in `check` mode and verify cloud access. Then run `test_alert` and confirm an email or push arrives.
8. Enable the schedule by setting `MONITOR_ENABLED=true`.

For unattended reauthentication, AUTH_CREDENTIALS is a repository secret containing JSON with username, password and seed for a separate standard authenticator entry. Never commit it or paste it into an issue. This credential combination can access the broader school account. fresh_check starts with an empty browser context, explicitly exercising cloud login rather than relying on cached cookies. The normal check reuses rolling session state and renews it when necessary. Keep the existing STATE_KEY. The local setup helper only saves encrypted credentials on the owner's computer; it does not upload anything. Cloud storage requires separate explicit approval.

## Verification

Run `npm test`. Tests use synthetic course data and local browser fixtures, not the live portal. Passing them does not establish that SOLUS will accept a session from a GitHub-hosted IP address or keep that session valid for weeks.

## References

- [Playwright authentication and saved browser state](https://playwright.dev/docs/auth)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub scheduled workflow limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
