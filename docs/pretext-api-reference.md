# Pretext API Reference — Deep Technical Reference

Researched: 2026-04-02
Repo: https://github.com/chenglou/pretext
npm: https://www.npmjs.com/package/@chenglou/pretext
Live demos: https://chenglou.me/pretext/
Version researched: 0.0.4 (pre-1.0, API may change)

---

## What Pretext is (one sentence)

Pretext measures the pixel height and line structure of multiline text using the browser's Canvas API instead of the DOM, so you get accurate layout data without triggering reflow.

---

## Quick-start

```bash
npm install @chenglou/pretext
```

```typescript
import { prepare, layout } from '@chenglou/pretext'

// Phase 1 — runs once per (text, font) pair; ~19ms per 500-text batch
const prepared = prepare('Hello, world 🌍', '16px Inter')

// Phase 2 — pure arithmetic, runs on every resize; ~0.09ms per 500-text batch
const { height, lineCount } = layout(prepared, 400, 24)
```

---

## Package Structure

| Export path | File | Status |
|---|---|---|
| `@chenglou/pretext` | `dist/layout.js` + `dist/layout.d.ts` | Stable public API |
| `@chenglou/pretext/inline-flow` | `dist/inline-flow.js` + `dist/inline-flow.d.ts` | Experimental alpha |

Module format: ESM only (`"type": "module"` in package.json). No CommonJS build.

Source files in the repo (not shipped directly):

| File | Purpose |
|---|---|
| `src/layout.ts` | Public API entry point; two-phase prepare/layout pipeline |
| `src/analysis.ts` | Text segmentation, whitespace normalization, script detection |
| `src/measurement.ts` | Canvas measurement, caching, emoji correction, browser detection |
| `src/line-break.ts` | Core line-breaking algorithm; `SegmentBreakKind` definitions |
| `src/bidi.ts` | Bidirectional text level computation (simplified from pdf.js) |
| `src/inline-flow.ts` | Inline-flow sidecar for mixed inline runs |
| `src/text-modules.d.ts` | Allows `import '*.txt'` in build scripts |

---

## Main API: `@chenglou/pretext`

### `prepare(text, font, options?)`

```typescript
function prepare(
  text: string,
  font: string,
  options?: PrepareOptions
): PreparedText
```

**What it does.** Normalizes whitespace, segments text using `Intl.Segmenter`, applies language-specific glue/break rules, measures each unique segment via `CanvasRenderingContext2D.measureText`, and returns an opaque handle. This is the expensive phase (canvas calls, string operations). Call it once per (text, font) pair and cache the result.

**`text`** — any Unicode string. May contain CJK, Arabic, Hebrew, Devanagari, Thai, emoji, ZWJ sequences, soft hyphens (`\u00AD`), zero-width spaces (`\u200B`), non-breaking spaces (`\u00A0`). Newlines and tabs are significant only in `pre-wrap` mode (see `PrepareOptions`).

**`font`** — CSS `font` shorthand in Canvas API format. This string is passed directly to `CanvasRenderingContext2D.font`. Examples:
- `'16px Inter'`
- `'500 17px "Helvetica Neue"'`
- `'bold 20px Arial'`
- `'italic 14px Georgia'`

The font string must exactly match the CSS `font` declaration on the element being measured — same size, weight, style, and family. Mismatch produces wrong widths silently.

**`options?: PrepareOptions`**

```typescript
type PrepareOptions = {
  whiteSpace?: 'normal' | 'pre-wrap'
}
```

- `'normal'` (default): Collapses all whitespace runs into a single space, strips leading/trailing whitespace. Ignores `\n` (newlines do not become hard breaks). Follows CSS `white-space: normal` semantics.
- `'pre-wrap'`: Preserves spaces, tabs, and hard line breaks (`\n`). CRLF (`\r\n`) is normalized to a single `\n`. Tabs advance to browser-default tab stops (every 8 character-widths, matching CSS `tab-size: 8`). Follows CSS `white-space: pre-wrap` semantics.

**Returns** `PreparedText` — an opaque branded object. Pass directly to `layout()` or any `layout*` variant. Do not read its internals (the shape is not part of the public API).

**Performance.** Approximately 19ms for a batch of 500 texts (the shared benchmark corpus). Dominated by canvas `measureText` calls on first-seen segments. Subsequent calls with the same font and overlapping text are faster because of segment-level caching. Avoid calling `prepare()` on every resize — call it only when text or font changes.

**Caching.** Pretext maintains a global `Map<font, Map<segment, SegmentMetrics>>` cache. All calls to `prepare()` for the same font share cached segment widths. The cache is cleared by `clearCache()` or `setLocale()`.

---

### `layout(prepared, maxWidth, lineHeight)`

```typescript
function layout(
  prepared: PreparedText,
  maxWidth: number,
  lineHeight: number
): LayoutResult

type LayoutResult = {
  lineCount: number
  height: number    // equals lineCount * lineHeight
}
```

**What it does.** The resize hot path. Performs pure arithmetic on the pre-measured segment widths in `prepared`, applying CSS `white-space: normal` (or `pre-wrap`) line-breaking semantics, and returns the total height and line count. No DOM access, no canvas calls, no string allocation.

**`maxWidth`** — container content width in pixels. Must be a positive number. Can be fractional. Use the pixel value that matches your CSS container width.

**`lineHeight`** — the explicit line height in pixels. Pretext does not infer this from CSS. You must pass the same pixel value as your CSS `line-height`. For example, if CSS says `line-height: 1.5` and `font-size: 16px`, pass `24` (= 16 × 1.5).

**Performance.** ~0.09ms per 500-text batch = ~0.00018ms per call. Safe to call on every resize event, on every keystroke in a text editor, or inside a virtualized list's height estimator function.

**Key invariant.** The same `prepared` handle works at any `maxWidth` without re-calling `prepare()`. Resize events only need to call `layout()`.

---

### `prepareWithSegments(text, font, options?)`

```typescript
function prepareWithSegments(
  text: string,
  font: string,
  options?: PrepareOptions
): PreparedTextWithSegments

type PreparedTextWithSegments = InternalPreparedText & {
  segments: string[]
}
```

**What it does.** Same as `prepare()` but returns a richer handle that exposes segment text strings and is required by all the `layout*` advanced functions. Use this instead of `prepare()` whenever you need line strings, variable-width layout, or manual rendering.

**`segments`** — array of text segments as strings. Each segment is a unit in the internal layout model (a word, a space, a punctuation run, a CJK character, etc.). You generally do not need to read this array directly; it exists for custom renderers that need raw segment data.

**The extra cost.** `prepareWithSegments()` allocates the `segments` string array. For the simple height-only use case, `prepare()` avoids this allocation. For all line-level APIs, `prepareWithSegments()` is required.

---

### `layoutWithLines(prepared, maxWidth, lineHeight)`

```typescript
function layoutWithLines(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  lineHeight: number
): LayoutLinesResult

type LayoutLinesResult = LayoutResult & {
  lines: LayoutLine[]
}

type LayoutLine = {
  text: string        // complete text content of this line
  width: number       // measured width of this line in pixels
  start: LayoutCursor
  end: LayoutCursor
}

type LayoutCursor = {
  segmentIndex: number   // index into the segments array
  graphemeIndex: number  // grapheme offset within that segment; 0 at clean word boundaries
}
```

**What it does.** Same arithmetic as `layout()` plus builds the line text strings and geometry for every line. Returns all lines at once. Use when you need to render text yourself (Canvas 2D, SVG, WebGL, custom DOM) and need both the full text content and the position of each line.

**`LayoutLine.text`** — the exact text that should appear on this line, after whitespace collapsing and line-end trimming. Trailing spaces that hang beyond the line edge are not included.

**`LayoutLine.width`** — pixel width of this line's visible text (excluding trailing whitespace). Useful for text justification and right-alignment.

**`LayoutLine.start` / `LayoutLine.end`** — cursors marking where this line begins and ends in the segment model. `end` of one line equals `start` of the next, forming a contiguous chain.

---

### `layoutNextLine(prepared, start, maxWidth)`

```typescript
function layoutNextLine(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number
): LayoutLine | null
```

**What it does.** Iterator-style API. Given a cursor position, computes the next single line at `maxWidth` and returns it. Returns `null` when text is exhausted. Use when you need variable-width layout (different `maxWidth` per line, e.g. text flowing around an obstacle).

**`start`** — a `LayoutCursor`. To start from the beginning of the text, pass `{ segmentIndex: 0, graphemeIndex: 0 }`. To continue after a previous line, pass `previousLine.end`.

**Typical loop pattern:**

```typescript
let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

while (true) {
  const lineWidth = computeWidthAtY(y)  // variable per line
  const line = layoutNextLine(prepared, cursor, lineWidth)
  if (line === null) break
  renderLine(line.text, y)
  cursor = line.end
  y += lineHeight
}
```

**Never mutate the cursor.** `line.end` is a new object each call; you can assign it directly.

---

### `layoutNextLineRange(prepared, start, maxWidth)`

```typescript
function layoutNextLineRange(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number
): LayoutLineRange | null

type LayoutLineRange = {
  width: number
  start: LayoutCursor
  end: LayoutCursor
  // no text field
}
```

**What it does.** Non-materializing version of `layoutNextLine()`. Does not build the line text string. Use when you only need geometry (width, cursor positions) but not the actual text — for example, geometry passes before final rendering, or metrics-only consumers like row height calculators.

To convert a `LayoutLineRange` into a `LayoutLine` with text, call `materializeLineRange()`.

---

### `walkLineRanges(prepared, maxWidth, onLine)`

```typescript
function walkLineRanges(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  onLine: (line: LayoutLineRange) => void
): number
```

**What it does.** Iterates over all lines at a fixed `maxWidth`, calling `onLine` once per line with a `LayoutLineRange` (no text strings). Returns total height (`lineCount * lineHeight` — note: this function does not take `lineHeight`; it returns `lineCount` only, not pixel height). Use for geometry passes, counting lines, or finding the maximum line width.

**Returns** the number of lines (equivalent to `lineCount`).

**Common use case — shrink-wrap to tightest container width:**

```typescript
let maxLineWidth = 0
walkLineRanges(prepared, 600, (line) => {
  if (line.width > maxLineWidth) maxLineWidth = line.width
})
// maxLineWidth is now the tightest container width that fits text without wrapping
```

**Common use case — binary search for minimum width that keeps N lines:**

```typescript
let lo = 0, hi = 800
while (lo < hi - 1) {
  const mid = (lo + hi) / 2
  let count = 0
  walkLineRanges(prepared, mid, () => { count++ })
  if (count <= targetLines) hi = mid
  else lo = mid
}
```

---

### `materializeLineRange(prepared, line)`

```typescript
function materializeLineRange(
  prepared: PreparedTextWithSegments,
  line: LayoutLineRange
): LayoutLine
```

**What it does.** Reconstructs the text string for a `LayoutLineRange` by reading back through the segments. Used when you ran `layoutNextLineRange()` or `walkLineRanges()` for geometry and now need the actual text.

---

### `measureLineGeometry(prepared, maxWidth)`

```typescript
function measureLineGeometry(
  prepared: PreparedTextWithSegments,
  maxWidth: number
): LineGeometry

type LineGeometry = {
  lineCount: number
  maxLineWidth: number   // width of the widest line at this maxWidth
}
```

**What it does.** Returns aggregate geometry: number of lines and the width of the widest line. Use when you need both counts without individual line data.

---

### `measureNaturalWidth(prepared)`

```typescript
function measureNaturalWidth(
  prepared: PreparedTextWithSegments
): number
```

**What it does.** Returns the intrinsic (natural) width of the text — the width of the single line you would get if no container width constraint were applied. This is the CSS equivalent of `white-space: nowrap` width. Useful for sizing a container to exactly fit its text content (e.g., tooltip sizing, badge auto-sizing).

---

### `profilePrepare(text, font, options?)`

```typescript
function profilePrepare(
  text: string,
  font: string,
  options?: PrepareOptions
): PrepareProfile

type PrepareProfile = {
  analysisMs: number         // time in ms for text analysis (normalization, segmentation, glue rules)
  measureMs: number          // time in ms for canvas measurement phase
  totalMs: number            // analysisMs + measureMs
  analysisSegments: number   // segments produced by analysis
  preparedSegments: number   // segments after merging/optimization
  breakableSegments: number  // segments that required per-grapheme measurement
}
```

**What it does.** Like `prepare()` but returns timing and segment count diagnostics instead of a `PreparedText` handle. Useful for diagnosing which phase is the bottleneck for a specific text corpus.

**Note.** This function is not documented in the README. It is exported from `src/layout.ts` and available in the published package. It is a development/debugging tool; do not call it in hot paths (it still does all the work of `prepare()`).

---

### `clearCache()`

```typescript
function clearCache(): void
```

**What it does.** Clears Pretext's global internal caches:
- The segment metrics cache: `Map<font, Map<segment, SegmentMetrics>>`
- Emoji correction factors (per font)
- The shared `Intl.Segmenter` instance

**When to call:**
- After web fonts finish loading (before re-calling `prepare()`) — fonts may not have been available when the cache was first populated
- When your app cycles through many different fonts or text variants and you want to release accumulated memory
- Before calling `setLocale()` (but `setLocale()` calls `clearCache()` itself)

**After calling `clearCache()`.** All existing `PreparedText` / `PreparedTextWithSegments` handles become stale — they contain measurements from the previous cache state. You must call `prepare()` again on any text you intend to use.

---

### `setLocale(locale?)`

```typescript
function setLocale(locale?: string): void
```

**What it does.** Sets the locale string passed to `Intl.Segmenter` for future `prepare()` and `prepareWithSegments()` calls. Also calls `clearCache()` internally (all cached measurements are discarded, all existing prepared handles become stale).

**`locale`** — a BCP 47 language tag (e.g. `'ja-JP'`, `'ar-SA'`, `'th'`, `'zh-Hans'`). Pass `undefined` to reset to the runtime default locale.

**When to call.** Only when you need a specific locale's word-boundary behavior from `Intl.Segmenter`. For most Latin-script content, the runtime default locale is correct. For Thai, Japanese, or Arabic text where segmentation differs across locales, set the locale before batch-preparing text in that language.

**Scope.** This is a global setting that affects all subsequent `prepare()` calls. It does not affect already-prepared handles.

---

## Type Reference (complete)

```typescript
// Main entry point types
export type PreparedText = { readonly [preparedTextBrand]: true }
export type PreparedTextWithSegments = InternalPreparedText & { segments: string[] }

export type PrepareOptions = {
  whiteSpace?: 'normal' | 'pre-wrap'
}

export type LayoutResult = {
  lineCount: number
  height: number
}

export type LayoutLinesResult = LayoutResult & {
  lines: LayoutLine[]
}

export type LineGeometry = {
  lineCount: number
  maxLineWidth: number
}

export type LayoutLine = {
  text: string
  width: number
  start: LayoutCursor
  end: LayoutCursor
}

export type LayoutLineRange = {
  width: number
  start: LayoutCursor
  end: LayoutCursor
}

export type LayoutCursor = {
  segmentIndex: number
  graphemeIndex: number
}

export type PrepareProfile = {
  analysisMs: number
  measureMs: number
  totalMs: number
  analysisSegments: number
  preparedSegments: number
  breakableSegments: number
}

// Internal segment break classification (not exported at top level but
// accessible via PreparedTextWithSegments)
type SegmentBreakKind =
  | 'text'            // regular word segment
  | 'space'           // collapsible whitespace (hangs past line edge, does not trigger wrap)
  | 'preserved-space' // space preserved in pre-wrap mode
  | 'tab'             // tab character (pre-wrap mode only)
  | 'hard-break'      // explicit newline (pre-wrap mode only)
  | 'glue'            // non-breaking glue: NBSP (\u00A0), WJ (\u2060), NNBSP (\u202F)
  | 'zero-width'      // zero-width break opportunity: ZWSP (\u200B)
  | 'soft-hyphen'     // discretionary hyphen: \u00AD

// Internal PreparedLineChunk type (layout chunking for optimization)
type PreparedLineChunk = {
  startSegmentIndex: number
  endSegmentIndex: number
  consumedEndSegmentIndex: number
}
```

---

## Inline-Flow Sidecar: `@chenglou/pretext/inline-flow`

**Status: experimental alpha.** The API may change without notice.

### What it is

The inline-flow sidecar handles mixed inline runs: a sequence of text items with potentially different fonts, where some items are atomic (must not be broken mid-item — e.g. mention chips, code spans, badges). It collapses whitespace at item boundaries following CSS `white-space: normal` rules and handles `overflow-wrap: break-word` inside breakable items.

**It is not** a general CSS inline formatting engine. It does not handle:
- `white-space: pre-wrap` (normal only)
- `padding`, `margin`, `border` on items (caller provides `extraWidth` for chrome)
- Nested markup or block elements
- `line-break: strict` or other non-default line-break modes
- Vertical metrics or baseline alignment

### `prepareInlineFlow(items)`

```typescript
function prepareInlineFlow(items: InlineFlowItem[]): PreparedInlineFlow

type InlineFlowItem = {
  text: string           // raw text for this run, including leading/trailing spaces
                         // Pretext collapses boundary whitespace across items
  font: string           // CSS font shorthand (same format as prepare())
  break?: 'normal' | 'never'
                         // 'normal' (default): breakable between words
                         // 'never': atomic item — treated as a single non-breakable unit
                         //          (used for chips, @mention pills, inline code tokens)
  extraWidth?: number    // additional width in pixels added to this item's slot
                         // use for padding + border chrome that the caller controls
                         // default: 0
}

type PreparedInlineFlow = { readonly [preparedInlineFlowBrand]: true }
```

**What it does.** Takes an array of inline items, collapses whitespace at item boundaries (e.g. if item 0 ends with a space and item 1 starts with a space, they merge into one collapsible space), prepares each item's text (calling the equivalent of `prepareWithSegments()` internally), and returns an opaque handle.

**Boundary whitespace rules.** Pretext owns cross-item whitespace collapsing. Pass the raw text including boundary spaces; Pretext decides what collapses. Do not manually strip spaces from item boundaries.

**Atomic items (`break: 'never'`).** The entire item is treated as a single non-breaking unit. If the item plus surrounding content does not fit on a line, the item starts on a new line. If the item alone is wider than `maxWidth`, it is still placed on its own line (no internal break).

---

### `layoutNextInlineFlowLine(prepared, maxWidth, start?)`

```typescript
function layoutNextInlineFlowLine(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  start?: InlineFlowCursor
): InlineFlowLine | null

type InlineFlowLine = {
  fragments: InlineFlowFragment[]
  width: number
  end: InlineFlowCursor
}

type InlineFlowFragment = {
  itemIndex: number      // index into the original InlineFlowItem array
  text: string           // materialized text for this fragment
  gapBefore: number      // collapsed gap in pixels before this fragment (inter-item whitespace)
  occupiedWidth: number  // width of this fragment including extraWidth
  start: LayoutCursor    // position within the item's internal segment model
  end: LayoutCursor
}

type InlineFlowCursor = {
  itemIndex: number
  segmentIndex: number
  graphemeIndex: number
}
```

**What it does.** Returns the next line's worth of fragments. A line may contain fragments from multiple items (if items fit on the same line) or a single fragment (if one item fills a line). Returns `null` when all items are exhausted.

**`start`** — omit or pass `undefined` to start from the beginning of the flow. To continue after a previous line, pass `previousLine.end`.

---

### `layoutNextInlineFlowLineRange(prepared, maxWidth, start?)`

```typescript
function layoutNextInlineFlowLineRange(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  start?: InlineFlowCursor
): InlineFlowLineRange | null

type InlineFlowLineRange = {
  fragments: InlineFlowFragmentRange[]
  width: number
  end: InlineFlowCursor
}

type InlineFlowFragmentRange = {
  itemIndex: number
  gapBefore: number
  occupiedWidth: number
  start: LayoutCursor
  end: LayoutCursor
  // no text field
}
```

Non-materializing variant of `layoutNextInlineFlowLine()`. Returns fragment geometry without text strings.

---

### `walkInlineFlowLines(prepared, maxWidth, onLine)`

```typescript
function walkInlineFlowLines(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  onLine: (line: InlineFlowLine) => void
): number
```

Iterates all lines, calling `onLine` with each materialized line. Returns total line count.

---

### `walkInlineFlowLineRanges(prepared, maxWidth, onLine)`

```typescript
function walkInlineFlowLineRanges(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  onLine: (line: InlineFlowLineRange) => void
): number
```

Non-materializing batch walker. Returns total line count.

---

### `measureInlineFlowGeometry(prepared, maxWidth)`

```typescript
function measureInlineFlowGeometry(
  prepared: PreparedInlineFlow,
  maxWidth: number
): InlineFlowGeometry

type InlineFlowGeometry = {
  lineCount: number
  maxLineWidth: number
}
```

Returns aggregate geometry without iterating individual lines.

---

### `measureInlineFlow(prepared, maxWidth, lineHeight)`

```typescript
function measureInlineFlow(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  lineHeight: number
): LayoutResult   // { lineCount: number, height: number }
```

Equivalent of the main `layout()` function for inline-flow content. Returns height and line count.

---

## How the Two-Phase Architecture Works

### Phase 1 internals: what `prepare()` actually does

1. **Whitespace normalization.** If `whiteSpace: 'normal'`, collapses all whitespace runs to a single space and trims leading/trailing whitespace. If `whiteSpace: 'pre-wrap'`, normalizes CRLF to LF; preserves spaces, tabs, and newlines.

2. **Unicode segmentation.** Uses `Intl.Segmenter` with `granularity: 'word'` to find word boundaries and `granularity: 'grapheme'` to find grapheme cluster boundaries within words. The segmenter is shared across calls (one instance per locale) and cached.

3. **Script detection and glue rules.** Each segment is classified as one of 8 `SegmentBreakKind` values. Special rules apply:
   - CJK segments: each character becomes its own segment (per-character line-breaking), subject to kinsoku rules (certain punctuation characters may not start or end a line)
   - Arabic punctuation clusters: grouped with preceding word
   - Non-breaking space (`\u00A0`), word joiner (`\u2060`): marked as `glue` (cannot break)
   - Zero-width space (`\u200B`): marked as `zero-width` break opportunity
   - Soft hyphen (`\u00AD`): marked as `soft-hyphen` (discretionary break; inserts `-` if used)
   - Myanmar medial glue and Devanagari danda: specialized attachment rules
   - URLs and numeric sequences (e.g. `7:00-9:00`, `420-69-8008`): kept as single non-breaking units

4. **Canvas measurement.** Each unique (font, segment) pair is measured via `CanvasRenderingContext2D.measureText`. Results stored in a two-level cache: `Map<font, Map<segmentText, SegmentMetrics>>`. CJK segments also pre-measure individual grapheme widths for `overflow-wrap: break-word` support.

5. **Emoji correction.** On macOS, Canvas reports different emoji widths than the DOM at font sizes below 24px (a known browser quirk). Pretext performs one hidden DOM measurement per font to establish a per-font correction factor and applies it to every emoji-containing segment.

6. **Bidi metadata** (rich path only). When text contains RTL characters, `computeSegmentLevels()` runs the Unicode Bidirectional Algorithm (UAX #9) and attaches embedding levels to each segment. These are exposed in `PreparedTextWithSegments` for custom renderers that need to position RTL text correctly.

### Phase 2 internals: what `layout()` actually does

Iterates over the cached segment widths array. For each segment, checks whether it fits on the current line by summing widths. Applies break kind rules:
- `space`: hangs past line edge (trailing whitespace does not trigger a line break)
- `glue`: never breaks; glued to the preceding segment
- `zero-width`: always a break opportunity; width = 0
- `soft-hyphen`: break opportunity; if used, adds `discretionaryHyphenWidth` to the previous line's width
- `tab`: advances to the next tab stop (tab stop = 8 × `tabStopAdvance`)
- `hard-break`: forces an immediate new line (pre-wrap mode only)

For segments that require `overflow-wrap: break-word` (a word wider than `maxWidth`), uses pre-measured per-grapheme widths to find the last grapheme that fits.

---

## Supported and Unsupported Text Configurations

### What CSS configurations Pretext targets

Pretext is validated against this specific configuration:

```css
white-space: normal;      /* or pre-wrap via options */
word-break: normal;
overflow-wrap: break-word;
line-break: auto;
```

Any other value for these properties is outside Pretext's model and will produce inaccurate results.

### What is NOT supported (behavior undefined)

| CSS property / value | Status |
|---|---|
| `word-break: break-all` | Not supported |
| `word-break: keep-all` | Not supported |
| `line-break: strict` | Not supported |
| `line-break: loose` | Not supported |
| `overflow-wrap: anywhere` | Not supported |
| `text-transform: uppercase/lowercase` | Not supported; measure the transformed string yourself |
| `letter-spacing` (non-zero) | Not supported |
| `word-spacing` (non-default) | Not supported |
| HTML markup / rich text entities | Not supported; Pretext takes plain strings |
| `system-ui` font on macOS | Unsafe — canvas and DOM may resolve to different fonts |
| `tab-size` != 8 | Not configurable (hardcoded to CSS default of 8) |

### What IS supported

| Feature | Notes |
|---|---|
| Latin scripts | Full support including punctuation attachment |
| CJK (Chinese, Japanese, Korean) | Per-character breaking with kinsoku shori rules |
| Arabic / Hebrew (RTL) | Bidirectional text via UAX #9; bidi levels in `PreparedTextWithSegments` |
| Thai | Via `Intl.Segmenter`; note: dictionary may differ from CSS text layout |
| Devanagari | Danda punctuation attachment |
| Myanmar | Medial glue rules |
| Emoji | Full ZWJ sequences, skin-tone modifiers, emoji sequences; width correction on macOS |
| Soft hyphens (`\u00AD`) | Discretionary break points |
| Zero-width space (`\u200B`) | Explicit break opportunities |
| Non-breaking space (`\u00A0`) | Glue (no break) |
| Hard line breaks | In `pre-wrap` mode only |
| Tabs | In `pre-wrap` mode only; tab stops at every 8 char-widths |

---

## Limitations and Gotchas

### Font must be loaded before `prepare()`

The Canvas API uses whatever font is currently loaded in the browser. If `prepare()` is called before a web font has loaded, the canvas falls back to a system font, and the cached measurements will be wrong for that font.

**Fix:** Wait for fonts to load before calling `prepare()`.

```typescript
// Option A: document.fonts.ready (resolves when all @font-face declarations are loaded)
await document.fonts.ready
const prepared = prepare(text, '16px Inter')

// Option B: load a specific font explicitly
await document.fonts.load('16px Inter')
const prepared = prepare(text, '16px Inter')

// Option C: if fonts loaded after initial prepare(), clear cache and re-prepare
document.fonts.addEventListener('loadingdone', () => {
  clearCache()
  // re-call prepare() for all active text blocks
})
```

If the cache is warm with stale pre-load measurements, call `clearCache()` before re-preparing.

### `system-ui` is unsafe on macOS

On macOS, `system-ui` resolves to San Francisco in the DOM but may resolve to a different font in the Canvas API context. This causes systematic measurement errors.

**Fix:** Use a named font (`'Inter'`, `'Helvetica Neue'`, `'Arial'`, etc.) in both your CSS and your `prepare()` call.

### The font string must exactly match your CSS `font` declaration

These are treated as different fonts and produce different measurements:
- `'16px Inter'` vs `'16px "Inter"'` (quotes around name)
- `'16px Inter'` vs `'normal 16px Inter'` (explicit `normal` weight)
- `'16px Inter'` vs `'16.0px Inter'` (float vs integer)

Use the exact string that `window.getComputedStyle(element).font` returns for the element being measured.

### SSR: not supported

Pretext requires `CanvasRenderingContext2D.measureText`, which is a browser API. It cannot run in Node.js, Bun, or Deno without a canvas shim.

In `measurement.ts`, `getMeasureContext()` tries `OffscreenCanvas` first, then falls back to a DOM `<canvas>` element. If neither is available, it throws. There is no built-in SSR fallback.

**Options for SSR environments:**
- Skip measurement on the server; hydrate with measured heights client-side
- Use a canvas shim like `node-canvas` (npm: `canvas`) before importing Pretext
- Provide estimated heights on the server and call `prepare()`/`layout()` after hydration

The README notes "soon, server-side" as a planned future feature.

### `prepare()` must not be called on every render or resize

Canvas measurement is expensive relative to `layout()`. The correct pattern is:

```
text/font changes  →  call prepare()  (expensive, cache the result)
width changes      →  call layout()   (cheap, call freely)
```

Calling `prepare()` on resize is a common mistake that eliminates the performance benefit.

### `layout()` takes `lineHeight` in pixels, not as a CSS ratio

Pretext does not read CSS. You must pass the resolved pixel value. For `font-size: 16px; line-height: 1.5`, that is `24` (= 16 × 1.5). For `line-height: 20px`, that is `20`. The wrong value produces wrong heights.

### Thai segmentation may differ from CSS

`Intl.Segmenter` uses a different dictionary from the browser's CSS text layout engine for Thai word breaking. Measured line counts may differ by one or two lines for Thai text at narrow widths.

### Very narrow widths and `overflow-wrap: break-word`

When `maxWidth` is narrower than a single word, Pretext breaks inside the word at grapheme boundaries (matching CSS `overflow-wrap: break-word`). This requires pre-measured per-grapheme widths for every `breakableWidth` segment, which adds cost in the `prepare()` phase for wide words.

### Rich text / HTML content

Pretext takes plain strings. It has no awareness of HTML tags, inline styles, or markdown. If your text contains HTML like `<strong>bold</strong>`, Pretext measures the literal `<strong>bold</strong>` string, not the rendered text.

**For rich text:** strip markup to plain text before measuring height, or use the `inline-flow` sidecar for simple bold/non-bold mixed runs with different fonts.

### `clearCache()` invalidates all existing PreparedText handles

After calling `clearCache()` or `setLocale()`, any existing `PreparedText` / `PreparedTextWithSegments` handles are stale. Calling `layout()` on them may produce incorrect results because the underlying cached widths have been cleared. You must call `prepare()` again.

### `inline-flow` is experimental

The `@chenglou/pretext/inline-flow` entry point is explicitly labeled "experimental alpha" in the README. Its API is not stable and may change between patch versions.

### No `lineCount` guarantee for empty string

Calling `prepare('')` followed by `layout(prepared, width, lineHeight)` should return `{ lineCount: 0, height: 0 }` but this edge case is not explicitly documented. Test for your use case.

### Canvas availability in Web Workers

`OffscreenCanvas` is available in Web Workers in modern browsers (Chrome 69+, Firefox 105+, Safari 16.4+). Pretext tries `OffscreenCanvas` first in `getMeasureContext()`, so it works in workers in supported browsers. In older environments, it falls back to a DOM canvas, which is not available in workers.

---

## Practical Usage Examples

### 1. Basic text height measurement

```typescript
import { prepare, layout } from '@chenglou/pretext'

const FONT = '14px Inter'       // must match CSS font declaration exactly
const LINE_HEIGHT = 20          // must match CSS line-height in pixels

function measureTextHeight(text: string, containerWidth: number): number {
  const prepared = prepare(text, FONT)
  const { height } = layout(prepared, containerWidth, LINE_HEIGHT)
  return height
}
```

---

### 2. React: useRef + useEffect pattern with ResizeObserver

```typescript
import { prepare, layout } from '@chenglou/pretext'
import { useEffect, useRef, useState, useMemo } from 'react'

const FONT = '16px Inter'
const LINE_HEIGHT = 24

function TextBlock({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  // Phase 1: prepare once when text changes
  const prepared = useMemo(() => prepare(text, FONT), [text])

  // Observe container width changes
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setContainerWidth(width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Phase 2: layout whenever width changes (cheap)
  const { height, lineCount } = useMemo(() => {
    if (containerWidth === null) return { height: 0, lineCount: 0 }
    return layout(prepared, containerWidth, LINE_HEIGHT)
  }, [prepared, containerWidth])

  return (
    <div ref={containerRef}>
      <p style={{ height, lineHeight: `${LINE_HEIGHT}px` }}>{text}</p>
      <span>{lineCount} lines</span>
    </div>
  )
}
```

---

### 3. React: handling font loading

```typescript
import { prepare, layout, clearCache } from '@chenglou/pretext'
import { useState, useEffect } from 'react'

function useFontsReady(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    document.fonts.ready.then(() => {
      setReady(true)
    })
  }, [])

  return ready
}

function App() {
  const fontsReady = useFontsReady()

  useEffect(() => {
    if (fontsReady) {
      // Fonts are now available in Canvas context.
      // Clear any measurements made before fonts loaded.
      clearCache()
    }
  }, [fontsReady])

  // Don't call prepare() until fonts are ready
  if (!fontsReady) return <div>Loading fonts...</div>
  return <TextBlock text="Hello, world" />
}
```

---

### 4. Virtualized list row height estimation

This is the primary production use case for Pretext.

```typescript
import { prepare, layout } from '@chenglou/pretext'

const FONT = '14px Inter'
const LINE_HEIGHT = 20
const PADDING_TOP = 8
const PADDING_BOTTOM = 8

type Message = {
  id: string
  text: string
}

// Pre-compute heights for all messages when data loads
function computeRowHeights(
  messages: Message[],
  containerWidth: number
): Map<string, number> {
  const heights = new Map<string, number>()

  for (const msg of messages) {
    const prepared = prepare(msg.text, FONT)
    const { height } = layout(prepared, containerWidth, LINE_HEIGHT)
    heights.set(msg.id, height + PADDING_TOP + PADDING_BOTTOM)
  }

  return heights
}

// On resize, re-compute layout only (not prepare())
function recomputeHeightsOnResize(
  preparedMessages: Map<string, ReturnType<typeof prepare>>,
  newWidth: number
): Map<string, number> {
  const heights = new Map<string, number>()

  for (const [id, prepared] of preparedMessages) {
    const { height } = layout(prepared, newWidth, LINE_HEIGHT)
    heights.set(id, height + PADDING_TOP + PADDING_BOTTOM)
  }

  return heights
}
```

With TanStack Virtual:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useMemo } from 'react'

function VirtualMessageList({ messages }: { messages: Message[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const containerWidth = 640  // or measured via ResizeObserver

  // Prepare all messages once
  const preparedMessages = useMemo(
    () => messages.map((m) => prepare(m.text, FONT)),
    [messages]
  )

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const { height } = layout(preparedMessages[index], containerWidth, LINE_HEIGHT)
      return height + PADDING_TOP + PADDING_BOTTOM
    },
    overscan: 5,
  })

  return (
    <div ref={parentRef} style={{ overflow: 'auto', height: '600px' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {messages[virtualItem.index].text}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

### 5. Chat message bubble sizing (streaming tokens)

```typescript
import { prepare, layout } from '@chenglou/pretext'

const FONT = '15px Inter'
const LINE_HEIGHT = 22
const BUBBLE_MAX_WIDTH = 320
const BUBBLE_PADDING_H = 24   // left + right padding
const BUBBLE_PADDING_V = 16   // top + bottom padding

function getBubbleDimensions(text: string) {
  const prepared = prepare(text, FONT)
  // layout at the bubble content width (max_width minus padding)
  const contentWidth = BUBBLE_MAX_WIDTH - BUBBLE_PADDING_H
  const { height, lineCount } = layout(prepared, contentWidth, LINE_HEIGHT)

  return {
    width: BUBBLE_MAX_WIDTH,
    height: height + BUBBLE_PADDING_V,
    lineCount,
  }
}

// Streaming: update as tokens arrive
function useStreamingBubbleHeight(streamingText: string) {
  // useMemo re-runs prepare() when text changes (streaming tokens)
  // This is acceptable for streaming because text changes rarely per frame
  // For highest performance, batch token updates with requestAnimationFrame
  const prepared = useMemo(() => prepare(streamingText, FONT), [streamingText])
  return useMemo(
    () => layout(prepared, BUBBLE_MAX_WIDTH - BUBBLE_PADDING_H, LINE_HEIGHT),
    [prepared]
  )
}
```

---

### 6. Variable-width layout: text flowing around an image

```typescript
import { prepareWithSegments, layoutNextLine, LayoutCursor } from '@chenglou/pretext'

function renderTextAroundImage(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  lineHeight: number,
  containerWidth: number,
  image: { x: number; y: number; width: number; height: number }
) {
  const prepared = prepareWithSegments(text, font)

  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = 0

  while (true) {
    const imageEndY = image.y + image.height
    const lineX = y >= image.y && y < imageEndY ? image.x + image.width : 0
    const lineWidth = containerWidth - lineX

    const line = layoutNextLine(prepared, cursor, lineWidth)
    if (line === null) break

    ctx.fillText(line.text, lineX, y + lineHeight * 0.8) // baseline offset
    cursor = line.end
    y += lineHeight
  }
}
```

---

### 7. Inline-flow: mixed text with mention chips and links

```typescript
import {
  prepareInlineFlow,
  walkInlineFlowLines,
  InlineFlowItem,
} from '@chenglou/pretext/inline-flow'

const BODY_FONT = '14px Inter'
const CHIP_FONT = '600 12px Inter'
const LINE_HEIGHT = 22
const CHIP_PADDING = 16  // total horizontal padding in chip chrome

function renderAnnotatedMessage(
  ctx: CanvasRenderingContext2D,
  containerWidth: number
) {
  const items: InlineFlowItem[] = [
    { text: 'Task assigned to ', font: BODY_FONT },
    { text: '@maya', font: CHIP_FONT, break: 'never', extraWidth: CHIP_PADDING },
    { text: ' and ', font: BODY_FONT },
    { text: '@jordan', font: CHIP_FONT, break: 'never', extraWidth: CHIP_PADDING },
    { text: ' — please review by Friday.', font: BODY_FONT },
  ]

  const prepared = prepareInlineFlow(items)
  let y = 0

  walkInlineFlowLines(prepared, containerWidth, (line) => {
    let x = 0
    for (const fragment of line.fragments) {
      x += fragment.gapBefore
      if (items[fragment.itemIndex].break === 'never') {
        // draw chip background
        ctx.fillStyle = '#e0e7ff'
        ctx.fillRect(x, y, fragment.occupiedWidth, LINE_HEIGHT)
      }
      ctx.fillStyle = '#000'
      ctx.fillText(fragment.text, x, y + LINE_HEIGHT * 0.75)
      x += fragment.occupiedWidth
    }
    y += LINE_HEIGHT
  })
}
```

---

### 8. Shrink-wrap a container to its text

```typescript
import { prepareWithSegments, walkLineRanges, measureNaturalWidth } from '@chenglou/pretext'

// Find the tightest container that keeps text to maxLines lines
function findMinWidthForLineCount(
  text: string,
  font: string,
  maxLines: number
): number {
  const prepared = prepareWithSegments(text, font)

  // Natural (single-line) width is the upper bound
  const naturalWidth = measureNaturalWidth(prepared)

  let lo = 0
  let hi = naturalWidth

  while (hi - lo > 1) {
    const mid = (lo + hi) / 2
    let count = 0
    walkLineRanges(prepared, mid, () => { count++ })
    if (count <= maxLines) hi = mid
    else lo = mid
  }

  return Math.ceil(hi)
}
```

---

### 9. Matching CSS font strings to Pretext font strings

The `font` parameter must match your CSS exactly. Use `getComputedStyle` to get the canonical CSS `font` value if you are uncertain:

```typescript
// Get the resolved CSS font string from a DOM element
function getCSSFont(element: HTMLElement): string {
  return window.getComputedStyle(element).font
}

// Example: '500 16px / 24px Inter' — note the line-height is included
// Strip the line-height portion: '500 16px Inter'
function parseFontForPretext(cssFont: string): string {
  // Remove line-height component (e.g. '/ 24px')
  return cssFont.replace(/\s*\/\s*[\d.]+\w+/, '').trim()
}

// Usage
const el = document.querySelector('.message-text') as HTMLElement
const font = parseFontForPretext(getCSSFont(el))
const prepared = prepare(text, font)
```

**Tailwind example.** If your CSS is `class="font-['Inter'] text-sm font-medium"`, which computes to `font-size: 0.875rem; font-weight: 500; font-family: Inter`, the canvas font string is:

```typescript
const FONT = '500 14px Inter'  // 0.875rem at 16px root = 14px
```

---

## Architecture Diagram

```
Input text + font string
        │
        ▼
┌─────────────────────────────────────────────┐
│            prepare() / prepareWithSegments() │
│                                             │
│  1. normalizeWhitespace()                   │
│  2. Intl.Segmenter → word + grapheme segs   │
│  3. script detection (CJK, bidi, emoji…)    │
│  4. CanvasRenderingContext2D.measureText()  │◄── canvas font engine
│     (cached: Map<font, Map<seg, metrics>>)  │    (NOT DOM layout)
│  5. emoji width correction (macOS bug fix)  │
│  6. bidi levels (UAX #9) if RTL present     │
└─────────────────────────────────────────────┘
        │
        │  PreparedText (opaque handle)
        │  contains: widths[], kinds[], breakableWidths[], etc.
        ▼
┌─────────────────────────────────────────────┐
│   layout(prepared, maxWidth, lineHeight)     │
│                                             │
│  Pure arithmetic. No canvas. No DOM.        │
│  Iterate widths[], apply break kinds,       │
│  count lines, multiply by lineHeight.       │
└─────────────────────────────────────────────┘
        │
        ▼
  { height: number, lineCount: number }
```

---

## Performance Reference

| Operation | Approximate time | Notes |
|---|---|---|
| `prepare()` — 500 text batch | ~19ms total (~0.038ms each) | Dominated by canvas calls on unseen segments |
| `prepare()` — warm cache | Much faster | Cached segments skip canvas |
| `layout()` — 500 text batch | ~0.09ms total (~0.00018ms each) | Pure arithmetic |
| `layoutWithLines()` | Slightly slower than `layout()` | Allocates line string objects |
| `walkLineRanges()` | Same as `layout()` order | No string allocation |
| `clearCache()` | Negligible | Map clear |

Benchmark environment: shared 500-text corpus, Chrome on developer machine. Numbers from DEVELOPMENT.md and README.

---

## Accuracy Model

Pretext validates its output against real browser DOM measurements via an accuracy-check test suite. The tolerance is:

| Browser | Tolerance |
|---|---|
| Chromium | 0.005 (sub-pixel) |
| Gecko (Firefox) | 0.005 |
| WebKit (Safari) | 1/64 (~0.0156) |

Safari's wider tolerance is due to WebKit's sub-pixel rounding differences in text measurement. This means Pretext's line count will match Chrome and Firefox to within a fraction of a pixel but Safari allows slightly more drift.

The accuracy check (`bun run accuracy-check`) runs in a headless browser, renders text in the DOM at various widths and fonts, and compares the resulting heights to Pretext's computed heights.

---

## Package Details

| Property | Value |
|---|---|
| Package name | `@chenglou/pretext` |
| Version | 0.0.4 |
| License | MIT |
| Module format | ESM only |
| TypeScript support | Yes — `.d.ts` files included |
| Runtime dependencies | Zero |
| Dev dependencies | TypeScript 6.0.2, Bun, Oxlint, Marked |
| Bundle size | ~15KB (community reports) — not independently verified from dist |
| Main export | `./dist/layout.js` |
| Inline-flow export | `./dist/inline-flow.js` (via `"./inline-flow"` export map) |
| Engines | Modern browsers with Canvas API; Node.js only with canvas shim |

---

## Changelog (versions observed)

- **0.0.4** (current) — version at research date; no public changelog found
- **0.0.3** — referenced in an accessible-demo project dependency
- Pre-1.0 — no stability guarantees

---

## Relationship Between API Functions

```
prepare()             → PreparedText
                           └─► layout()                          → { height, lineCount }

prepareWithSegments() → PreparedTextWithSegments
                           ├─► layout()                          → { height, lineCount }
                           ├─► layoutWithLines()                 → { height, lineCount, lines[] }
                           ├─► layoutNextLine()                  → LayoutLine | null
                           ├─► layoutNextLineRange()             → LayoutLineRange | null
                           ├─► walkLineRanges()                  → lineCount (calls onLine per line)
                           ├─► materializeLineRange()            → LayoutLine
                           ├─► measureLineGeometry()             → { lineCount, maxLineWidth }
                           └─► measureNaturalWidth()             → number

prepareInlineFlow()   → PreparedInlineFlow
                           ├─► measureInlineFlow()               → { height, lineCount }
                           ├─► measureInlineFlowGeometry()       → { lineCount, maxLineWidth }
                           ├─► layoutNextInlineFlowLine()        → InlineFlowLine | null
                           ├─► layoutNextInlineFlowLineRange()   → InlineFlowLineRange | null
                           ├─► walkInlineFlowLines()             → lineCount (calls onLine per line)
                           └─► walkInlineFlowLineRanges()        → lineCount (calls onLine per line)

Utilities (no prepare required):
  clearCache()
  setLocale(locale?)
  profilePrepare()    → PrepareProfile (diagnostic; does all prepare() work internally)
```

Decision guide:
- **Height only, fixed width:** `prepare()` + `layout()`
- **Height only, width changes:** `prepare()` + `layout()` (re-call `layout()` on resize)
- **Line strings for rendering:** `prepareWithSegments()` + `layoutWithLines()`
- **Variable width per line:** `prepareWithSegments()` + `layoutNextLine()` loop
- **Geometry only, no strings:** `prepareWithSegments()` + `walkLineRanges()` or `layoutNextLineRange()`
- **Shrink-wrap to tightest width:** `prepareWithSegments()` + `walkLineRanges()` + binary search
- **Natural (no-wrap) width:** `prepareWithSegments()` + `measureNaturalWidth()`
- **Mixed items with atomic chips:** `prepareInlineFlow()` + `walkInlineFlowLines()`
- **Debug prepare timing:** `profilePrepare()`

---

## Known Open Design Questions (from TODO.md and AGENTS.md)

These are unresolved in the codebase as of version 0.0.4:

1. Whether line-fit tolerance should become runtime-calibrated (browser-detected) rather than hardcoded
2. Whether `pre-wrap` mode should be expanded beyond spaces/tabs/newlines (e.g. `pre` mode)
3. Whether `system-ui` should get a DOM-fallback measurement path on macOS
4. Whether server-side rendering support via a HarfBuzz or canvas-polyfill backend enters scope
5. Whether automatic hyphenation (via CSS `hyphens: auto`) is in scope
6. Whether bidi rendering concerns (selection, copy/paste) belong in this library
7. Whether Arabic corpus improvements need richer break-policy models
8. Whether there is a Thai `Intl.Segmenter` improvement path to close the CSS layout mismatch

---

## Sources

- [GitHub — chenglou/pretext](https://github.com/chenglou/pretext)
- [README.md (main)](https://github.com/chenglou/pretext/blob/main/README.md)
- [AGENTS.md](https://github.com/chenglou/pretext/blob/main/AGENTS.md)
- [DEVELOPMENT.md](https://github.com/chenglou/pretext/blob/main/DEVELOPMENT.md)
- [TODO.md](https://github.com/chenglou/pretext/blob/main/TODO.md)
- [src/layout.ts](https://github.com/chenglou/pretext/blob/main/src/layout.ts)
- [src/inline-flow.ts](https://github.com/chenglou/pretext/blob/main/src/inline-flow.ts)
- [src/measurement.ts](https://github.com/chenglou/pretext/blob/main/src/measurement.ts)
- [src/analysis.ts](https://github.com/chenglou/pretext/blob/main/src/analysis.ts)
- [src/bidi.ts](https://github.com/chenglou/pretext/blob/main/src/bidi.ts)
- [src/line-break.ts](https://github.com/chenglou/pretext/blob/main/src/line-break.ts)
- [src/layout.test.ts](https://github.com/chenglou/pretext/blob/main/src/layout.test.ts)
- [@chenglou/pretext on npm](https://www.npmjs.com/package/@chenglou/pretext)
- [Pretext demos](http://chenglou.me/pretext/)
- [Pretext Wiki](https://pretext.wiki/)
- [Pretext — JavaScript Text Measurement Without DOM Reflow](https://pretextjs.net/)
- [HN discussion: Pretext: TypeScript library for multiline text measurement and layout](https://news.ycombinator.com/item?id=47556290)
- [New TypeScript Library Pretext Tackles Text Reflow Bottlenecks — Dataconomy](https://dataconomy.com/2026/03/31/new-typescript-library-pretext-tackles-text-reflow-bottlenecks/)
- [The End of Layout Thrashing — Repo Explainer](https://repo-explainer.com/chenglou/pretext/)
- [DeepWiki: chenglou/pretext](https://deepwiki.com/chenglou/pretext)
- [Accessible Pretext demo — DEV Community](https://dev.to/micaavigliano/accessible-pretext-demo-1492)
- [Fast DOM-Free Text Height Measurement — CSS Script](https://www.cssscript.com/text-height-measurement-pretext/)
