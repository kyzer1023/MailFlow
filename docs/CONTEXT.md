# Project context

## Product

Mail Flow replaces unreliable Power Automate mail-merge processes used by USM student society members. It is not an SMTP server and is not tied to one society. It is a narrow web application that prepares personalized campaign email and submits it through the signed-in member's student Outlook mailbox.

## Intended users

- Committee members across USM student societies who are not expected to diagnose automation platforms.
- Society administrators who need campaign visibility and safe defaults.
- Future technical custodians who need a reproducible, documented Cloudflare deployment.

## User outcome

A society member can safely turn a spreadsheet and reusable HTML message into individually addressed emails from their own student account. The member can see what will be sent, correct bad rows, test the result, start a paced campaign, close the browser, and later understand every accepted, failed, skipped, pending, or unknown row without blind reruns.

## Confirmed platform direction

- React, TypeScript, and Vite for the client.
- Cloudflare Worker for same-origin API and OAuth callbacks.
- Cloudflare D1 for users, sessions, flows, template versions, campaigns, recipient jobs, attachment metadata, and audit events.
- Each signed-in student's OneDrive App Folder for temporary campaign attachment bytes.
- Cloudflare Queues for background campaign ticks.
- Microsoft Entra ID single-tenant authentication.
- Delegated OAuth SMTP is the target mail transport and the only transport that supports attachments. Microsoft Graph delegated `Mail.Send` remains a temporary deployment rollback path.
- Browser-side `.xlsx` and `.csv` parsing.
- A free `workers.dev` URL for the first deployment. A custom domain can be attached later.

## Existing prerequisites

- A single-tenant Microsoft Entra application named `MailFlow` already exists in the USM tenant.
- The application has delegated Microsoft Graph `Mail.Send` and `User.Read` configured for rollback. SMTP deployments request delegated `https://outlook.office.com/SMTP.Send` during sign-in, and attachment users separately authorize delegated `Files.ReadWrite.AppFolder` for their own OneDrive storage.
- Localhost and deployed Web callback routes have been exercised with the existing application.
- The deployed Worker uses an existing confidential client credential stored only as a Cloudflare secret. Its value is intentionally not recoverable from Entra.
- Two USM student test accounts are available locally. Both completed authentication-only XOAUTH2 probes successfully; this is strong cohort evidence, not a tenant-wide guarantee.
- Five Gmail recipients are available in an already-open Gmail session for external-delivery testing.
- The user has open Chrome tabs for Gmail, Microsoft Entra, and Cloudflare and authorized their use for setup, verification, and deployment.
- The root `.env` holds local application configuration. The ignored `.env.test-accounts` preserves local interactive test-account notes. Neither file may be committed or deployed.

## Source references

- Accepted product discussion: ChatGPT conversation `6a943ed2-5240-83ec-9f08-ea92f59a4e03`, titled `Research SMTP Alternatives`.
- Approved visual targets: every PNG under `mock-images/`.
- Landing-page quality rules: local `design-taste-frontend` skill sourced from `github.com/leonxlnx/taste-skill`.
- Fidelity workflow: local Product Design `image-to-code` skill.

## Success definition

The prototype is successful when:

1. Both USM test users can authenticate through the same Entra application.
2. A member can complete the accepted flow from file import through campaign monitoring.
3. A member can add up to five campaign-wide attachments totaling at most 20 MiB, verify them in Review, and send them through delegated OAuth SMTP.
4. Real test messages can be accepted by the selected Microsoft transport from both student mailboxes and observed in the intended Gmail inboxes.
5. Queue processing continues without an open browser and prevents obvious duplicate sends.
6. The visible implementation closely matches the approved mock at comparable desktop viewports and remains usable on mobile.
7. The project is deployed on Cloudflare and has a working public URL.
8. A future agent can reproduce, test, and deploy the project from repository documentation.
