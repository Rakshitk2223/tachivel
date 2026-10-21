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
| B1 Stage, reading | [8:366](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=8-366) |
| B2 Stage, Navigator search | [8:416](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=8-416) |
| B3 Stage, Navigator library | [8:514](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=8-514) |
| B4 Phone, reading | [9:466](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=9-466) |
| B5 Phone, Navigator | [9:517](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=9-517) |
| C1 Shelf, home | [10:522](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=10-522) |
| C2 Reading, Listening drawer | [11:557](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=11-557) |
| C3 Reading, chapters drawer | [11:673](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=11-673) |
| C4 Phone, home | [10:602](https://www.figma.com/design/OfphbBo5TU6i8dy6WZomsy?node-id=10-602) |
