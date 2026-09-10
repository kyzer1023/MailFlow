# Third-party notices and asset scope

The root [MIT License](LICENSE) covers Mail Flow's original code and
documentation. It does not relicense dependencies or the excluded PNG assets
listed below. Upstream copyright, license, and notice files remain authoritative
and must accompany redistributed third-party material as their terms require.

## Dependencies

The following direct runtime dependencies were checked against the installed
packages and [package-lock.json](package-lock.json) on 2026-09-11:

| Package | Locked version | Upstream license |
| --- | --- | --- |
| `@phosphor-icons/react` | 2.1.10 | MIT |
| `dompurify` | 3.4.14 | MPL-2.0 OR Apache-2.0 |
| `entities` | 8.0.0 | BSD-2-Clause |
| `exceljs` | 4.4.0 | MIT |
| `hono` | 4.13.5 | MIT |
| `motion` | 13.1.1 | MIT |
| `react` | 19.2.0 | MIT |
| `react-dom` | 19.2.0 | MIT |
| `react-router-dom` | 7.18.3 | MIT |
| `zod` | 4.5.4 | MIT |

After installation, each package's full terms are in its `LICENSE` file, except
Motion and React Router DOM, which use `LICENSE.md`. DOMPurify also includes
`LICENSE-MPL`. Phosphor's icon notice is Copyright (c) 2020 Phosphor Icons;
those icons are not original Mail Flow artwork.

Transitive dependencies and development tools have additional licenses. For
example, JSZip offers MIT or GPL-3.0-or-later, and optional Sharp/libvips build
dependencies include LGPL-3.0-or-later terms. This inventory is not a complete
notice bundle for a compiled distribution. Preserve the applicable upstream
notices when distributing dependencies or bundles containing them.

### Unresolved dependency notice

`buffers@0.1.1`, installed through `exceljs -> unzipper -> binary -> buffers`,
has no license declaration in the lockfile or its published package metadata,
and its installed files contain no license notice. Its package identifies
James Halliday as the author. The upstream repository URL recorded by the
package, `https://github.com/substack/node-buffers`, returned 404 during this
check. No license is inferred for this package, and Mail Flow's MIT grant does
not cover it. Confirm the applicable upstream terms before redistributing it.

## PNG assets excluded from the MIT grant

This exclusion covers every PNG in `mock-images/`, including
`mock-images/refinement/`, and these two public assets:

- `public/assets/landing-route-stationery.png`
- `public/assets/mailflow-logo-horizontal.png`

[The progress log](docs/PROGRESS.md) records the original seven mock images as
supplied approved references, the two public assets as generated from those
references, and the refinement images as generated design continuations.
It does not establish the original references' creator or reuse terms.
Consequently, this repository grants no license for these PNGs while their
provenance and reuse rights remain unconfirmed. This does not assert ownership
of third-party content depicted in them.

## Fonts

The application names system-font fallbacks in
[its design tokens](src/app/styles/tokens.css). No font files are bundled in
this repository, and the MIT grant does not cover those separately installed
fonts.
