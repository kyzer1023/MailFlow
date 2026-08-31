# Project context

## Product

Mail Flow replaces unreliable Power Automate mail-merge processes used by USM student society members. It is not an SMTP server and is not tied to one society. It is a narrow web application that prepares personalized campaign email and asks Microsoft Graph to send it from the signed-in member's student Outlook mailbox.

## Intended users

- Committee members across USM student societies who are not expected to diagnose automation platforms.
- Society administrators who need campaign visibility and safe defaults.
- Future technical custodians who need a reproducible, documented Cloudflare deployment.

## User outcome

A society member can safely turn a spreadsheet and reusable HTML message into individually addressed emails from their own student account. The member can see what will be sent, correct bad rows, test the result, start a paced campaign, close the browser, and later understand every accepted, failed, skipped, pending, or unknown row without blind reruns.

## Confirmed platform direction

- React, TypeScript, and Vite for the client.
- Cloudflare Worker for same-origin API and OAuth callbacks.
- Cloudflare D1 for users, sessions, flows, template versions, campaigns, recipient jobs, and audit events.
- Cloudflare Queues for background campaign ticks.
- Microsoft Entra ID single-tenant authentication.
- Microsoft Graph delegated `Mail.Send` for sending.
- Browser-side `.xlsx` and `.csv` parsing.
- A free `workers.dev` URL for the first deployment. A custom domain can be attached later.

## Existing prerequisites

- A single-tenant Microsoft Entra application named `MailFlow` already exists in the USM tenant.
- The application has delegated Microsoft Graph `Mail.Send` and `User.Read` configured.
- Its only current Web redirect URI is an older localhost callback and must be updated for this implementation.
- The application currently has no client secret, certificate, or federated credential. A server-side confidential OAuth flow therefore needs one credential to be created before live integration.
- Two USM student test accounts are available locally. One owns or created the Entra application, and the second verifies that another tenant member can use it.
- Five Gmail recipients are available in an already-open Gmail session for external-delivery testing.
- The user has open Chrome tabs for Gmail, Microsoft Entra, and Cloudflare and authorized their use for setup, verification, and deployment.
- The root `.env` is local-only and must never be committed or deployed.

## Source references

- Accepted product discussion: ChatGPT conversation `6a943ed2-5240-83ec-9f08-ea92f59a4e03`, titled `Research SMTP Alternatives`.
- Approved visual targets: every PNG under `mock-images/`.
- Landing-page quality rules: local `design-taste-frontend` skill sourced from `github.com/leonxlnx/taste-skill`.
- Fidelity workflow: local Product Design `image-to-code` skill.

## Success definition

The prototype is successful when:

1. Both USM test users can authenticate through the same Entra application.
2. A member can complete the accepted flow from file import through campaign monitoring.
3. Real test messages can be accepted by Graph from both student mailboxes and observed in the intended Gmail inboxes.
4. Queue processing continues without an open browser and prevents obvious duplicate sends.
5. The visible implementation closely matches the approved mock at comparable desktop viewports and remains usable on mobile.
6. The project is deployed on Cloudflare and has a working public URL.
7. A future agent can reproduce, test, and deploy the project from repository documentation.
