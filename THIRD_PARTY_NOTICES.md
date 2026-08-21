# Third-party notices

Flight Ledger itself is MIT-licensed (see [LICENSE](LICENSE)). This file
inventories the third-party material the repository redistributes, with the
full license texts in [`licenses/`](licenses/).

## Fonts (`src/fonts/`)

| Font | Copyright | License |
|---|---|---|
| Barlow, Barlow Condensed | Copyright 2017 The Barlow Project Authors (<https://github.com/jpt/barlow>) | [SIL OFL 1.1](licenses/Barlow-OFL.txt) |
| IBM Plex Mono | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" | [SIL OFL 1.1](licenses/IBMPlexMono-OFL.txt) |

## Test fixtures (`fixtures/anonymized/`)

Eighteen of the anonymized email fixtures originate from two MIT-licensed
corpora, as documented in [docs/importers.md](docs/importers.md):

| Source | Copyright | License |
|---|---|---|
| [email-to-lunchmoney](https://github.com/evanpurkhiser/email-to-lunchmoney) — eleven fixtures | Copyright (c) 2013 Evan Purkhiser | [MIT](licenses/email-to-lunchmoney-MIT.txt) |
| [partiu](https://github.com/thiagodsti/partiu) — seven fixtures | Copyright (c) 2025 thiagodsti | [MIT](licenses/partiu-MIT.txt) |

## Bundled data and libraries

These carry no notice requirement, and are listed for completeness:

- **OurAirports** airport data (`src/data/airports.json`) — public domain.
- **Natural Earth** world outline (`src/data/world-land.json`) — public domain.
- **FAA Releasable Aircraft Database** extract (`src/data/fleet.json`) —
  United States government public data.
- **tz-lookup** (`@photostructure/tz-lookup`) timezone boundary data — CC0 1.0.
- **SQLite** and the official SQLite WASM build — public domain.
- The **BIS city-pair table** (`src/data/bis-mileage.json`) was compiled from
  a community FlyerTalk thread, credited in the file's header.
