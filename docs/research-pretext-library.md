# Pretext Library — Technical Reference

Researched: 2026-04-02
Repo: https://github.com/chenglou/pretext
npm: https://www.npmjs.com/package/@chenglou/pretext
Live demos: https://chenglou.me/pretext/
Version researched: 0.0.4

---

## TLDR for BAARA Next

Pretext is NOT a React alternative. It is a text measurement and line-layout library that solves a very specific problem: computing the pixel height and line breaks of a text block without touching the DOM. It has no reactivity system, no component model, no state management, and no rendering pipeline. It cannot replace React, Zustand, or Tailwind.

The relevant question for BAARA Next is: does any part of the UI need to measure multi-line text height without triggering layout reflow? If yes (e.g., a virtualized log list, a masonry layout, a chat feed, a code output panel), Pretext can be used as a utility alongside React. If not, it is not relevant.

---

## 1. What It Is

Pretext is a pure TypeScript/JavaScript library for multiline text measurement and layout. It solves one specific bottleneck: knowing the height (and line structure) of a text block at a given container width, without reading from the DOM.

The problem it replaces: to know how tall a paragraph will render, the traditional approach is to insert it into the DOM and call `getBoundingClientRect()` or read `offsetHeight`. These calls trigger layout reflow — one of the most expensive browser operations. In a virtualized list with thousands of rows, or in a masonry grid, this forces the browser to lay out the entire page before you can get one measurement.

Pretext's approach: it uses the browser's Canvas 2D API (`CanvasRenderingContext2D.measureText`) to measure text segments, then performs its own line-breaking arithmetic. The canvas measurement call does NOT trigger DOM reflow. The result is height and line data that matches what the browser's CSS engine would produce, without ever touching the DOM layout tree.

Performance claim from the repo benchmarks:
- `prepare()` (one-time analysis + canvas measurement): ~19ms for a batch of 500 texts
- `layout()` (arithmetic-only hot path, e.g. on resize): ~0.09ms for the same 500-text batch
- Claimed overall speedup: 300–600x over DOM measurement

Creator: Cheng Lou — former React core team member, co-creator of ReasonML, currently at Midjourney.

Credit note from README: "Sebastian Markbage first planted the seed with text-layout last decade. His design — canvas measureText for shaping, bidi from pdf.js, streaming line breaking — informed the architecture we kept pushing forward here."

---

## 2. Language and Runtime

| Property | Value |
|---|---|
| Implementation language | TypeScript |
| Published format | ESM (`dist/layout.js` + `dist/layout.d.ts`) |
| Runtime target | Browser (requires Canvas 2D API: `CanvasRenderingContext2D.measureText`) |
| Server-side | Not supported yet; explicitly listed as future work ("soon, server-side" in README) |
| Node.js / Bun | Not currently supported for measurement (no canvas); would need a canvas shim |
| Dev toolchain | Bun (not required as a consumer dependency — only for repo development) |
| TypeScript version (dev) | 6.0.2 |
| Module system | ESM only (`"type": "module"`) |
| No external runtime dependencies | True — zero runtime dependencies in package.json |

---

## 3. API Surface

The library exports two entrypoints:

### Main entrypoint: `@chenglou/pretext`

#### Use-case 1: Measure height only (no line data needed)

```ts
import { prepare, layout } from '@chenglou/pretext'

// One-time pass: normalizes whitespace, segments text, measures with canvas, returns opaque handle.
// font format is identical to CanvasRenderingContext2D.font (e.g. '16px Inter', '500 17px "Helvetica Neue"')
const prepared = prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }): PreparedText

// Hot path: pure arithmetic, no DOM, no canvas.
const { height, lineCount } = layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number }
```

Key contract: `prepare()` is expensive (canvas calls); `layout()` is cheap (arithmetic). On resize, call only `layout()` again with the new width. Never re-call `prepare()` for the same text/font pair.

#### Use-case 2: Manual line layout (get actual line strings and geometry)

```ts
import { prepareWithSegments, layoutWithLines, walkLineRanges, layoutNextLine, layoutNextLineRange, materializeLineRange, measureLineGeometry, measureNaturalWidth } from '@chenglou/pretext'

// Same as prepare() but returns a richer handle for line-level APIs
const prepared = prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }): PreparedTextWithSegments

// All lines at a fixed width — returns line text strings + geometry
const { height, lineCount, lines } = layoutWithLines(prepared, maxWidth: number, lineHeight: number): { height: number, lineCount: number, lines: LayoutLine[] }

// Non-materializing walker — does NOT build line text strings; calls onLine per line
// Returns total height. Useful for binary-search on width or shrink-wrap calculations.
const height = walkLineRanges(prepared, maxWidth: number, onLine: (line: LayoutLineRange) => void): number

// Variable-width layout — route text line-by-line where each line can have a different width
// Returns null when paragraph is exhausted
const line = layoutNextLine(prepared, start: LayoutCursor, maxWidth: number): LayoutLine | null

// Non-materializing version of layoutNextLine
const lineRange = layoutNextLineRange(prepared, start: LayoutCursor, maxWidth: number): LayoutLineRange | null

// Turn a LayoutLineRange into a LayoutLine with actual text
const line = materializeLineRange(prepared, line: LayoutLineRange): LayoutLine

// Aggregate geometry: line count + widest line width
const { lineCount, maxLineWidth } = measureLineGeometry(prepared, maxWidth: number)

// Intrinsic width: widest line when no container width is forcing wraps (i.e. text's natural width)
const width = measureNaturalWidth(prepared): number
```

#### Types

```ts
type LayoutLine = {
  text: string        // Full text content of this line, e.g. 'hello world'
  width: number       // Measured pixel width of this line
  start: LayoutCursor
  end: LayoutCursor
}

type LayoutLineRange = {
  width: number
  start: LayoutCursor
  end: LayoutCursor
  // No text string — cheaper to compute
}

type LayoutCursor = {
  segmentIndex: number   // Index into prepared segments
  graphemeIndex: number  // Grapheme offset within that segment; 0 at boundaries
}
```

#### Utility functions

```ts
clearCache(): void
// Clears the shared internal segment-metrics cache (Map<font, Map<segment, metrics>>).
// Use when cycling through many fonts/text variants to release memory.

setLocale(locale?: string): void
// Sets locale for Intl.Segmenter used in future prepare() calls.
// Also calls clearCache() internally.
// Does NOT mutate existing PreparedText handles.
```

### Sidecar entrypoint: `@chenglou/pretext/inline-flow` (experimental alpha)

Handles mixed inline runs — e.g. text with embedded chips/pills that must not be broken.

```ts
import { prepareInlineFlow, walkInlineFlowLines, layoutNextInlineFlowLine, layoutNextInlineFlowLineRange, walkInlineFlowLineRanges, measureInlineFlowGeometry, measureInlineFlow } from '@chenglou/pretext/inline-flow'

type InlineFlowItem = {
  text: string            // raw text including collapsible leading/trailing spaces
  font: string            // canvas font shorthand
  break?: 'normal' | 'never'  // 'never' = atomic chip, cannot be broken mid-item
  extraWidth?: number     // additional horizontal space (padding + border) owned by caller
}

type InlineFlowFragment = {
  itemIndex: number       // back-reference to source InlineFlowItem
  text: string
  gapBefore: number       // collapsed whitespace gap before this fragment on this line
  occupiedWidth: number   // text width + extraWidth
  start: LayoutCursor
  end: LayoutCursor
}

type InlineFlowLine = {
  fragments: InlineFlowFragment[]
  width: number
  end: InlineFlowCursor
}

type InlineFlowCursor = {
  itemIndex: number
  segmentIndex: number
  graphemeIndex: number
}
```

Constraints on inline-flow (intentionally narrow):
- Raw text input only; no nested markup tree
- `white-space: normal` only (no `pre-wrap`)
- No `padding`, `margin`, `border` model — caller provides `extraWidth` manually
- Not a general CSS inline formatting engine

---

## 4. How It Works (Architecture)

### Phase 1: `prepare()` — Text analysis + canvas measurement

Performed once per (text, font) pair. Steps:

1. Normalize whitespace according to `white-space: normal` or `pre-wrap`
2. Segment the text using `Intl.Segmenter` (grapheme clusters, word boundaries)
3. Apply "glue rules": mark non-breaking segments (NBSP, WJ, NNBSP), zero-width break opportunities (ZWSP), soft hyphens, hard breaks
4. Identify script-specific rules: Arabic punctuation clusters, CJK kinsoku (line-start/end prohibited chars), Southeast Asian word segmentation, emoji ZWJ sequences
5. Measure each unique segment via `canvas.measureText()` — results cached in `Map<font, Map<segment, metrics>>`
6. Return an opaque `PreparedText` handle (or `PreparedTextWithSegments` for the rich API)

The internal segment model distinguishes at least 8 break kinds: normal text, collapsible spaces, preserved spaces, tabs, non-breaking glue, zero-width break opportunities, soft hyphens, and hard breaks.

### Phase 2: `layout()` — Pure arithmetic

Takes a `PreparedText` handle + `maxWidth` + `lineHeight`. Performs no canvas calls, no DOM reads, no string operations. Iterates over cached segment widths and applies line-breaking rules to compute line count and total height.

Key invariant from AGENTS.md: "`layout()` is the resize hot path: no DOM reads, no canvas calls, no string work, and avoid gratuitous allocations."

### Canvas vs DOM accuracy

Pretext uses canvas `measureText` as its ground truth for segment widths, then validates against what the browser's CSS layout engine would actually produce. The repo includes extensive accuracy test infrastructure (`bun run accuracy-check`) that runs a browser sweep comparing Pretext's computed line heights against actual DOM measurements.

Current line-fit tolerance:
- Chromium/Gecko: `0.005` (sub-pixel tolerance)
- Safari/WebKit: `1/64`

### Supported CSS configuration

Pretext targets a specific common configuration only:
- `white-space: normal` (default) or `white-space: pre-wrap` (opt-in)
- `word-break: normal`
- `overflow-wrap: break-word`
- `line-break: auto`

These are NOT supported and behavior is undefined:
- `word-break: break-all` or `keep-all`
- `line-break: strict` or `loose`
- `overflow-wrap: anywhere`

Known caveat: `system-ui` font is unsafe on macOS because canvas and DOM can resolve to different font files. Use a named font (e.g. `Inter`, `Helvetica Neue`).

---

## 5. Integration with TypeScript/React

### Installation

```sh
npm install @chenglou/pretext
# or
pnpm add @chenglou/pretext
# or
bun add @chenglou/pretext
```

### Usage in a React component

Pretext is a pure utility library — it has no React bindings, no hooks, no JSX. You call it from wherever you need text height. A typical React pattern:

```ts
import { prepare, layout } from '@chenglou/pretext'
import { useMemo } from 'react'

function useTextHeight(text: string, font: string, containerWidth: number, lineHeight: number) {
  // prepare() is expensive — memoize on (text, font)
  const prepared = useMemo(() => prepare(text, font), [text, font])
  // layout() is cheap — recompute on width change
  return useMemo(() => layout(prepared, containerWidth, lineHeight), [prepared, containerWidth, lineHeight])
}
```

### Can it replace React?

No. Pretext has no concept of:
- Components
- State or reactivity
- Event handling
- DOM diffing or reconciliation
- The virtual DOM

It produces numbers (pixel height, line count, line strings) from text input. What you do with those numbers is entirely up to you and your framework.

### Does it work alongside React?

Yes, without friction. It is a zero-dependency ESM library that exports pure functions. You import it, call it, get numbers. No global state (beyond its internal cache), no side effects at import time, no context providers required. It is compatible with any framework or no framework.

### Vite compatibility

No issues expected. It ships pure ESM with no exotic build requirements. No special Vite config needed.

### Zustand compatibility

No interaction — Pretext does not touch state management. You would store `PreparedText` handles or computed heights in Zustand if needed.

### Tailwind compatibility

No interaction. Tailwind handles CSS; Pretext handles measurement. You must ensure your Tailwind font settings (font family, size, weight) match the `font` string you pass to `prepare()`. These are separate responsibilities.

---

## 6. Maturity and Ecosystem

| Metric | Value |
|---|---|
| Initial repo creation | 2026-03-07 |
| Age at research date | ~26 days old |
| Current version | 0.0.4 |
| GitHub stars | 37,659 |
| Forks | 1,966 |
| Open issues | 68 |
| Last push | 2026-04-04 (actively developed) |
| License | MIT |

The library went viral within 48 hours of announcement (~14,000 stars in 48h, 19M views on X per community reports). Despite the star count, the version is `0.0.4` — this is pre-1.0 software with no stability guarantees.

Production users: not documented in the repo. No production case studies found. The repo demos (editorial engine, chat bubbles, dynamic layout) are the primary showcase.

Known open design questions from TODO.md:
- Whether `{ whiteSpace: 'pre-wrap' }` should expand beyond spaces/tabs/newlines
- Whether server-side canvas backend becomes officially supported
- Whether `system-ui` gets a DOM-fallback measurement path on macOS
- Whether automatic hyphenation is in scope
- Whether bidi rendering (selection, copy/paste) belongs here

---

## 7. Comparison to React

This comparison is only meaningful in the narrow domain where they overlap: rendering text to a UI. They are fundamentally different categories of tool.

| Dimension | React | Pretext |
|---|---|---|
| Category | UI component framework | Text measurement utility library |
| Reactivity | Yes — state, effects, reconciliation | None |
| Rendering | Manages the DOM (or native) | Produces numbers; caller renders |
| Component model | Yes | None |
| Text handling | Delegates entirely to browser CSS | Computes it explicitly |
| Text height measurement | Not provided; you query the DOM | Core feature |
| Virtualization | Not built-in (use react-window etc) | Enables accurate virtualization |
| Internationalization | Not built-in | First-class (bidi, CJK, emoji, SE Asian) |
| Bundle size | Large (~40KB+ gzipped) | 15KB (community reports; not verified from dist) |
| Stability | Production-stable (v18/v19) | Pre-1.0, 26 days old |
| Production users | Massive ecosystem | None documented |

### What Pretext does better than React

- Knows the height of a text block without DOM reflow — React cannot do this at all without a ref + measurement effect
- Handles mixed-bidi text, CJK line-breaking rules, emoji ZWJ sequences, and SE Asian word segmentation with browser-validated accuracy
- Enables variable-width line routing (text flowing around an image obstacle) — impossible with standard CSS without JS measurement
- Enables shrink-wrap: finding the tightest container width that still fits multi-line text without overflow

### What React does that Pretext does not

Everything else. React is a complete UI runtime. Pretext is a measuring tape.

---

## 8. Relevance Assessment for BAARA Next

BAARA Next currently uses: React + Vite + Zustand + Tailwind.

Pretext is potentially relevant if any of these UI patterns are needed:

1. **Virtualized log/event lists** — If the task execution engine produces large streams of log lines or events, a virtualized list (e.g. react-window, tanstack-virtual) needs row heights in advance. Pretext eliminates the need for fixed row heights or dynamic measurement with ResizeObserver.

2. **Chat or message feed UI** — Variable-height message bubbles. Pretext can compute bubble height before the bubble is rendered, enabling scroll-anchoring when new messages arrive.

3. **Code output panels** — If output is displayed with `white-space: pre-wrap`, Pretext's pre-wrap mode can measure height without reflow.

4. **Badge/chip overflow detection** — Using the inline-flow sidecar to detect whether a label or tag fits in a given container width without rendering and measuring.

Pretext is NOT relevant if:
- All text blocks have fixed or CSS-managed heights
- The UI has no virtualized lists with variable-height rows
- Text rendering is handled entirely by standard browser layout

### Risk factors for adoption

- Version `0.0.4`, 26 days old — no stability guarantees, API may change
- No React hooks or bindings provided — integration is manual
- Server-side rendering not supported — if BAARA Next does SSR, Pretext cannot run during server render (canvas unavailable in Node/Bun without a shim)
- `system-ui` font unsupported for accuracy — must use explicit font names matching your Tailwind config
- The `inline-flow` sidecar is explicitly labeled "experimental alpha"

---

## Code Examples

### Measure text height for a virtualized list row

```ts
import { prepare, layout } from '@chenglou/pretext'

const FONT = '14px Inter'          // must match your CSS font declaration exactly
const LINE_HEIGHT = 20             // must match your CSS line-height in pixels
const CONTAINER_WIDTH = 640        // whatever the list container's content width is

// Call once per unique (text, font) pair — e.g. when row data loads
const prepared = prepare(rowText, FONT)

// Call on every width change (e.g. window resize)
const { height, lineCount } = layout(prepared, CONTAINER_WIDTH, LINE_HEIGHT)
```

### Flow text around an obstacle (image)

```ts
import { prepareWithSegments, layoutNextLine } from '@chenglou/pretext'

const prepared = prepareWithSegments(text, '16px Inter')

let cursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0
const image = { bottom: 120, width: 160 }
const columnWidth = 480

while (true) {
  const lineWidth = y < image.bottom ? columnWidth - image.width : columnWidth
  const line = layoutNextLine(prepared, cursor, lineWidth)
  if (line === null) break
  ctx.fillText(line.text, y < image.bottom ? image.width : 0, y)
  cursor = line.end
  y += 26
}
```

### Shrink-wrap: find tightest width that keeps text to N lines

```ts
import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext'

const prepared = prepareWithSegments(text, '14px Inter')

let lo = 0, hi = 800
while (lo < hi - 1) {
  const mid = (lo + hi) / 2
  let count = 0
  walkLineRanges(prepared, mid, () => { count++ })
  if (count <= 2) hi = mid
  else lo = mid
}
const tightestWidth = hi  // narrowest width that keeps text to 2 lines
```

### Mixed inline items with chips

```ts
import { prepareInlineFlow, walkInlineFlowLines } from '@chenglou/pretext/inline-flow'

const prepared = prepareInlineFlow([
  { text: 'Task executed by ', font: '14px Inter' },
  { text: 'agent-welder', font: '600 12px Inter', break: 'never', extraWidth: 16 },
  { text: ' in 3.2s', font: '14px Inter' },
])

walkInlineFlowLines(prepared, containerWidth, (line) => {
  for (const fragment of line.fragments) {
    // render each fragment at its position
  }
})
```

---

Sources:
- [GitHub - chenglou/pretext](https://github.com/chenglou/pretext)
- [pretext README.md](https://github.com/chenglou/pretext/blob/main/README.md)
- [pretext AGENTS.md](https://github.com/chenglou/pretext/blob/main/AGENTS.md)
- [pretext DEVELOPMENT.md](https://github.com/chenglou/pretext/blob/main/DEVELOPMENT.md)
- [@chenglou/pretext on npm](https://www.npmjs.com/package/@chenglou/pretext)
- [New TypeScript Library Pretext Tackles Text Reflow Bottlenecks - Dataconomy](https://dataconomy.com/2026/03/31/new-typescript-library-pretext-tackles-text-reflow-bottlenecks/)
