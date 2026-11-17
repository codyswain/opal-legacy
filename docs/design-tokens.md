# Opal design tokens

`src/renderer/styles/index.css` is the token source of truth.
`tailwind.config.js` exposes those values to components.

Values marked **B** are version B of the `roomy` interface variant
(`src/common/variants.ts`), on while the document root carries `data-roomy`
(see "Version B: roomy" at the end). Everything else, and every A value, is
what ships by default. Both light and dark
themes define the same semantic roles independently; a component never chooses
a raw palette shade. The values follow the design brief drawn from Linear and
Bastion (`docs/product/2026-10-28-pages-first-ux.md`, "Look").

## Layout: chrome, ground and page

Three surfaces, darkest to brightest in light mode (Cody chose option 7 of the
colour sketch on 2026-10-29: option 1, with the top bar in the sidebar's
grey). The chrome colours both sidebars and the 40 px top row, so it runs
down the left, across the top and down the right as one frame. Below the top
row the page column is the ground, a step lighter, and the page sits in it as
a card: 8 px radius, a 1 px hairline ring, inset 8 px on the left, right and
bottom, whether the sidebars are open or not. The ground shows only as that
band. The right sidebar's cards are page-coloured cards on the chrome. There
are no rules between sidebar parts or under the top row; regions are told
apart by the steps between the three greys and by space.

In dark mode the ground is the chrome's colour, so there are two surfaces: one
frame and the page. A third dark between the sidebar and the page read as a
stray strip.

| CSS token | Tailwind | Light | Dark |
|---|---|---|---|
| `--chrome` | `bg-chrome` | #ececec; **B** #fdfdfd | #0b0b0b |
| `--ground` | `bg-ground` | #f5f5f5; **B** #fdfdfd | #0b0b0b |
| `--canvas` | `bg-canvas` | #ffffff | #1a1a1a |
| `--page-ring` | `border-page-ring` | #e2e2e2 | #282828 |
| `--radius-card` | `rounded-card` | 8 px | 8 px |
| `--page-inset` | `m*-page` | 8 px | 8 px |

The Electron window background (`WINDOW_BACKGROUND` in `src/main.ts`) is the
chrome colour, so the first frame matches; with `roomy` on B it is #fdfdfd in
light mode.

## Color

Black and white only (the spec, "Look"). Every token is a neutral grey from
white to black, including focus, selection and the primary button; the only
colour on screen comes from images inside notes. Emphasis comes from
contrast, weight, size and spacing. Errors and destructive actions use
wording, weight and an icon, never red.

`tailwind.config.js` sets the whole `colors` palette rather than extending
it, so Tailwind's hued defaults (`text-sky-500`, `bg-amber-500`) do not exist,
and its default ring colour is `--focus`. `src/tests/unit/blackAndWhite.test.ts`
fails if a token, a Tailwind colour or a renderer source file brings hue back.

### Surfaces

| CSS token | Tailwind | Use |
|---|---|---|
| `--surface` | `bg-surface` | Content on the page; same as the page |
| `--surface-raised` | `bg-surface-raised` | Menus, popovers, palette, dialogs: #ffffff / #242424 |
| `--surface-sunken` | `bg-surface-sunken` | Code blocks, table heads, wells: #f9f9f9 / #1f1f1f |
| `--surface-lift` | `bg-surface-lift` | The active tab pill, a selected segment: #ffffff / white 10.5% |
| `--surface-hover` | `bg-surface-hover` | Pointer hover: black 4% / white 3% |
| `--surface-active` | `bg-surface-active` | Pressed control: black 7% / white 5% |
| `--surface-selected` | `bg-surface-selected` | Current row or item: black 6.4% / white 7.8% |
| `--tab-active` | `bg-tab-active` | The active tab pill: `--surface-lift`; **B** light black 9% |
| `--tab-active-shadow` | `shadow-tab-active` | Its shadow: `--shadow-control`; **B** light none |

The selected overlay is set so a selected sidebar row is #dddddd on the light
chrome and #1e1e1e on the dark one, the sketch's values; on the page it is
#efefef and #2c2c2c. Hover on the chrome is #e3e3e3 / #131313, and on the
page #f5f5f5 / #212121. In dark mode the tab pill is #252525 on the chrome; at
white 10% Chromium renders it a channel off grey, so it is 10.5%.

Hover, active and selected are neutral overlays, not tints. They carry their
own alpha, so they take no Tailwind opacity modifier (`bg-surface-hover/50`
renders nothing). The shadcn alias `muted` points at the solid sunken surface
and does take modifiers.

### Borders and content

| CSS token | Tailwind | Use |
|---|---|---|
| `--border-subtle` | `border-border-subtle` | Hairline inside the page, the page ring (#e2e2e2 / #282828) |
| `--border-default` | `border-border` | Pane and row boundaries (#dcdcdc / #303030) |
| `--border-strong` | `border-border-strong` | Inputs, outline buttons, the hairline between tab pills (#d5d5d5 / #393939) |
| `--border-overlay` | `border-border-overlay` | Menus, popovers, tooltips, dialogs: black or white at 8% |
| `--text-primary` | `text-foreground` | Primary content (#262626 / #ededed) |
| `--text-secondary` | `text-foreground-secondary` | Sidebar rows, supporting text (#3f3f3f / #cbcbcb) |
| `--text-tertiary` | `text-foreground-tertiary` | Labels and metadata; the sketch's muted text (#6b6b6b / #8f8f8f) |
| `--icon` | `text-icon` | Icons and placeholders only (#878787 / #676767) |
| `--focus` | `ring-focus` | Focus ring: dark on light (#666666), light on dark (#b3b3b3) |
| `--primary` | `bg-primary` | The one filled button: near black with white text, inverted in dark mode |

The sketch set the text, muted text, border and selection; the rest are
derived from them. Secondary text is 64% of the text mixed with 36% of the
muted text, and the icon is the lightest grey that keeps 3:1 on the light
chrome.

Contrast, light on white and on the chrome / dark on the page and on the
chrome: primary 15.1 and 12.8 / 14.9 and 16.8; secondary 10.5 and 8.9 / 10.7
and 12.1; tertiary 5.3 and 4.5 / 5.4 and 6.1; icon 3.6 and 3.0 / 3.1 and 3.5;
focus 5.7 and 4.9 / 8.3 and 9.4. Text tokens meet 4.5:1 and the icon and
focus tokens meet 3:1 on both grounds.

Current items and selection use the neutral overlays above. Links in pages
are text-coloured with an underline. Do not use colour as the only state
indicator; there is none to use.

Text selection uses `--selection`: black at 12% in light mode, white at 20%
in dark mode.

The shadcn names (`background`, `card`, `muted`, `accent`, `border`, and
others) remain compatibility aliases while existing components migrate.

## Spacing

Use Tailwind's 4 px base with an 8 px common rhythm.

| Token | px | Use |
|---|---|---|
| `0.5` | 2 | Gap between sidebar and tree rows |
| `1` | 4 | Icon-to-label gap |
| `2` | 8 | Control padding, tight stacks, page inset |
| `3` | 12 | Grid gaps, space above a sidebar label |
| `4` | 16 | Pane padding |
| `6` | 24 | Section spacing in dialogs |

Avoid arbitrary values such as `p-[7px]`. If a recurring value is missing,
promote it to a named semantic token rather than repeating a literal.

## Typography

The UI font is Inter Variable, bundled through `@fontsource-variable/inter`
(opsz and wght axes), so the app never fetches fonts. The body sets
`font-feature-settings: "cv01", "ss03"` and `font-optical-sizing: auto`.
Monospace is `ui-monospace`, SF Mono, Menlo.

| Tailwind | Size / line height | Use |
|---|---|---|
| `text-metadata`, `text-2xs` | 11 / 14 px; **B** 12 / 16 | Counts, sizes, kbd hints |
| `text-label` | 12 / 16 px, weight 510 | Section and group labels |
| `text-control` | 12 / 16 px; **B** 13 / 18 | Dense secondary controls |
| `text-ui` | 13 / 18 px, -0.01em; **B** 14 / 20 | Rows, menus, buttons, default UI |
| `text-ui-heading` | 15 / 20 px; **B** 16 / 22 | Dialog and pane headings |

Weights come from Inter's variable axis: 400 regular, `font-medium` 510 for
nav items, active rows and buttons, `font-semibold` 590. Tree rows stay at 400.

Labels are sentence case. Never uppercase a label or widen its letter spacing.

Use `tabular-nums` for dates, times, sizes and counts.

`cn()` knows these size names, so `cn('text-ui', 'text-foreground')` keeps
both classes.

## Geometry and density

| CSS token | Tailwind | Default |
|---|---|---|
| `--control-height-compact` | `h-control-compact` | 28 px |
| `--control-height` | `h-control` | 32 px |
| `--row-height-compact` | `h-row-compact` | 28 px; **B** 32 |
| `--row-height` | `h-row` | 32 px; **B** 36 |
| `--header-height` | `h-header` | 40 px |
| `--sidebar-width` | `w-sidebar` | 260 px |
| `--reading-width` | `max-w-reading` | 720 px |

Sidebar and tree rows are `h-row-compact` (28 px; **B** 32) with 2 px
between rows; the tree's virtual list reads the token's height
(`useRootLength`). The tree indents 16 px per level; a folder's chevron sits
where a nav icon does, so top-level labels line up with Daily and Recent.

| CSS token | Tailwind | A | B |
|---|---|---|---|
| `--sidebar-inset` | `px-sidebar-inset`, `mx-sidebar-inset` | 8 px | 10 |
| (inset + 8 px) | `pl-sidebar-label` | 16 px, the group label's indent | 18 |
| `--sidebar-group-gap` | `pt-sidebar-group` | 16 px above Pinned and the tree | 20 |
| `--sidebar-icon-size` | `h-sidebar-icon w-sidebar-icon` | 16 px | 18 |
| `--sidebar-icon-gap` | `gap-sidebar-icon-gap` | 8 px | 10 |
| `--sidebar-icon-stroke` | `stroke-sidebar-icon` | 2 (Lucide units) | 1.5 |
| `--sidebar-label-weight` | `font-sidebar-label` | 510 (Daily, Recent, Settings) | 400 |
| `--sidebar-active-weight` | `font-sidebar-active` | 510 | 400 |
| `--sidebar-label` | `text-sidebar-label` | `--text-secondary` | light: `--text-primary` |
| `--sidebar-icon` | `text-sidebar-icon` | `--icon` | light: `--text-primary` |
| `--sidebar-selected` | `bg-sidebar-selected` | `--surface-selected` | light: black 9% |
| `--radius-sidebar-row` | `rounded-sidebar-row` | 6 px | 8 |
| `--sidebar-group-label-height` | `min-h-sidebar-group-label` | 16 px, the label's line | a row and its 2 px gap, 34 |
| `--sidebar-group-label-weight` | `font-sidebar-group-label` | 510 | 400 |

So a row's icon starts 17 px from the sidebar's edge and its label 40 px
(**B** about 20 and 46).

In both looks the tree and Threads keep a scrollbar gutter as wide as the
inset at all times, and their rows have no right margin, so the gutter
takes the inset's place: a marked tree row, a marked thread row and the
Daily or Pinned pill end at the same x whether or not either part scrolls.
The thumb still shows only while scrolling or hovered.
Daily's "+" uses `text-sidebar-icon`.

The frame's icon buttons (both sidebars' top rows and the tab row's "+")
are `IconButton variant="frame"` with `frame-icon` on the icon:

| CSS token | Tailwind | A | B |
|---|---|---|---|
| `--frame-icon` | `text-frame-icon` | `--icon` | light: `--text-primary` |
| `--frame-icon-size` | `frame-icon` | 16 px | 18 |
| `--frame-icon-stroke` | `frame-icon` | 2 | 1.5 |

A disabled one (Back with nowhere to go) keeps the buttons' 40% opacity.

The page column's top row is one `h-header` row: tab pills, New tab, and a
200 px search field. Pills are `h-control-compact` with `rounded-control`,
96 to 200 px wide, `text-ui`; the active pill is `bg-surface-lift` with
`shadow-control` at weight 510, the others take `bg-surface-hover` on hover.
Same-name tabs add their folder in `text-foreground-tertiary`. The search
field is `bg-surface-hover` and stays centred in the row until the tabs need
the room.
Recent sits in the page card in a `max-w-reading` column. Its day groups are
`text-label` titles in `text-foreground-tertiary`; its rows are `h-row` with
`rounded-row` and the neutral hover fill, the folder in
`text-foreground-tertiary` and the time right-aligned in `text-metadata`
`tabular-nums`.
Rows and controls may use the compact or default value, but features must not
invent their own density scale.

## Auto

Auto's list is the sidebar's Threads section; the Auto tab shows one
thing, the open thread, the queue or a new thread, in a `max-w-reading`
column, with no list of its own and no narrow layout of its own. A
pane's header, its scrolling part and what is under it each hold an
`.auto-column` (`auto.css`: `--reading-width` wide, 24 px of padding), so
the title, the text, the cards and the box share their left and right
edges at every width.

| CSS token | Tailwind | Value |
|---|---|---|
| `--text-reply-size`, `--text-reply-line` | `text-reply` | 14 / 21 px, in both looks |
| `--text-thread` | `.auto-ink` | #171717; dark keeps `--text-primary` |
| `--radius-composer` | `rounded-composer` | 16 px |
| `--shadow-composer` | `shadow-composer` | a soft shadow; dark adds a faint light edge |
| `--thread-row-height` | `h-thread-row`, `min-h-thread-row` | `--row-height-compact`; **B** 30 px (32 px apart with the gap) |
| `--text-aside-size`, `--text-aside-line` | `text-aside` | 13 / 18 px in both looks: a digest entry's words under its title |
| `--sidebar-time` | `text-sidebar-time` | `--text-tertiary`; **B** light `--text-secondary` |
| `--usage`, `--usage-track`, `--usage-bar-track` | inline styles in `UsageRing.tsx` | `--usage` is #407bd9 in both themes, the single colour exception besides the touched list, used by the plan usage ring and its bars only (`usagePalette.css`); the tracks are greys, #b3b3b3 / #575757 and #e6e6e6 / #3d3d3d |

A thread reads like a conversation in the Claude app (2026-11-15). A
message is in the interface typeface at `text-reply`. The thread, the
digest queue and the Put away page carry `.auto-ink`, which sets
`--foreground` to `--text-thread`: darker than pages in light mode, the
same in dark. Replies draw Markdown with the look pages have
(`features/auto/auto.css`), in em of the reply's size: a paragraph follows
the last by 11 px and a list item by 4 px; list text starts 34 px in, a
bullet is a dot of the text's colour 13 px in, and numbers are the text's
colour; inline code is a light grey chip with 4 px corners. His own
messages are `bg-surface-active` bubbles at the right with 16 px corners.
A turn starts 32 px below the last; within it his message, the folded line
and the reply sit 16 px apart. What Auto did is one folded line in
`text-reply` `text-foreground-tertiary`, always ending in a chevron.
Follow-ups are pills at the right: `text-reply`, a `border-border-default`
ring, full corners.

The box (`components/Box.tsx`) is one `rounded-composer` box as wide as the
column, with a `border-border-default` ring and `shadow-composer`
(`bg-surface-raised` in dark). Its words sit on top and grow with what he
types; a row at its foot holds the model at the left, and Stop and Send at
the right. Send is a 28 px circle: `bg-primary` with an arrow once there
are words, `bg-surface-active` with a grey arrow while there are none. The
digest entry's box is the same box, with Send alone in its row. A pane's
header (`paneHeader`) is `h-header` with a `border-border-subtle` hairline
under it the width of the pane, always drawn. A thread's title is a button
ending in a chevron that opens its menu (Bring back, Mark for the Mac,
Rename); Snooze, Done and Archive sit at the right.

Thread rows
are sidebar rows: `h-thread-row` at least, `rounded-sidebar-row`, the
sidebar's label weights and `bg-sidebar-selected` for the open thread, as a
page's row has. The first line is an icon-wide slot for the unread dot, the
title in `text-ui` (`font-semibold` when the thread needs him), and the
time in `text-metadata` `tabular-nums` `text-sidebar-time`; the second line, only when the
thread needs him, is `text-control` and lines up under the title. A row's
time slot is only as wide as its time. On hover and focus the actions sit
at the row's end, over the time or the end of the title, and the first
line fades out under them (`.auto-row-line`, as far in as
`--auto-row-hide`), so they sit on the row's own fill; the title is cut at
the same point either way.
A row's "Your move: …" and "Not started" are in `text-foreground`, as words
and never as a button; a row has no answer buttons. There is no line of
counts: the Threads heading carries one number, `text-metadata` in
`text-foreground-tertiary`, beside the New thread button, and in
`text-foreground` while Threads is folded. The section headings
(`SidebarFold.tsx`) are `h-row-compact` buttons in `text-label`
`font-medium` `text-foreground-secondary`, one step above the group labels
inside them ("For the Mac"), with a chevron that turns when the section
folds. Pinned pages sit right under "Library"; their "Pinned" label is for
screen readers only. They take their rows' height, and past eight they
scroll with the fade. Only a row the heading's count takes in has the
heavier title. The Digest row is the first row of Threads,
one line, with its count where a thread's time goes. Threads takes the
height its rows need, up to 70% of the room it shares with Library, and
scrolls inside that (`.auto-threads-scroll`): the scrollbar's gutter is
always kept and is `--sidebar-inset` wide, so no row moves when the rows
start to scroll, and a cut edge fades over 1.5rem, the bottom while more
is below and the top once scrolled. Cards (a question, a permission request, a send to allow)
are `rounded-xl` with a `border-border-default` ring and no fill. No
option of a question is filled: every one is an outline button, with its
number, 1 to 3, in `text-foreground-tertiary` beside it, shown only while
the card or the row has the keyboard, which is when the number picks.

What is put away is one `h-thread-row` row pinned at the foot of Threads,
"Put away" in `text-foreground-tertiary` with an archive icon and the count
of what is snoozed or waiting in `text-metadata`, marked like a page row
while its page or a thread opened from it shows. The Put away page is in
the queue's reading column: a `text-label` heading in
`text-foreground-tertiary` per group, rows with a `text-reply` medium
title, and at their right an outline "Bring back" button. A waiting row's
first line ("Waiting on Sam until Tue 5:00 pm") is `text-control` in
`text-foreground`, and what it waits for, where and what was last heard is
`text-control` in `text-foreground-tertiary` under it; an archived row adds
"Archived Nov 12." in the same quiet line. A thread back from a wait says
"Sam replied: …" or "No reply from Sam." in `text-foreground`. Above the
box of a thread that is put away, and at the foot of an archived digest, a
strip under a `border-border-subtle` hairline says so (`text-ui`, then
`text-control` in `text-foreground-tertiary`) with one outline button,
"Bring back".

The digest queue takes the thread's place, in the same column. A section's
name is `text-label` in `text-foreground-tertiary`. An entry is a
`rounded-row` with the neutral hover fill. Closed, it is a title line at
`text-reply` in medium weight and at most two lines of its words at
`text-ui` in `text-foreground-tertiary`; opened in place it takes
`bg-surface-sunken` and reads whole. Its actions have a column of their
own at the row's right (a line under the words in a pane under 520 px),
shown while the pointer or the keyboard is on the row. His note has a 2 px
`border-foreground` rule at its left.

What the last action did is one line at the foot of the list, in
`bg-primary` with `text-primary-foreground` and a `rounded-card` corner:
the name first, cut if it is long, then what happened, then Undo, and
"2 more" when Undo reaches further back. A put-away is one sentence in the
phone's words, whole ("Snoozed until tomorrow 9:00 am.", "Archived:" and
then the name); a refusal is the service's sentence, whole, and then a
shortened name. With the sidebar not shown the line sits at the foot of the Auto page
instead. A table or a code block that scrolls sideways fades at the edge
it is cut at (`[data-fade]`).

## Page headings

Page headings are in the page's serif, bold, in em of the 16 px body
(`editor.css`, `stack.css`).

| CSS token | Use | A | B |
|---|---|---|---|
| `--heading-title` | The page's title, a large stack title | 1.8 em | 1.6 |
| `--heading-1` | `#` | 1.8 em | 1.6 |
| `--heading-2` | `##` | 1.5 em | 1.3 |
| `--heading-3` | `###` | 1.25 em | 1.15 |
| `--heading-4` | `####` | 1.1 em | 1.05 |
| `--stack-title` | Each page's title in a stack, such as Daily | 1.5 em | 1.3 |

## Icons

Use 14 px icons inside dense rows and 16 px icons in controls and nav items.
Empty states are one line of `text-ui` in `text-foreground-tertiary`, with at
most one button and no icon. Icons inherit `currentColor` and default to
`text-icon`. Use opacity or semantic content color for hierarchy instead of
feature-specific blue, green, or gray classes.

## Radius and elevation

Radius and shadow communicate actual elevation. The page card has a ring, not
a shadow; a shadow means a thing floats.

| Token / utility | Value | Use |
|---|---|---|
| `rounded-sm` | 4 px | Kbd, chips, checkboxes |
| `rounded-row` | 6 px | Sidebar and tree rows, menu items |
| `rounded-control` | 6 px | Buttons and inputs |
| `rounded-card` | 8 px | The page card |
| `rounded-overlay shadow-overlay` | 8 px | Menus and popovers |
| `rounded-dialog shadow-dialog` | 12 px | Dialogs and the palette |
| `shadow-control` | | A lifted control on a track |

## Motion

| Token / utility | Duration | Use |
|---|---|---|
| `transition-hover` | 0 ms in, 150 ms out | Hover fill on rows, buttons, menu items |
| `--duration-quick` / `duration-quick` | 100 ms | Chevron rotation, small state changes |
| `--duration-overlay` / `duration-overlay` | 160 ms | Menus, popovers, dialogs |
| `--duration-disclosure` / `duration-disclosure` | 200 ms | Sidebar show and hide |

`transition-hover` makes the hover fill appear at once and fade out when the
pointer leaves. Menu items add `focus:duration-0`, because their highlight
follows focus. Use `ease-standard` (ease-out quad) by default and
`ease-emphasized` for the sidebar and palette. Never animate ordinary route
changes or virtualized row positions. The global reduced-motion rule collapses
nonessential animation and smooth scrolling when the OS requests it.

## Scrollbars

No scroll area shows a thumb at rest. While it scrolls, or while the pointer
is on its scrollbar, the thumb is a 6 px pill 3 px in from the area's outer
edge in `--scrollbar-thumb-hover` (black or white at 20%: #cccccc on the
light page, #484848 on the dark one), and it fades out about a second after
the last scroll (`shared/scrollbars/scrollbarVisibility.ts`).

## Theme preference

The user preference is `system`, `light`, or `dark`, chosen in Settings
(Appearance); renderer components always apply and report a resolved `light`
or `dark` value. The preference lives in the versioned `opal.theme` envelope.
The pre-paint script reads the same schema before React starts, preventing a
theme flash.

## Version B: roomy

`roomy` is a variant whose version B is only token values: a roomier
sidebar after a reference app's proportions, interface text one size up, and
quieter page headings. `:root[data-roomy]` sets the sizes in both themes;
`:root[data-roomy]:not(.dark)` sets the light colours (the frame, sidebar
labels and icons, the selected row, the tab pill), so dark mode keeps its
greys. Components read the tokens and never the attribute. The attribute is
put on the root by `features/variants/rootVariants.ts` from the variants
store, which mirrors the sides into `opal.variants` in localStorage; the
pre-paint script in `index.html` reads that mirror, so a launch on B paints
B from its first frame.

