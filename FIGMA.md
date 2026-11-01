# Figma

Design source of truth for Tachivel (Indegene org):
https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy

Variables mirror `styles/tokens.css` one-to-one: the **Color** collection has the roles
(`bg`, `surface`, `surface-2`, `border`, `text`, `text-muted`, `accent`, `accent-contrast`,
`word`, `success`, `warning`, `danger`) with modes **Ember / True Dark / Light**; **Structure**
has `space/1–9` and `radius/sm|md|lg|full`. Change a token in both places or neither.

## Pages

| Page | What's there |
|---|---|
| As-is | Screenshots of the app as of 2026-10-21, plus the five UX problems they show |
| Tokens | (variables live on the file, not on this page) |
| Directions | Components kit (top) and three redesign directions, one row each |

## Directions

**Decision (2026-10-21): Direction A (Rail)**, with C1's "Continue listening" hero on the
library page and a Page width control (Narrow 56ch / Standard 66ch / Wide 84ch) in the
Aa panel. The text column never stretches to fill the screen; collapsing the panel adds
margin, and the reader picks the width.

No hard edges: no hairline borders between rail, panel, page and control bar. Panels melt
into the page with a short gradient. Rail, panel and control bar share `--surface` (a shade
darker than the page), and the page darkens into the bar over a ~28px band (20px on phone) instead of meeting it at
a line. The library hero has no box, just a blurred glow of the cover.

| Frame | Node |
|---|---|
| Components | [3:2](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=3-2) |
| A1 Rail, panel open | [5:61](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=5-61) |
| A2 Rail collapsed, Standard width + Aa panel | [5:192](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=5-192) |
| A2b Rail collapsed, Wide width | [14:805](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=14-805) |
| A3 Rail, library with hero | [7:258](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=7-258) |
| A4 Phone, chapters sheet | [7:340](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=7-340) |
| A5 Novels/Comics switch, Comics placeholder | [20:814](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=20-814) |
| A6a World tab, Characters | [32:802](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=32-802) |
| A6b World tab, character with two forms | [32:870](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=32-870) |
| A6c World tab, Maps | [32:902](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=32-902) |
| A6d Phone, World sheet | [32:932](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=32-932) |
| B1 Stage, reading | [8:366](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=8-366) |
| B2 Stage, Navigator search | [8:416](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=8-416) |
| B3 Stage, Navigator library | [8:514](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=8-514) |
| B4 Phone, reading | [9:466](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=9-466) |
| B5 Phone, Navigator | [9:517](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=9-517) |
| C1 Shelf, home | [10:522](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=10-522) |
| C2 Reading, Listening drawer | [11:557](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=11-557) |
| C3 Reading, chapters drawer | [11:673](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=11-673) |
| C4 Phone, home | [10:602](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=10-602) |

## v2 · Server Tachivel (2026-11-01, awaiting pick)

Extends Direction A for the Oracle move: a Comics mode over Suwayomi, plus upload / replace for novels.
New local components are in **Components · v2**
([42:805](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=42-805)):
- 14 stroke icons;
- Category chip;
- Comic card (unread and downloaded badges);
- Comic chapter row (Default / Read / Selected, with select mode and a status icon);
- Series row (Updates and Downloads).

| Frame | Node |
|---|---|
| V1 Comics library | [43:815](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=43-815) |
| V2 Series page, selecting chapters to download | [43:1166](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=43-1166) |
| V3 Reader, webtoon | [45:1186](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=45-1186) |
| V4 Updates | [45:1239](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=45-1239) |
| V5 Downloads queue (Cloudflare retries, 30 GB meter) | [45:1436](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=45-1436) |
| V6 Novels library, replacing a book with a newer copy | [46:1409](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=46-1409) |
| P1 Phone, Comics library | [48:1422](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=48-1422) |
| P2 Phone, series selecting | [48:1617](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=48-1617) |
| P3 Phone, reader webtoon | [48:1739](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=48-1739) |
| P4 Phone, reader paged and reader settings | [48:1778](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=48-1778) |
| P5 Phone, Updates | [48:1818](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=48-1818) |

Figma gotcha: a paint bound to a color variable ignores paint-level `opacity`, so it renders at 100%. Put the opacity on the node instead.

## Round 2 · every Suwayomi feature, three devices (2026-11-01, awaiting approval)

Devices: laptop 1440×900 (L), iPad 10th gen 1180×820 landscape / 820×1180 portrait (I), iPhone 13 Pro Max 428×926 (P1–P5 resized, M).

**New themes (Figma Color modes):** Snow, Midnight, Moss, Plum, alongside Ember, True Dark and Light. They exist in Figma only so far; add the same values to `styles/tokens.css` when building (both places or neither).
New components: 26 more icons, Toggle (On/Off), List row (monogram/icon, sub, value, button, toggle, chevron).

Theme board: [53:1895](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=53-1895)

| Laptop | Node |
|---|---|
| L1 Browse, sources | [55:3392](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=55-3392) |
| L2 Source catalogue + filters | [55:3633](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=55-3633) |
| L3 Global search | [55:3939](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=55-3939) |
| L4 Extensions + repos | [55:4163](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=55-4163) |
| L5 History | [57:3735](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=57-3735) |
| L6 Migrate | [57:3905](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=57-3905) |
| L7 Library display / sort / filter | [57:4204](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=57-4204) |
| L8 Library select mode | [57:4421](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=57-4421) |
| L9 Chapter + series menus | [57:4741](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=57-4741) |
| L10 Categories + tracking | [57:5036](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=57-5036) |
| L11 Settings, appearance + themes | [60:5050](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=60-5050) |
| L12 Settings, library, categories, downloads | [60:5438](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=60-5438) |
| L13 Settings, backup (Tachimanga import), tracking, server | [60:5957](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=60-5957) |
| L14 Reader two-page spread + full reader settings | [60:6466](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=60-6466) |

| iPad 10th gen | Node |
|---|---|
| I1 Library (landscape) | [61:5847](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=61-5847) |
| I2 Series page (landscape) | [61:6138](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=61-6138) |
| I3 Source catalogue + filters (landscape) | [61:6356](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=61-6356) |
| I4 Reader two-page spread (landscape) | [61:6745](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=61-6745) |
| I5 Reader webtoon (portrait 820×1180) | [61:6770](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=61-6770) |
| I6 Settings + themes (landscape) | [61:6596](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=61-6596) |
| I7 Novel reader (landscape) | [61:6807](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=61-6807) |

| iPhone 13 Pro Max | Node |
|---|---|
| M1 Browse sources | [62:6716](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=62-6716) |
| M2 Source catalogue | [62:6898](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=62-6898) |
| M3 Catalogue filters sheet | [62:7051](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=62-7051) |
| M4 Global search | [62:7164](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=62-7164) |
| M5 Extensions | [62:7304](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=62-7304) |
| M6 History | [62:7470](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=62-7470) |
| M7 More | [62:7590](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=62-7590) |
| M8 Library filter / sort / display sheet | [63:7287](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-7287) |
| M9 Library select mode | [63:7435](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-7435) |
| M10 Chapter long-press actions | [63:7632](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-7632) |
| M11 Migrate | [63:7866](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-7866) |
| M12 Settings | [63:7988](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-7988) |
| M13 Appearance + themes | [63:8167](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-8167) |
| M14 Download queue | [63:8269](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-8269) |
| M15 Series categories + tracking | [63:8357](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=63-8357) |

Figma gotchas learned: layers hidden by a component boolean are absent from `instance.children`, so guard lookups; `appendChild` returns nothing, so don't chain it.
