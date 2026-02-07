# MMM-Scores

A MagicMirror² module that cycles through MLB, NHL, NFL, NBA, and Olympic Ice Hockey scoreboards. Scores are fetched automatically from public APIs with sensible fallbacks.

---

## Table of Contents
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Layout controls](#layout-controls)
  - [League rotation](#league-rotation)
  - [Highlighting](#highlighting)
- [Assets & Styling](#assets--styling)
- [Data Sources](#data-sources)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features
- **Six-league scoreboards**: MLB (R/H/E linescore), NHL (goals & shots), NFL (quarter-by-quarter totals plus bye list), NBA (quarter/OT breakdown), Men's Olympic Hockey, and Women's Olympic Hockey.
- **Automatic league rotation**: Show a single league, a custom sequence, or all supported leagues with timed page flips.
- **Flexible layout**: Control columns, rows, or total games per page per league and scale everything with a single `layoutScale` value.
- **Favorite team highlighting**: Per-league highlight lists add a subtle accent to matching teams on scoreboards.
- **Times Square-inspired font option**: Apply the included font to scoreboard content while keeping the default MagicMirror header font.
- **Width cap for MagicMirror regions**: Keep headers and content aligned inside `middle_center` or other constrained regions.

---

## Requirements
- **MagicMirror²** v2.20.0 or newer.
- **Node.js 18+** on the MagicMirror host (uses the built-in `fetch`).
- Optional: Team logo PNGs and the `TimesSquare-m105.ttf` font (see [Assets & Styling](#assets--styling)).

---

## Installation
```bash
cd ~/MagicMirror/modules
git clone https://github.com/yourname/MMM-Scores.git
cd MMM-Scores
# No npm install required; the helper uses Node 18's global fetch.
```

Place any custom logos or font files as described below, then add the module to your `config/config.js`.

---

## API Connectivity Check
Use this script to verify that every external API endpoint used by the helper is reachable from your host:
```bash
npm run test:api
```
The command checks MLB, NHL (all fallback feeds), NFL, NBA, and both Olympic hockey ESPN endpoints, then exits non-zero if any connection fails.

Use this Olympic-focused diagnostics script to check provider reachability and print normalized men's/women's Olympic games for a target date:
```bash
npm run test:olympic -- 2026-02-11
```

---

## Quick Start
Add this entry to `config/config.js`:
```js
{
  module: "MMM-Scores",
  position: "middle_center",
  config: {
    league: "all",                 // "mlb", "nhl", "nfl", "nba", "olympic_mhockey", "olympic_whockey", array, or "all"
    updateIntervalScores: 60 * 1000, // helper refresh frequency
    rotateIntervalScores: 15 * 1000, // front-end page flip interval
    layoutScale: 0.95,               // scale everything uniformly
    highlightedTeams_mlb: ["CUBS"],
    highlightedTeams_olympic_mhockey: ["USA"],
    highlightedTeams_oly_whockey: ["CAN"], // short alias also supported
    maxWidth: "720px"
  }
}
```
By default the module cycles through every supported league. Supply a string, array, or comma-separated list to `league`/`leagues` to control the order.

---

## Configuration
Every option may be declared globally, as an object keyed by league (`{ mlb: value, nhl: value, ... }`), or with a per-league suffix (`gamesPerColumn_nhl`). When both exist, per-league values win.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `league` / `leagues` | `string \| string[]` | `"mlb"` | League(s) to display. Accepts `"mlb"`, `"nhl"`, `"nfl"`, `"nba"`, `"olympic_mhockey"`, `"olympic_whockey"`, or `"all"`. Arrays define the rotation order. |
| `updateIntervalScores` | `number` | `60000` | Milliseconds between helper fetches. Minimum enforced interval is 10 seconds. |
| `rotateIntervalScores` | `number` | `15000` | Milliseconds between scoreboard page rotations. |
| `timeZone` | `string` | `"America/Chicago"` | Time zone used to decide the scoreboard date (requests the previous day before 09:30 local). |
| `providerCacheMs` | `number` | `20000` | Per-provider/per-date Olympic provider cache TTL in milliseconds (minimum 15000). |
| `scoreboardColumns` | `number` | auto | Columns per page. Defaults to 2 for MLB (capped at 2) and 4 for NHL/NFL/NBA/Olympic hockey. |
| `gamesPerColumn` (`scoreboardRows`) | `number` | auto | Games stacked in each column (4 for all leagues unless overridden). |
| `gamesPerPage` | `number` | derived | Override the total games per page; rows adjust automatically per league. |
| `layoutScale` | `number` | `1` | Scales the entire module (clamped between 0.6 and 1.4). |
| `highlightedTeams_mlb` | `string \| string[]` | `[]` | Team abbreviations to highlight. Also available as `_nhl`, `_nfl`, `_nba`, `_olympic_mhockey`/`_oly_mhockey`, `_olympic_whockey`/`_oly_whockey`. |
| `showTitle` | `boolean` | `true` | Toggles the module header (`MLB Scoreboard`, etc.). |
| `useTimesSquareFont` | `boolean` | `true` | Applies the Times Square font to scoreboard cards. |
| `maxWidth` | `string \| number` | `"800px"` | Caps the module width and header alignment. Numbers are treated as pixels. |

### Layout controls
- **Per-league overrides**: Append the league suffix (`_nhl`, `_nfl`, `_nba`, `_mlb`, `_olympic_mhockey`, `_olympic_whockey`) to `scoreboardColumns`, `gamesPerColumn`, or `gamesPerPage` to change a single league's layout.
- **Object form**: For `layoutScale` or highlight lists, you can pass an object with `default` and per-league keys.

### League rotation
The module keeps an internal rotation list derived from `league`/`leagues`. It fetches games for every configured league on each helper poll and flips the front-end page every `rotateIntervalScores` milliseconds.

### Highlighting
Highlight any number of teams per league using the appropriate `_mlb`, `_nhl`, `_nfl`, `_nba`, `_olympic_mhockey` (or `_oly_mhockey`), or `_olympic_whockey` (or `_oly_whockey`) suffix. Highlights apply to scoreboards.

Olympic hockey country mapping uses IOC-style 3-letter codes (`CAN`, `USA`, `FIN`, `SWE`, `GER`, `SUI`, `CZE`, `SVK`, `LAT`, `DEN`, `FRA`, `ITA`, `JPN`).

---

## Assets & Styling
```
MMM-Scores/
├─ MMM-Scores.js
├─ MMM-Scores.css
├─ node_helper.js
├─ fonts/
│  └─ TimesSquare-m105.ttf
└─ images/
   ├─ mlb/
   │  └─ ATL.png (etc.)
   ├─ nhl/
   │  └─ BOS.png (etc.)
   ├─ nfl/
   │  └─ kc.png  (lowercase filenames)
   ├─ nba/
   │  └─ ATL.png (etc.)
   └─ oly/
      └─ USA.png (Olympic country flags, uppercase IOC code)
```
- **Logos**: Place transparent PNG logos named with the abbreviations used in-game data (`CUBS.png`, `NYR.png`, `kc.png`, `CHI.png`, etc.). The module falls back to text when a logo is missing. Olympic men's/women's hockey both read from `images/oly/<CODE>.png` (for example `CAN.png`, `USA.png`, `SWE.png`).
- **Font**: Drop `fonts/TimesSquare-m105.ttf` into `fonts/`. The CSS registers it with `@font-face`.
- **Styling tweaks**: Override CSS variables in `MMM-Scores.css` or globally (e.g., `css/custom.css`). Useful variables include `--scoreboard-card-width-base`, `--scoreboard-team-font-base`, `--scoreboard-value-font-base`, `--scoreboard-gap-base`, and `--matrix-gap-base`.

Example:
```css
:root {
  --scoreboard-team-font-base: 30px;
  --scoreboard-value-font-base: 34px;
  --matrix-gap-base: 10px;
}
```

---

## Data Sources
Scoreboard data comes from league-specific feeds with fallbacks where needed.

- **MLB scores**: `https://statsapi.mlb.com/api/v1/schedule/games?sportId=1&hydrate=linescore` (date based on `timeZone`).
- **NHL scores**: Prefers `statsapi.web.nhl.com` endpoints with automatic fallbacks to the public scoreboard and REST feeds; the date adjusts for early-morning previous-day fetches.
- **NBA scores**: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard` for the selected date.
- **NFL scores**: Weekly schedules from `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=<YYYYMMDD>` aggregated across the current week; includes bye-week teams.
- **Men's Olympic hockey scores**: Primary `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-olympics/scoreboard?dates=<YYYYMMDD>` with resilient provider-chain hooks (`olympics.com`, IIHF, TheSportsDB, Wikipedia/Wikidata finals) and last-good-data fallback.
- **Women's Olympic hockey scores**: Primary `https://site.api.espn.com/apis/site/v2/sports/hockey/womens-olympics/scoreboard?dates=<YYYYMMDD>` with the same provider-chain/fallback architecture.

---

## Troubleshooting
- **Header font changes unexpectedly**: Remove broad overrides like `.module.MMM-Scores * { font-family: 'Times Square' !important; }` so the MagicMirror header keeps its default font.
- **Font not loading**: Confirm `fonts/TimesSquare-m105.ttf` exists and is readable. CSS references it with `url('fonts/TimesSquare-m105.ttf')`.
- **Logos missing**: Ensure filenames exactly match the abbreviations used in game data (case-sensitive per league). Missing files fall back to text labels.
- **"Cannot find module 'node-fetch'"**: Upgrade to Node.js 18+; the helper relies on the built-in `fetch`.
- **CSS 404s for `/css/custom.css`**: Only reference `css/custom.css` if the file exists to avoid MIME errors.

---

## License
MIT License. See [LICENSE](LICENSE) for full text.
