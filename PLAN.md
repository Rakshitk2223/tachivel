# Tachivel — local EPUB listen-along reader

## What it is
A small app that runs on my Mac. It opens an EPUB and reads it aloud with the Mac's built-in voices.
As it reads, it highlights the current sentence and the current word, and it keeps going through
the whole book until I pause it.

## Why (context)
- I like listening to web novels (currently *I Shall Pursue Eternity*) while I follow the highlighted text.
- macOS options today:
  - **Option+Esc** (Speak Selection) reads only the text I've selected.
  - **Cmd+Esc** in Apple Books reads well with good highlighting, but stops at the end of each chapter (about 9 minutes). There's no setting to keep going through the whole book.
- Workaround I considered: merge the EPUB's chapters into large batches so each "chapter" lasts for hours. It works, but it's a hack and gives me no controls.
- So: build a small, dedicated reader with full controls.

## Requirements

### Must have
1. **Import an EPUB** by drag-drop or file picker. It's parsed locally and never uploaded anywhere.
2. **Continuous playback** from the current point to the end of the book, moving to the next chapter on its own and skipping empty pages (cover, images).
3. **Highlighting**: the current sentence is shaded, the current word is marked, and the page auto-scrolls to keep both in view.
4. **Controls**: play/pause, previous/next sentence, previous/next chapter, click any sentence to start from there, and a chapter list (from the EPUB's table of contents).
5. **Voice picker** listing the installed macOS voices, with Premium and Enhanced voices first.
6. **Speed** from 0.6× to 2.5×, applied from the current sentence.
7. **Themes**: light, warm low-light, and true dark. **Text size** adjustable.
8. **Remembers** the last book, my exact position (chapter and sentence), voice, speed, theme and text size.
9. **Keyboard**: Space to play/pause, ←/→ for sentence, Shift+↑/↓ for chapter, C for the chapter list.
10. **Go to chapter**: press G (or type in the sidebar box) and enter a number; typing words filters chapter titles.
11. **Search the book**: `/` opens a full-text search across every chapter; results show the chapter plus a snippet, and clicking one jumps to that sentence. The text is extracted once at import and cached in IndexedDB so searches are instant.

### Decisions (2026-10-19)
- Runs in a browser tab; Safari preferred (Chrome works, but it cuts off long sentences).
- Look: **Ember focus**, a warm dark theme with the sidebar always visible. Sentences other than the current one fade back; the current word gets an ember underline. Mockups: https://claude.ai/artifact/2KBkT1qp64GihqLLSkGf1u
- Test book: `~/doc nov/novel/I Shall Pursue Eternity/epub/I-Shall-Pursue-Eternity.epub`
- Chapter list grouped by Book → Arc from the EPUB's nested table of contents (arcs fold; the current one opens).
- Illustrations shown inline where the book puts them, plus an **Images** sidebar tab that jumps to each one. A caption that just repeats the picture's alt text is shown but not read aloud. Scene breaks (`<hr>`) show as `∗ ∗ ∗` and aren't read.
- Every word is spoken: verified 268,299 / 268,299 words, same order, all 159 sections.
- Runs on port **47613** via the `tachivel` command (`~/.local/bin/tachivel` → `Tachivel.command`); `tachivel stop` shuts it down.

### Nice to have (later)
- A sleep timer (stop after N minutes or at the end of the chapter).
- A library of several books, each with its own saved position.
- Media keys and the macOS Now Playing widget (via the Media Session API).
- A pronunciation fix list for cultivation terms (e.g. "Qi" → "Chee", made-up names).
- Bookmarks.
- Export the audio to an M4B audiobook using the macOS `say` command, for listening away from the Mac.

## Constraints and known limits
- **Voices:** the browser's built-in speech feature (Web Speech API) can use any voice installed in
  System Settings → Accessibility → Spoken Content → System Voice → Manage Voices. Downloading a
  **Premium** voice (e.g. Zoe, Ava, or Evan, Premium) is strongly recommended.
- **The Siri voice that Apple Books uses isn't available to third-party apps.** A Premium voice is the closest substitute.
- **Use Safari.** Chrome only offers the macOS voices through a weaker path, and cuts off long sentences mid-speech.
- The app is a browser tab: if the tab is closed, reading stops. Background audio with the tab hidden works in Safari as long as the tab stays open.
- No DRM: this only works with EPUBs that aren't copy-protected.

## Approach / architecture
- **A single static page** (`index.html` + one small JS file), no build step and no backend.
- **EPUB parsing:** an EPUB is just a zip file. JSZip (pinned to a version, with an integrity check) opens it; the code then reads
  `META-INF/container.xml` → the OPF (book metadata plus spine, i.e. the chapter order) → the chapter titles from `nav.xhtml` (EPUB3) or `toc.ncx` (EPUB2).
- **Text extraction:** for each chapter, take the paragraph-level blocks (`p, h1–h4, blockquote, li`), collapse whitespace, then split
  into sentences with `Intl.Segmenter`. Each sentence is wrapped in a span so it can be highlighted.
- **Rendering:** only the current chapter is drawn on the page, so books with 1000+ chapters stay fast.
- **Speech:** queue one sentence at a time with `speechSynthesis`; when a sentence ends, start the next one.
  The speech engine's word-boundary events mark the current word inside the sentence. Going sentence by sentence makes pausing, skipping and speed changes instant.
- **Storage:** IndexedDB keeps the parsed book text (not the raw EPUB), so reopening needs no re-import and search is instant; localStorage keeps position and settings.
- **JSZip** is a local copy in `vendor/` (v3.10.1), not a CDN script, so the app works offline.
- **Voices:** the macOS novelty voices (Albert, Bubbles, Zarvox…) are filtered out. With no Premium voice, the app falls back to Samantha/Daniel-class voices.
- **Running it:** `python3 -m http.server` from this folder, plus a double-clickable `Tachivel.command` launcher
  that starts the server and opens Safari.

## Plan (build order)
1. Scaffold the page with design tokens (spacing, type, the 3 themes as colour roles).
2. Load the EPUB, build the chapter list, show a chapter as plain text.
3. Split into sentences, highlight the current sentence, click to set the position.
4. Speech loop: play/pause, next/previous, auto-advance between chapters.
5. Word highlighting from the speech engine's word events, plus auto-scroll.
6. Voice, speed, size and theme controls, and keyboard shortcuts.
7. Persistence (book in IndexedDB, position and settings in localStorage).
8. Launcher script.
9. **Test** with *I Shall Pursue Eternity*: cross several chapters in a row, reload mid-sentence and check it resumes,
   screenshot at desktop and 390px.
10. Then the nice-to-haves, in the order listed above.

## Done when
I can open the app, press Space once, and listen with highlighting through several chapters without touching anything.
After closing and reopening it, it resumes at the same sentence.

## Open questions
- None right now. A Tauri wrapper stays a later option.
