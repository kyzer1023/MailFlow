# Mail Flow

Mail Flow helps USM student society members turn a spreadsheet into personalized emails from their own Microsoft Outlook mailbox. Import recipients, compose a message, check the sending rules, preview and test it, then monitor a paced background campaign.

**For committees:** [view the web presentation](https://mailflow.kyzer-hono-test.workers.dev/presentation/). No sign-in or download is required. It explains the need for clearer email status and control, shows the current interface with illustrative data, and labels future features as roadmap proposals.

The product was proposed after the team's experience coordinating email through Power Automate: preparation was tedious and it was difficult to see what had happened or needed attention. Mail Flow brings preparation, paced sending, recipient outcomes, pause/resume, and export into one focused workflow.

[Prototype website](https://mailflow.kyzer-hono-test.workers.dev)

## What is available

- CSV and XLSX import with worksheet selection, column mapping, and row validation.
- Reusable flows, visual and HTML message editing, and personalized spreadsheet values.
- Fixed or spreadsheet-based CC, BCC, and Reply-to, plus message importance.
- Up to five campaign attachments, totaling 20 MiB, through the member's OneDrive App Folder.
- A three-step recipients-first journey, representative previews, self-only tests, and explicit confirmation.
- Immutable prepared sends and deliberate reusable-template publication with stale-edit protection.
- Background sending, mailbox FIFO queues, pause/resume, cancellation, and Microsoft reconnection.
- Separate recipient outcomes, audited manual receipt verification, paginated history, and CSV export.

The current prototype is individually owned: flows and campaigns belong to their creator. Shared society membership and records are on the [roadmap](docs/ROADMAP.md). Known readiness gaps are recorded there too. Microsoft acceptance is not proof of inbox delivery.

## Documentation

| Document | Read it for |
| --- | --- |
| [Product](docs/PRODUCT.md) | Current capabilities, workflow, limits, and terminology |
| [Architecture](docs/ARCHITECTURE.md) | Runtime, ownership, security, and delivery contracts |
| [Design](docs/DESIGN.md) | Visual identity, interaction rules, and presentation assets |
| [Operations](docs/OPERATIONS.md) | Local setup, deployment, recovery, and verification |
| [Roadmap](docs/ROADMAP.md) | Known gaps, planned improvements, and Society Workspaces |
| [Agent guide](AGENTS.md) | Repository working rules |

## Local development

Run from the repository root beside `package.json` and `wrangler.jsonc`:

```text
npm ci
npm run typecheck
npm test
npm run dev
```

For local OAuth and persistence, configure an ignored `.env` from [.env.example](.env.example), register the local Microsoft callback, and run `npm run db:migrate:local`. See [Operations](docs/OPERATIONS.md) before configuring credentials, migrating, deploying, or testing mail.

The application uses React/TypeScript and Vite in `src/app`, browser spreadsheet utilities in `src/client`, pure contracts in `src/domain`, and server adapters in `src/server`. [worker/index.ts](worker/index.ts) handles HTTP, Queues, and scheduled work. [migrations](migrations) and [wrangler.jsonc](wrangler.jsonc) define persistent schema and Cloudflare configuration.

## License

Original code and documentation are licensed under the [MIT License](LICENSE). Third-party terms and image exclusions are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
