# Project: Opal

A desktop app for reading and editing the Markdown pages in a folder on disk.
Pages come first. There is no chat and no Today screen: "Daily" opens a
stream of daily pages at the day's page (`Library/daily/YYYY-MM-DD.mdo`, or
`.md` for older days and Obsidian's), the earlier ones below it and pages
made for later days above it, creating the day's page as a `.mdo` from the
vault's template when the date has none. A date with both files shows both,
the document first. Activity logs
are separate, read-only files in `Library/logs/`. Until the cleanup commit,
Daily opens an existing `Inbox/Logs/YYYY-MM-DD.md` when the daily page does
not exist.

## Stack

- **Runtime:** Electron 31 (main + preload + renderer processes)
- **Frontend:** React 18 + TypeScript + Tailwind CSS
- **State:** Zustand for global state, React hooks for local state
- **Editor:** CodeMirror 6; the file's Markdown body is the document, so
  untouched bytes never change (`components/editor/` in `disk-explorer`)
- **Storage:** the user's folders are the store; authored metadata lives in
  frontmatter or `.opal.yaml` sidecars; personal state (activity)
  lives under `<userData>/library/` as JSON
- **Build:** Vite (3 configs: main, preload, renderer) + Electron Forge
- **Testing:** Vitest + Testing Library + Happy DOM
- **Linting:** ESLint with TypeScript plugin
- **Pre-commit:** Husky + lint-staged (ESLint fix + the full vitest suite)

## Architecture

- **Vault days:** `src/main/vault/` knows the vault layout. `VaultService`
  creates the daily page and ticks a digest's checkboxes
  (`vault:check-digest-item`, one line through the editor's write queue);
  `DayService` answers `vault:day` with a day's page,
  log, documents (the files its log links to), chats, recordings, people
  (person notes the log links to, and meeting speakers who have one) and
  digest, and sends `vault:day-changed`. The parsing
  is in `src/common/dayModel.ts`
- **Touched list:** each daily page in the stream shows, under its text, a
  link to the day's digest and up to eight things the agent turns of that
  day's log linked to, with a square per day of its week.
  `TouchedService` (`vault:touched-week`, `vault:touched-changed`) reads a
  week's logs through `DayService.logEntries`, plus the optional
  `.opal/touched.json` (groups and ignores) and `.opal/link-titles.json`
  (titles of issues, PRs and Google Docs), which Opal never writes; the
  watcher reports those two files and `.opal/hidden.json`. The rules are in
  `src/common/touchedModel.ts`, the view in `stack/TouchedList.tsx`. Its
  palette, `stack/touchedPalette.css`, is the only hued colour in the app,
  exempted by name in `blackAndWhite.test.ts`
- **Daily test:** an A/B test an agent writes as
  `Library/tests/<date> test.json`; Opal only reads it and writes
  `<date> answer.json` beside it in one step. The parsing and the "which test
  is current" rule (the newest unanswered test of today and the two days
  before, else today's answered one, else none) are in
  `src/common/dailyTest.ts`. `TestService` in `src/main/vault`
  (`vault:test`, `vault:test-changed`, `vault:answer-test`) checks every path
  a test names against `RootRegistry`, so a hidden or outside file makes it
  no test. `TestCard.tsx` sits at the top of the day sidebar. An interface
  test switches a variant: both versions ship in one build, the names this
  build knows are listed in `src/common/variants.ts`, and a component reads
  its side with `useVariant(name)` (`features/variants`). The side per
  variant is per Mac, in `<userData>/variants.json` (`vault:variants`,
  `vault:set-variant`). Adding a variant is one line in `VARIANTS` plus the
  branch in the component. A variant listed in `ROOT_VARIANTS` has no branch:
  its B is token values under `data-<name>` on the document root
  (`rootVariants.ts`, mirrored to localStorage for the pre-paint script).
  `roomy` is one; `docs/design-tokens.md` lists its values
- **IPC bridge:** Main <-> Preload <-> Renderer via context bridge
  - Exposed APIs: `systemAPI`, `credentialAPI`, `diskAPI`, `activityAPI`,
    `collectionsAPI`, `markdownAPI`, `vaultAPI`, `pinsAPI`, `filesAPI`,
    `hiddenAPI`, `updatesAPI`, `agentAPI`, `autoAPI`
- **Pins:** each opened folder keeps its pinned files in `.opal/pins.json`
  (paths from the folder's top), so git syncs them across Macs. `PinsService`
  in `src/main/pins` reads and writes it (`pins:list`, `pins:set`, which
  keeps what the file gained or lost since the renderer read it);
  `pinsStore` in `disk-explorer` follows renames, moves and Move to Trash
  through `pathMutationCoordinator`, and `PinnedSection` shows the pins
  under the sidebar's nav
- **Files:** pages embed files by their path from the vault's top. `src/main/files`
  copies a dropped, pasted or picked file into the folder `.opal/files.json`
  names (`files/` when there is none) as `YYYY-MM/<stem>.<hash>.<ext>`, turning
  HEIC and TIFF into JPEG and scaling large photos with `sips`. Its `git-lfs`
  store reads Git LFS placeholders: `opal-file://` serves their bytes from
  git's object store, and Download runs `git lfs fetch` for one file. Opal
  never writes LFS files into the working tree. In the editor,
  `imageInsert.ts` takes files dropped or pasted on any page and
  `imageFrame.ts` selects and resizes a document's images
- **Documents:** every page that takes edits is edited in doc mode
  (`docMode.ts` in the editor folder): the page editor with its Markdown
  always hidden and the caret kept out of hidden marks, typing as in a word
  processor. `editingSetup(path)` in `editorSetup.ts` names the three
  setups: a `.mdo` is a `document`, with the toolbar (`DocToolbar.tsx`) and
  a click on a link editing it; a `.md` is a `note`, the same editing with
  no toolbar and a click on a link following it (`followLinkClicks`); the
  read-only log pages are `plain`. The formatting commands are in
  `formatCommands.ts`; each writes only the marks it needs
- **Lists:** `listKeys.ts` has Tab, Shift+Tab, Enter and Backspace in
  lists. `listNumbers.ts` is a transaction filter that runs last: an edit of
  the person's own that changes a list's items (a line break, or the marks
  that open an item) rewrites the numbers of the lists it touched, in the
  same transaction, so one undo takes both back; a list keeps its first
  number, and text from the disk, undo and redo keep their bytes. Nested
  levels are drawn 1, a, i (`levelNumeral`) while the file keeps digits.
  A number that grows a digit indents the lines nested under its item, so
  they stay inside it. Markdown reads a line of text right under an item as
  more of that item, an empty item under text as its heading underline and
  a number past 1 under text as text. So `listEdges.ts`, a filter that runs
  just before the numbering, writes a blank line wherever an edit of the
  person's own leaves a list line touching a line of text, and
  `livePreview.ts` gives a single blank line between a list and text no
  room, on either side (`listGaps`), the caret stepping over it. Lines that
  already touched before the edit stay as written. Backspace at an
  item's start takes three steps: marker off, text to the margin, text
  joined to the item above. Paste reads the clipboard's HTML into Markdown
  (`pasteHtml.ts`), and pasted lines become items (`clipboard.ts`). The
  rows a word processor is compared on, with the differences kept on
  purpose and why, are in `e2e/acceptance/doc-parity-rows.mjs`
- **Feature-based structure:** Self-contained modules under `src/renderer/features/`
  (`disk-explorer` is the Files feature; `shell` is the workspace frame;
  `day-sidebar` is the right sidebar, one vault day beside the page)
- **Stacks:** a tab can show several Markdown files in one scroll, each its
  own editor that saves and merges on its own (`components/stack/`). The
  main process lists the files (`StackService`, `vault:stack`); `canonical()`
  in the tabs store decides by path which opens become stacks. Three kinds:
  the stream of daily pages, a recording (the summary file, then
  `transcripts/<stem> transcript.md`) and a chat (the thread card, then its
  sessions, newest first). Sections near the view have a live editor and the
  rest are placeholders. Daily, and any stack that holds a `.mdo`, has one
  `DocToolbar` above its scroll (`StackToolbar.tsx`), for the document that
  last had focus and grey while a note has it. A section's undo history
  stays while its editor is away
- **Main area:** each tab shows one file, a stack or Recent. Markdown opens in the
  editor; other files open in a minimal viewer (`FileViewer`: images, PDFs,
  plain text, otherwise "Open in default app"). There is no folder view:
  folders are browsed in the sidebar tree, which also holds the file actions.
  The tree shows `Library/daily` by year ("2026", then "10-30 Fri"); the
  year rows are not folders on disk (`src/common/dailyTree.ts`)
  A page's footer line ("N properties · N words") toggles a read-only
  properties block under the title: the frontmatter, then the file's path,
  times and size from `markdown:properties`
- **Links in:** `opal://open?path=<path>` (relative to the vault, or
  absolute) opens that file in a new tab, or switches to the tab showing it.
  macOS hands the link to `open-url`; `OpalLinks` in `src/main/protocol`
  checks it against the allowed roots and holds it until the renderer's
  `PageLinks` listens. The scheme is declared in `packagerConfig.protocols`,
  so only a packaged build receives links
- **Allowed roots:** `RootRegistry` in `src/main/fs` is the security boundary;
  every path that crosses IPC is resolved and checked against opened folders
- **Hidden files:** each opened folder lists its hidden files and folders in
  `.opal/hidden.json` (paths from the folder's top; a folder hides everything
  under it). `HiddenFiles` in `src/main/fs` reads it (the watcher reports it),
  merges on write, and follows Opal's renames, moves and Move to Trash from
  `FileWriter`. Hidden on every launch; Shown only after `promptTouchID`,
  until Hide Hidden Files, a lock or sleep, or quit. The state lives in main.
  While Hidden, `RootRegistry.assertAllowed` refuses a hidden path with
  `HiddenPathError` (IPC answers carry `hidden: true`, the protocol 403) and
  `listChildren` skips it, so walkers leave it out. The link and collection
  indexes use `seeingHidden()` and filter per answer, so toggling needs no
  rescan; the day sidebar, touched list, stacks and pins filter with
  `blocked()`. Saves of typed text may reach a hidden file, so nothing typed
  is lost when a file becomes hidden. The renderer's `hiddenStore` only
  knows which of its own tabs are hidden, to show "This file is hidden."
  without naming them. `OPAL_TEST_TOUCH_ID` stubs the prompt only in an
  unpackaged run under `OPAL_TEST_USER_DATA_DIR`
- **Updates:** `src/main/updates/`. The build knows its short commit and
  build time (`__OPAL_BUILD__`, defined in `vite.main.config.ts`, also
  written to `.vite/build/build-info.json`). `UpdateService` reads the
  sources listed in `<userData>/updates.json` only (folders or https), shows
  "Update ready" above Settings (`features/updates`) when one offers a later
  build with another commit, and installs by checking the zip's sha256 and
  bundle id, starting the detached helper from `helperScript.ts` and quitting
  through the normal close path. The helper swaps the bundle, keeps two
  `Opal-update-*` copies in `~/Library/Caches/Opal-app-backups/` and reopens
  Opal. Palette: Install Update, Check for Updates, Roll Back to Previous
  Build. `scripts/stage-update.mjs` stages a packaged build in a source;
  `docs/local-app-install.md` has the steps
- **Comment:** select text in a page and press Cmd+Shift+M (or Comment in
  the palette and the Edit menu) for a box under the selection; Enter saves
  the page, waits for the write, and starts one run of the user's own Claude
  Code (`claude -p --output-format stream-json`) in the page's opened folder.
  The run edits the file on disk and the outside-edit merge brings it in.
  `AgentService` in `src/main/agent` finds the command (`command` in
  `<userData>/agent.json`, then `~/.local/bin/claude`, then the login
  shell's PATH), checks `auth status`, asks once per folder (the yes is kept
  in `agent.json`'s `folders`), and passes on nothing named `ANTHROPIC_*`,
  `CLAUDE_CODE_*` or `CLAUDECODE`. A folder can never name the command. A
  run ends at its first `result` line; its process stays tracked until it
  exits, so quitting still ends it. A disk edit that reaches a page while
  one of its runs is going, or under 3 s after one ended (`runTouches`),
  is one undo step; every other disk edit stays out of undo. The rules and the stream reader are in
  `agentModel.ts`. In the renderer, `features/comment` keeps the box and
  each comment's place (where its selection starts) in the editor's state
  (`commentEditor.ts`); comments on one visual row share one mark, drawn in
  a CodeMirror layer in the page's left padding. Marks live in memory only;
  `useCommentSync` listens for run ends from the window's start. Code says
  "agent" and "comment"; "Claude Code" appears only in messages. Tests and
  acceptance runs use `src/tests/fixtures/agent/fake-agent.mjs`; under the
  test profile `OPAL_TEST_AGENT_HOME` and `OPAL_TEST_AGENT_PATH` keep the
  lookup away from a real install
- **Auto:** a tab (the sidebar's Auto row, under Recent) that is a screen
  for a service on another machine that runs agent threads. Opal holds no
  sign-in and starts no run itself; it reads, answers, starts, stops,
  snoozes (to a time, or until someone replies), reorders, marks, archives
  and brings back threads through the service's HTTP API, and works through
  the day's digest as a queue (resolve, note, make a thread, archive the
  day). No control in it starts or confirms a send to anyone; a drafted
  reply can only be copied. A send the service asks him to allow up front
  (a `grant` question) shows as his phone draws it, the title, the exact
  words and the detail, with one button, "No": the yes is signed on his
  phone, and `mayAnswer` (`questionModel.ts`) keeps every answer to one but
  the plain no from being posted, whatever built it. The service reads no
  words with that no, so words typed while one waits post the no first and
  then go to the thread as an ordinary message; if the no is not taken
  they stay in the box.
  `AutoService` in `src/main/auto` makes every request, since the page's
  policy allows it no network. The address comes from `<userData>/auto.json`
  alone (`{ "version": 1, "url": "https://host.example/agent" }`; https, or
  http for a loopback host; a folder can never set it). The page names one
  of a fixed list of routes (`autoRequests.ts`), each rebuilt field by field
  into a fixed path, with thread ids and cursors checked first; requests
  carry a time limit and a size limit and follow no redirect. Two streams
  (`sseReader.ts`): the list's whenever an address is set, with a tab open
  or not, so the sidebar counts what needs him (it holds back no ping), and
  one thread's only while the tab is in view (an open one does), each
  opened again after a wait from its last cursor, and read again from
  scratch on a `reset`. Every answer is read into
  Opal's own shapes by `src/common/autoModel.ts`, which drops what does not
  fit. In the renderer, `features/auto`: `listModel.ts` (the list's groups,
  set in one place: "For the Mac" for threads the service says are marked,
  then the ones that wait on him, then the ones new to him (an unread
  reply, back from snooze), then the rest in his order; the line over the
  list, "1 needs you, 2 new"; a row's line, with "Your move: …" for a
  thread the service says is his and "Not started" for one nobody has
  started; a thread at work says how long it has been working in its time
  slot; and the snooze choices), `awayModel.ts` (the words for what is put
  away, which are the phone's: "Waiting on Sam until Tue 5:00 pm", "Returns
  tomorrow 9:00 am", "Archived Nov 12.", "Sam replied: …", "No reply from
  Sam.", and when a wait gives up), `threadModel.ts` (a thread
  reduced from its snapshot and events), `outbox.ts` (a message is kept
  until the service has it; a failed one returns to the box), `digestModel.ts`
  and `digestStore.ts` (the queue: Left and All, the day shown, and every
  write answered with the day as it is now), `pane.ts` (the one piece of
  state for what is open beside the list: a thread, a new thread, the queue
  or nothing), and `markdown/` (replies and digest entries parsed with
  `@lezer/markdown` and drawn as elements, never as HTML). The service ends
  the Mac mark and says when a digest changed; Opal only follows. It never
  calls the service's tick or inbox routes. What is put away sits behind
  three quiet lines at the foot of the list, each opened by a click:
  "Waiting on a reply" (a thread whose `wait` is still open; `toWait` in
  `autoModel.ts` reads it: the place is the service's own word, kept as a
  short line of plain text and never matched to a list; the link opens
  only when it is a web address, so a chat's id or a text's number never
  does; and whether the wait is over is the service's `state` alone, never
  the clock), "Snoozed", and "Archived", which carries no count and reads
  `GET /api/threads?archived=1` when it opens, the newest ten and then all
  (`archive` in `autoStore.ts`); archived digests are listed first there.
  One verb, "Bring back", returns anything from any of them: on its row,
  above the box of the open thread, on E for an archived row, and in the
  palette. A thread from a digest entry starts with his words: "Thread" and
  T open the entry with the caret in its box, and nothing is made until he
  sends them or picks "Make it without words". `store/actions.ts` holds what he
  does to a thread (archive, done, snooze, bring back): the row leaves at once, the
  next thread takes its place, and the row returns with the service's
  sentence if the post fails. A put-away says what it did in the phone's
  sentence ("Snoozed until tomorrow 9:00 am.", "Waiting on a reply until Tue
  5:00 pm." and then who Auto found, "Archived: <title>", "Back in the
  list."). Undo leaves nothing behind: of a Done it also opens the digest
  entry again, of a snooze it moves the thread back where it sat
  (`heldPlaces` keeps the row there until the move has landed), of an
  archive it sets the Mac mark again. An option picked on a row is held four
  seconds before it is posted, so it can be taken back. What an action did
  is said in one line at the foot of the list (`saidStore.ts`,
  `SaidBar.tsx`), name first, never in the app's corner toast. Undo is on
  offer from the moment the row or entry leaves, for 30 seconds, ten
  actions deep, newest first; a reversal is posted only after the action's
  own post has landed, and the offers go with the address. Until those
  posts have landed, what he did is laid over every copy of the thread or
  the day that arrives (`model/unconfirmed.ts`), so the service's own word
  of an archive he has taken back does not take the row away again. The last view of each thread and his place in each
  thread, the list and the queue are kept in memory for the session
  (`threadStore.ts`, `model/places.ts`) and dropped with the address. The
  list and the queue are each one Tab stop with a roving focus
  (`components/focus.ts`); single keys act only on a focused row or entry,
  and Cmd+. and Cmd+Z act only while the tab is in front with the keyboard
  in it. In a field, Cmd+Z is the field's own undo while it holds text and
  takes the last action back when it is empty. While a question waits, the box is its answer field,
  except for words begun before the card arrived (`earlier` in
  `threadStore.ts`): those go as the message they were begun as, and the
  box becomes the answer field once it has been emptied. Words typed after
  every part of a several-part question has its pick follow the picks as an
  ordinary message. A page's
  header, its scrolling part and its foot each hold an `.auto-column`, so
  they share their edges at every width. `useAutoCommands.ts` puts Auto's
  commands and every thread's title in the palette, archived ones too once
  the archive has been read. A vault path in a step,
  a reply or an entry is looked up by `autoPages.ts` through `RootRegistry`
  and opens as a page in its own tab; a page opened while the Auto tab is
  in front goes to the tab that shows it or to a new one (`tabsStore.ts`),
  never into the Auto tab. Tests and `auto-acceptance.mjs` talk only
  to the stand-in service in `src/tests/fixtures/auto`, on 127.0.0.1
- **Path alias:** `@/*` maps to `src/*`

## Directory Structure

```
src/
  main.ts              # Electron main process entry
  preload.ts           # IPC bridge
  renderer.tsx         # React entry point
  main/                # Main process
    fs/                # Roots, listings, watcher, metadata, file mutations
    activity/          # Personal activity behind Recent
    collections/       # Disposable index of file names behind the palette's file search
    library/           # The <userData>/library layout
    services/          # Credentials, system
    window/            # Window state, navigation guard
  renderer/            # React renderer
    features/          # disk-explorer, shell, day-sidebar, auto, variants, settings, theme, commands
    shared/            # Reusable components, hooks, utils, types
    store/             # Zustand stores
    styles/            # Global CSS
  types/               # Shared contracts (disk, metadata, activity, queries)
  common/              # Renderer-safe shared logic (validation, paths, formatting)
  tests/               # Vitest tests
e2e/                   # Playwright Electron suite and acceptance scripts
```

## Commands

- `npm run dev` — Start in dev mode (Electron Forge)
- `npm run lint` — Run ESLint
- `npm test` — Run unit and contract tests
- `npm run test:watch` — Tests in watch mode
- `npm run test:coverage` — Tests with coverage report
- `npx tsc --noEmit` — Type check without emitting
- `npm run package` — Package the app
- `npm run make` — Build distributable

## Testing

**One rule: test at the cheapest tier that can actually fail.**

| Tier | Scope | Runs |
|---|---|---|
| Unit (vitest) | Anything not requiring a live Electron process | pre-commit + CI |
| Contract (vitest) | Cross-process agreements no single unit can verify | pre-commit + CI |
| E2E (Playwright) | Only what is impossible to verify any other way | CI + on demand |

Only five things genuinely require a real Electron process: the app boots,
`opal-file://` streams and decodes, CSP allows the custom scheme, IPC crosses
the process boundary, and the allowed-roots guard holds at the protocol layer.

**E2E budget: ≤10 tests, ≤60s.** Exceeding it means something is being tested at
the wrong tier. A component behaviour costs ~15ms as a unit test and ~4.5s
through Playwright — roughly 300× for identical confidence.

**Do not add visual regression tests.** Screenshot diffing is OS- and
font-dependent; its false failures destroy trust in the suite.

### Commands

- `npm test` — unit + contract (vitest).
- `npm run test:e2e` — builds the three Vite bundles, then Playwright.
- `npm run test:all` — both.
- `node e2e/acceptance/<name>-acceptance.mjs` — disposable acceptance runs against
  the built app; see `e2e/acceptance/README.md`.

### When a UI test fails

Traces and screenshots are captured on failure. Run
`npx playwright show-report` for a browsable DOM snapshot and timeline.

## Conventions

- Commit after completing each discrete task
- Don't ask for confirmation on file creation or refactors — just do it
- When creating new UI features, follow the feature-based structure under `src/renderer/features/`
- Filesystem work stays in main behind `RootRegistry`; the renderer never touches paths it has not been handed
- New IPC channels must be registered in `preload.ts`, exposed via the appropriate API namespace, validated in main, and typed under `src/renderer/shared/types/*.d.ts`
- Use Zustand for global state that spans components; use the prefs helpers for UI preferences
- Editor features are CodeMirror extensions that keep the text as written;
  never re-serialize a note
- Keep main process and renderer process code strictly separated
