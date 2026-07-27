# @nowui/kit

Shared UI primitives for NOW, SKYZ and future apps.

Ships **TypeScript source**, not a build. Consumers transpile it themselves — no
build pipeline here, no dist to keep in sync, and source maps just work.

| Export | Contents | Status |
|---|---|---|
| `@nowui/kit/grid` | MicroGrid + column adapter + responsive groups | extracted 2026-07-27 |
| `@nowui/kit/panels` | draggable panel layout engine | not yet extracted |

---

## Installing

Pin a tag per app. NOW can move fast on `main` while SKYZ stays on an older tag
until someone deliberately bumps it — that pinning is the whole point.

```json
"@nowui/kit": "github:Simpactsoft/now-ui#v0.1.0"
```

Then, in `next.config.ts`:

```ts
transpilePackages: ["@nowui/kit"]
```

Do **not** install with a `file:` path. Vercel builds remotely from the git
repo, the local path does not exist on the build machine, and the build fails
(or worse, silently resolves something stale).

### Tailwind v4

Tailwind does not scan `node_modules` by default, so the grid renders unstyled
until you point it at the package. In your global stylesheet:

```css
@source "../node_modules/@nowui/kit/src";
```

---

## Wiring the grid into a host app

`<MicroGrid />` works with no configuration: plain `<a>` links, Hebrew labels,
and the conventional density event name. A host that wants its own router,
labels or event name wraps the tree once.

### Next.js host

```tsx
"use client";
import NextLink from "next/link";
import { MicroGridConfigProvider, microGridLabels } from "@nowui/kit/grid";

export function GridConfig({ lang, children }: { lang: "he" | "en"; children: React.ReactNode }) {
    const value = useMemo(
        () => ({ Link: NextLink, labels: microGridLabels[lang], densityEventName: "appearance:density-change" }),
        [lang],
    );
    return <MicroGridConfigProvider value={value}>{children}</MicroGridConfigProvider>;
}
```

Pass `value` a **stable** object. The provider memoises on its three fields, so
an inline literal is tolerated, but a fresh `labels` object every render will
re-subscribe the density listener.

### What the host owns

| Config key | Default | Why it is a seam |
|---|---|---|
| `Link` | plain `<a>` | the grid must not depend on any router |
| `labels` | Hebrew | two group-toggle strings + the empty-state string |
| `densityEventName` | `appearance:density-change` | the host owns its appearance system |

`labels` is merged field-by-field over the defaults, so a partial override is
safe.

---

## What is deliberately NOT here

The grid renders rows. It does not fetch, filter, sort, paginate or persist —
the host owns all of that and hands the grid a finished array. Keep it that way;
it is the reason the component was extractable at all.

`UnifiedEntityCard` is **not** a candidate for this package. It is 856 lines of
application content — server actions, email composer, activity dialogs, tags,
flows. The generic part is the panel layout engine, and that ships separately as
`@nowui/kit/panels`.

---

## Extraction notes (2026-07-27)

Extracted from `now/next-web/src/components/microgrid`. The diff against the
source is exactly four seams and nothing else — no logic was touched:

1. `next/link` → `config.Link`
2. `@/lib/utils` → local `cn`
3. `@/lib/translations` → `config.labels`
4. `@/lib/appearance/config` → `config.densityEventName`

`entity-view/grid-column-shapes.ts` moved in wholesale as `column-shapes.ts` —
it was already documented in NOW as belonging to the adapter.

### One behavioural change, and it is a fix

NOW's version picked its language with:

```ts
document.documentElement.lang === "en" ? "en" : "he"
```

read **during render**. On the server that always returned `"he"`; on an English
client it returned `"en"` — a hydration mismatch waiting to happen. Language now
arrives through the provider, which is resolved identically on both sides.

### Test suite

`responsiveGroups.test.tsx` did not come across: it imports
`@/components/people/peopleResponsiveGroups`, an app fixture. It stays in NOW.
The other three suites moved verbatim (70 tests) and a fourth was added for the
config seam (8 tests).

```bash
npm run typecheck && npm test
```
