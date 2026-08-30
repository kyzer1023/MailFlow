# Architecture decision log

## ADR-001 - Use Microsoft Graph instead of SMTP

Status: accepted.

Mail Flow sends through delegated Microsoft Graph `Mail.Send`. This preserves the signed-in student's Outlook identity and avoids mailbox password storage, Basic SMTP authentication, and university-domain sender verification with an external provider.

## ADR-002 - Use Cloudflare as the only hosting platform

Status: accepted.

Workers Static Assets hosts the client, a Worker hosts the API and OAuth callbacks, D1 stores durable state, and Queues runs background campaign work. Microsoft remains an external identity and mail API, not an application hosting provider.

## ADR-003 - Parse spreadsheets in the browser

Status: accepted.

Browser parsing keeps large CPU work out of Worker requests and lets the user inspect and correct data before normalized rows are sent to the API.

## ADR-004 - Use a campaign-tick queue

Status: accepted.

One queue tick advances one recipient and schedules the next tick after the pace delay. This produces predictable sending behavior and avoids publishing an immediate burst of all recipients.

## ADR-005 - Prefer no duplicate over automatic retry after ambiguity

Status: accepted.

Graph sendMail has no safe application idempotency key. A lost response after request submission can mean the email was sent. Such jobs become `unknown` and require a human decision rather than an automatic resend.

## ADR-006 - Visual mocks are implementation authority

Status: accepted.

The seven PNG files in `mock-images/` are approved targets. The taste skill is used for landing-page quality discipline, but it cannot override a visible decision in an approved mock. Operational screens follow the image-to-code fidelity workflow.

## ADR-007 - Keep local test credentials outside the product

Status: accepted.

The root `.env` helps authorized local testing only. Passwords are never bundled, uploaded, stored in D1, copied to Cloudflare secrets, or used as an authentication architecture. Production authentication is interactive OAuth.

