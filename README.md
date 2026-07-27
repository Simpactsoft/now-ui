# @nowui/kit

Shared UI primitives for NOW, SKYZ and future apps.

Ships **TypeScript source**, not a build. Consumers transpile it themselves — no
build pipeline here, no dist to keep in sync, and source maps just work.

| Export | Contents | Status |
|---|---|---|
| `@nowui/kit/grid` | MicroGrid + column adapter + responsive groups | extracted 2026-07-27 |
| `@nowui/kit/panels` | draggable panel layout engine + persistence contract | extracted 2026-07-27 |
| `@nowui/kit/file-viewer` | format renderers + viewer shell | see [FILE-VIEWER.md](FILE-VIEWER.md) |

**Neither app consumes this package yet** — it has no git remote, so nothing can
install it. Until that happens these are third copies, and they will drift.
Publishing and wiring NOW is the next step; see [DRIFT.md](DRIFT.md).

---

## Installing

Pin a tag per app. NOW can move fast while SKYZ stays on an older tag until
someone deliberately bumps it — that pinning is the whole point.

```json
"@nowui/kit": "https://github.com/Simpactsoft/now-ui/archive/refs/tags/v0.1.2.tar.gz"
```

Then, in `next.config.ts`:

```ts
transpilePackages: ["@nowui/kit"]
```

**Use the archive URL, not the `github:` shorthand.** npm rewrites `github:` to
`ssh://git@github.com/…`, which needs an SSH key that neither a fresh dev
machine nor a Vercel build agent has. The tarball URL is plain HTTPS on a public
repo: no git, no SSH, no token, and it behaves identically locally and in CI.

Do **not** install with a `file:` path either. Vercel builds remotely from the
git repo, the local path does not exist on the build machine, and the build
fails — or worse, silently resolves something stale.

### Peer dependencies — do not "fix" these into regular deps

React, Radix, dnd-kit and lucide-react are **peer** dependencies on purpose.
Anything that carries React context must resolve to a **single copy shared with
the host**, and npm will happily nest a second one if these are listed as
regular dependencies.

That is not theoretical: it is exactly what happened wiring NOW. npm installed
Radix twice (host `react-menu` 2.1.16, a nested 2.1.24), and because React
context is instance-scoped, host-built `DropdownMenuItem` nodes passed into
`PanelDef.menuItems` could not see the `Menu` context created by the package's
`DropdownMenu`. The failure reads `MenuItem must be used within Menu` and would
have broken every panel kebab menu in the app.

If you see that error, or any "must be used within" context error, check first:

```bash
ls node_modules/@nowui/kit/node_modules
```

Anything listed there is a duplicate. It should not exist.

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

`densityEventName` has **no portable default worth trusting** — each app names
its own event. NOW's is `now:appearance-density-change`
(`lib/appearance/config.ts`); the package default is a neutral
`appearance:density-change` and will silently never fire if you forget to
override it. Import the host's own constant rather than retyping the string.

```tsx
"use client";
import { useMemo } from "react";
import NextLink from "next/link";
import { MicroGridConfigProvider, microGridLabels } from "@nowui/kit/grid";
import { APPEARANCE_DENSITY_EVENT } from "@/lib/appearance/config";
import { useLanguage } from "@/context/LanguageContext";

export function GridConfig({ children }: { children: React.ReactNode }) {
    const { language } = useLanguage();
    const value = useMemo(
        () => ({
            Link: NextLink,
            labels: microGridLabels[language],
            densityEventName: APPEARANCE_DENSITY_EVENT,
        }),
        [language],
    );
    return <MicroGridConfigProvider value={value}>{children}</MicroGridConfigProvider>;
}
```

Taking `language` from the app's own context — rather than sniffing
`document.documentElement.lang` the way NOW's inlined copy did — is what makes
the server and client agree. See "one behavioural change" below.

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

---

## Wiring the panels into a host app

The host supplies the whole layout-persistence hook. NOW passes its existing
`usePanelLayoutDB` unchanged — the contract in `panels/persistence.ts` was lifted
from that hook's signature on purpose.

```tsx
"use client";
import { useMemo } from "react";
import { PanelsConfigProvider, panelLabels } from "@nowui/kit/panels";
import { usePanelLayoutDB } from "@/hooks/usePanelLayoutDB";
import { useLanguage } from "@/context/LanguageContext";

export function PanelsConfig({ children }: { children: React.ReactNode }) {
    const { language } = useLanguage();
    const value = useMemo(
        () => ({ usePanelLayout: usePanelLayoutDB, labels: panelLabels[language] }),
        [language],
    );
    return <PanelsConfigProvider value={value}>{children}</PanelsConfigProvider>;
}
```

⚠️ **Two rules, both load-bearing:**

1. `usePanelLayout` must have a **stable identity**. It is called like any other
   hook inside the grid, so swapping it between renders changes hook order.
2. What it **returns** must be referentially stable too — `dbLayout` and the
   callbacks land in effect dependency arrays. A fresh object every render
   causes an infinite render loop, and the symptom is a **hang, not an error**.

With no provider the panels use `ephemeralPanelLayout`: everything works,
arrangements just do not survive a reload.

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
