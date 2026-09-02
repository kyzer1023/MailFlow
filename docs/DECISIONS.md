# Architecture decision log

## ADR-001 - Use Microsoft Graph instead of SMTP

Status: superseded by ADR-008.

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

## ADR-008 - Migrate mail transport from Graph to delegated OAuth SMTP

Status: accepted for staged implementation.

Mail Flow will use Exchange Online SMTP submission on port 587 with STARTTLS and delegated OAuth `SMTP.Send` as its target mail transport. This preserves the authenticated student's mailbox as the sender, creates a normal Sent Items copy, and supports MIME attachments without delegated `Mail.ReadWrite`. Mailbox passwords and SMTP Basic authentication remain prohibited.

The rollout is deployment-selectable rather than an automatic per-message fallback. Microsoft access tokens are resource-specific, so Graph scopes and the Outlook SMTP scope cannot be treated as one interchangeable bearer token. Production remains on Graph until a Cloudflare-hosted SMTP test passes; switching to SMTP requires users to complete OAuth consent again. Graph code remains available for rollback during the validation period.

SMTP transport must preserve ADR-005. A connection failure after the terminating DATA marker may have submitted the message and therefore becomes `unknown`; it is never automatically retried. Explicit pre-submission failures and explicit transient SMTP replies may be retried only when the provider can prove that no message was accepted.
