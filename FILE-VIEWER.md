# Should the file viewers become one source?

Short answer: **yes — but they are not duplicates, so "merge the two files" is
the wrong move.** They are two complementary halves of one component, and each
app built the half the other is missing.

Assessed 2026-07-27, read-only. Nothing in either app was modified.

## What each app actually has

### NOW — the format renderers

`next-web/src/components/cards/documents/`, 1,152 lines.

| File | Lines | Role |
|---|---|---|
| `DocumentPreview.tsx` | 259 | MIME/extension → viewer dispatch, lazy-loaded |
| `DocumentsBlock.tsx` | 361 | the card panel that lists attachments |
| `PptxViewer.tsx` | 147 | PowerPoint |
| `EmlViewer.tsx` | 121 | email messages |
| `ZipViewer.tsx` | 101 | archive contents |
| `MarkdownViewer.tsx` | 78 | Markdown |
| `DocxViewer.tsx` | 72 | Word |
| `PdfViewer.tsx` | 13 | PDF |

It resolves **13 kinds** — image, pdf, docx, pptx, eml, zip, markdown, csv,
sheet, json, xml, text, unsupported — from both MIME type and filename, and
code-splits each heavy viewer behind `next/dynamic`.

### SKYZ — the viewer shell

`skyz-crm/src/components/card/FileViewer.tsx`, 215 lines. A portal-mounted
overlay: paging across a card's attachments, swipe + 44px edge arrows, RTL-aware
keyboard nav, a metadata rail, "detach from card" instead of delete, and a
first-class empty-file state.

It renders **no formats at all**.

## Why this is the good case

There is no competing implementation to reconcile. NOW has renderers and a weak
shell; SKYZ has a strong shell and no renderers. The union is strictly better
than either, and neither app loses anything.

The seam is already obvious, and it is the same one the grid and panels use:

| Layer | Owner |
|---|---|
| format detection + per-format rendering | package |
| overlay chrome — paging, swipe, keyboard, metadata rail | package |
| fetching bytes / signed URLs, the file record shape | **host** |

Host coupling today is thin on both sides. Every one of NOW's per-format viewers
imports **only `react` and `lucide-react`** — zero app coupling, the cleanest
code in either repo. `DocumentPreview` is the only file with real ties, to
`card-document-actions`, `useAction` and `types/card-documents`; those become
the injected data seam. SKYZ's shell is tied to `SkyzFile` and `DerivedBadge`,
which is the same seam from the other end: a `ViewerFile` interface the host
maps onto.

## Sequencing — this is the part that matters

**Do not extract the SKYZ shell yet.** It landed in commit `6ef7c20` ("file
viewer with paging, swipe and a metadata rail") and the session that owns it is
still iterating. Extracting a file someone is actively writing is how you get a
third divergent copy.

1. **Now** — extract NOW's per-format viewers. They are stable, zero-coupling,
   and nothing in SKYZ touches them, so there is no collision risk at all. This
   also hands the SKYZ session something to drop into its shell.
2. **Define `ViewerFile`** — the minimal record both apps can map onto
   (`name`, `mimeType`, `size`, `url` or a `getUrl()` thunk). Agree it before
   either side writes an adapter.
3. **After the SKYZ shell settles** — lift it into the package and let both apps
   consume shell + renderers together.

Step 1 is safe today. Steps 2 and 3 need the other session in the loop.
