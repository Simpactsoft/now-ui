"use client";

// MicroGrid host configuration
// ----------------------------
// MicroGrid ships framework-agnostic. Everything it needs from the host app —
// the router's Link, the two group-toggle labels, and the name of the event the
// app dispatches when global density changes — arrives through this context.
//
// Defaults are chosen so that `<MicroGrid />` works with no provider at all:
// a plain <a>, Hebrew labels, and the conventional density event name. A host
// that wants Next.js client-side navigation wraps its tree once:
//
//   <MicroGridConfigProvider value={{ Link: NextLink }}>
//
// This is deliberately NOT a module-level singleton: under the App Router the
// same module can be evaluated in more than one bundle, and a singleton set in
// one would be invisible to the other.

import { createContext, useContext, useMemo, type ComponentType, type MouseEvent, type ReactNode } from "react";

/** Props MicroGrid passes to a navigable cell's link. */
export interface MicroGridLinkProps {
    href: string;
    /** Next.js honours this; a plain <a> ignores it. */
    prefetch?: boolean;
    title?: string;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
    children: ReactNode;
}

export type MicroGridLinkComponent = ComponentType<MicroGridLinkProps>;

/**
 * Every user-visible string the grid and its two chrome components render.
 *
 * Flat and prefixed rather than nested: `MicroGridConfigInput` merges `labels`
 * with one spread, so a host overriding a single string must not have to
 * restate a whole nested group. Strings that interpolate are functions — a
 * `{n}` placeholder in a string cannot be reordered for a language whose
 * grammar puts the number elsewhere.
 */
export interface MicroGridLabels {
    collapseGroup: string;
    expandGroup: string;
    /** Shown by the built-in empty state when the host passes no message. */
    empty: string;
    /** Prefix for a sortable header's aria-label, e.g. "Sort by" + " " + column. */
    sortBy: string;

    // --- ColumnFilter ---
    filterBy: (column: string) => string;
    filterActive: (n: number) => string;
    filterSelectAll: string;
    filterClear: string;
    /** Explains that facet counts come from the server, over the filtered set. */
    filterCountsNote: string;
    filterSearchPlaceholder: (total: number) => string;
    filterMatchCount: (shown: number, total: number) => string;
    /** Shown when a facet's whole vocabulary is 1–2 values — usually a schema fault. */
    filterSparseWarning: string;
    filterSelectedNote: (n: number) => string;
    filterNoMatch: string;
    /** Says the search runs over the facet vocabulary, not over the rows. */
    filterNoMatchHint: string;
    filterNoOptions: string;
    filterOnly: string;
    filterOnlyTitle: (value: string) => string;
    filterShowMore: (n: number) => string;
    filterHiddenNote: (n: number) => string;

    // --- ColumnChooser ---
    chooserTrigger: string;
    chooserTriggerAria: string;
    chooserTitle: (visible: number) => string;
    chooserReset: string;
    chooserShow: string;
    chooserHide: string;
    chooserPin: string;
    chooserUnpin: string;
    chooserPinTitle: string;
    chooserUnpinTitle: string;
    chooserMoveUp: string;
    chooserMoveDown: string;

    // --- FacetPanel: kinds the column popover never had ---
    /** The nine date presets, keyed by id — see `DATE_PRESET_IDS`. */
    datePresets: Record<string, string>;
    dateCustomRange: string;
    dateFrom: string;
    dateTo: string;
    dateShowing: (window: string) => string;
    dateNoRange: string;
    /** Says the range includes both ends and compares dates, not strings. */
    dateRangeNote: string;
    presenceAny: string;
    presenceHas: (field: string) => string;
    presenceHasNot: (field: string) => string;

    // --- BrowseShell ---
    browseSearchPlaceholder: string;
    browseClearSearch: string;
    browseAddFilter: string;
    browseAddFilterHint: string;
    browseClose: string;
    browseClearAll: string;
    browseHintValues: string;
    browseHintDate: string;
    browseHintPresence: string;
    browseQuickDates: string;
    browseLoadMore: (n: number) => string;
    browseCount: (shown: number, total: number) => string;

    // --- SavedViews + FilterStateBar ---
    viewsTitle: string;
    viewsAll: string;
    viewsAllHint: string;
    viewsBackToAll: string;
    viewsNamePlaceholder: string;
    viewsRename: string;
    viewsDuplicate: string;
    viewsDelete: string;
    viewsShared: string;
    viewsPrivate: string;
    viewsMakePrivate: string;
    viewsMakeShared: string;
    viewsEmpty: string;
    viewsChangedBadge: string;
    viewsConditions: (n: number) => string;
    /** The three filter states of §9. */
    stateNoFilterHint: string;
    stateUnsaved: string;
    stateSaveAsView: string;
    stateSaveChange: string;
    stateSaveAsNew: string;
    stateRestore: string;
    stateDrifted: string;
    stateSave: string;
    stateCancel: string;
    stateClear: string;
    viewsCaption: string;
    viewsCreatedBy: (who: string) => string;
    viewsWillSave: string;
    viewsSaveCurrent: string;
}

export interface MicroGridConfig {
    Link: MicroGridLinkComponent;
    labels: MicroGridLabels;
    /**
     * Window event the host dispatches when the global density preference
     * changes. MicroGrid subscribes to it and re-reads
     * `document.documentElement.dataset.density`.
     */
    densityEventName: string;
}

/** Plain anchor — the zero-dependency default. */
function DefaultLink({ href, prefetch: _prefetch, ...rest }: MicroGridLinkProps) {
    return <a href={href} {...rest} />;
}

const HE_LABELS: MicroGridLabels = {
    collapseGroup: "כווץ קבוצה",
    expandGroup: "הרחב קבוצה",
    empty: "אין שורות להצגה",
    sortBy: "מיין לפי",

    filterBy: (column) => `סינון לפי ${column}`,
    filterActive: (n) => `${n} פעילים`,
    filterSelectAll: "בחר הכל",
    filterClear: "נקה",
    filterCountsNote: "ספירות מחושבות בשרת על הקבוצה המסוננת",
    filterSearchPlaceholder: (total) => `חיפוש בין ${total} ערכים…`,
    filterMatchCount: (shown, total) => `${shown} מתוך ${total}`,
    filterSparseWarning: "אוצר המילים של הרשימה דל — ייתכן שהערכים לא הוגדרו כראוי בסכימה",
    filterSelectedNote: (n) => (n === 1 ? "נבחר ערך אחד — מוצג ראשון" : `נבחרו ${n} ערכים — מוצגים ראשונים`),
    filterNoMatch: "אין ערך תואם",
    filterNoMatchHint: "החיפוש רץ על אוצר המילים של הרשימה, לא על הכרטיסים.",
    filterNoOptions: "אין ערכים לסינון",
    filterOnly: "רק",
    filterOnlyTitle: (value) => `הצג רק ${value}`,
    filterShowMore: (n) => `הצג ${n} נוספים`,
    filterHiddenNote: (n) => `עוד ${n} ערכים לא מוצגים — צמצם בחיפוש`,

    chooserTrigger: "הגדרות תצוגה",
    chooserTriggerAria: "הגדרות תצוגה — בחירת וסידור עמודות",
    chooserTitle: (visible) => `עמודות (${visible})`,
    chooserReset: "איפוס",
    chooserShow: "הצג",
    chooserHide: "הסתר",
    chooserPin: "הצמד",
    chooserUnpin: "בטל הצמדת",
    chooserPinTitle: "הצמד לתחילת הטבלה",
    chooserUnpinTitle: "בטל הצמדה לתחילת הטבלה",
    chooserMoveUp: "הזז מעלה",
    chooserMoveDown: "הזז מטה",

    datePresets: {
        today: "היום",
        yesterday: "אתמול",
        d7: "7 ימים אחרונים",
        d30: "30 ימים אחרונים",
        month: "החודש",
        prevMonth: "החודש שעבר",
        quarter: "הרבעון",
        year: "השנה",
        stale90: "ללא פעילות 90 יום",
    },
    dateCustomRange: "טווח מותאם",
    dateFrom: "מ־",
    dateTo: "עד",
    dateShowing: (w) => `מציג רשומות: ${w}`,
    dateNoRange: "לא נבחר טווח — כל הרשומות",
    dateRangeNote: "הטווח כולל את שני הקצוות, וההשוואה רצה על תאריכים ולא על מחרוזות",
    presenceAny: "לא משנה",
    presenceHas: (f) => `יש ${f}`,
    presenceHasNot: (f) => `אין ${f}`,

    browseSearchPlaceholder: "חיפוש ברשימה…",
    browseClearSearch: "נקה חיפוש",
    browseAddFilter: "סינון",
    browseAddFilterHint: "הוסף סינון לפי שדה — ייפתח בחלונית הפיסוט של אותו שדה",
    browseClose: "סגור ✕",
    browseClearAll: "נקה הכל",
    browseHintValues: "בחירה מרובה מתוך הערכים בתוצאה",
    browseHintDate: "טווח מוכן או תאריכים מותאמים",
    browseHintPresence: "יש / אין / לא משנה",
    browseQuickDates: "פעילות",
    browseLoadMore: (n) => `טען ${n} נוספים`,
    browseCount: (shown, total) => `${shown} מתוך ${total}`,

    viewsTitle: "תצוגות שמורות",
    viewsAll: "כל הרשומות",
    viewsAllHint: "מנקה את הסינון ויוצא מהתצוגה השמורה",
    viewsBackToAll: "חזרה לכל הרשומות",
    viewsNamePlaceholder: "שם התצוגה",
    viewsRename: "שנה שם",
    viewsDuplicate: "שכפל",
    viewsDelete: "מחק תצוגה",
    viewsShared: "משותפת",
    viewsPrivate: "פרטית",
    viewsMakePrivate: "משותפת לכולם — לחץ להפוך לפרטית",
    viewsMakeShared: "פרטית — לחץ לשתף",
    viewsEmpty: "אין עדיין תצוגות. סנן את הרשימה ושמור אותה כאן.",
    viewsChangedBadge: "שונה",
    viewsConditions: (n) => (n === 1 ? "תנאי אחד" : `${n} תנאים`),
    stateNoFilterHint: "בחר תצוגה שמורה, או סנן ואז שמור",
    stateUnsaved: "סינון לא שמור",
    stateSaveAsView: "שמור כתצוגה",
    stateSaveChange: "שמור שינוי",
    stateSaveAsNew: "שמור כחדש",
    stateRestore: "שחזר",
    stateDrifted: "הסינון שונה מהתצוגה השמורה",
    stateSave: "שמור",
    stateCancel: "ביטול",
    stateClear: "נקה",
    viewsCaption: "תצוגה שומרת סינון, מיון והסתרות — לא נתונים",
    viewsCreatedBy: (who) => `נוצר על ידי ${who}`,
    viewsWillSave: "יישמר:",
    viewsSaveCurrent: "שמור סינון נוכחי",
};

const EN_LABELS: MicroGridLabels = {
    collapseGroup: "Collapse group",
    expandGroup: "Expand group",
    empty: "No rows to display",
    sortBy: "Sort by",

    filterBy: (column) => `Filter by ${column}`,
    filterActive: (n) => `${n} active`,
    filterSelectAll: "Select all",
    filterClear: "Clear",
    filterCountsNote: "Counts are computed on the server, over the filtered set",
    filterSearchPlaceholder: (total) => `Search ${total} values…`,
    filterMatchCount: (shown, total) => `${shown} of ${total}`,
    filterSparseWarning: "This list has very few values — they may not be defined properly in the schema",
    filterSelectedNote: (n) => (n === 1 ? "One value selected — shown first" : `${n} values selected — shown first`),
    filterNoMatch: "No matching value",
    filterNoMatchHint: "The search runs over the list's vocabulary, not over the records.",
    filterNoOptions: "Nothing to filter by",
    filterOnly: "only",
    filterOnlyTitle: (value) => `Show only ${value}`,
    filterShowMore: (n) => `Show ${n} more`,
    filterHiddenNote: (n) => `${n} more values hidden — narrow with search`,

    chooserTrigger: "View settings",
    chooserTriggerAria: "View settings — choose and order columns",
    chooserTitle: (visible) => `Columns (${visible})`,
    chooserReset: "Reset",
    chooserShow: "Show",
    chooserHide: "Hide",
    chooserPin: "Pin",
    chooserUnpin: "Unpin",
    chooserPinTitle: "Pin to the leading edge",
    chooserUnpinTitle: "Unpin from the leading edge",
    chooserMoveUp: "Move up",
    chooserMoveDown: "Move down",

    datePresets: {
        today: "Today",
        yesterday: "Yesterday",
        d7: "Last 7 days",
        d30: "Last 30 days",
        month: "This month",
        prevMonth: "Last month",
        quarter: "This quarter",
        year: "This year",
        stale90: "No activity in 90 days",
    },
    dateCustomRange: "Custom range",
    dateFrom: "From",
    dateTo: "To",
    dateShowing: (w) => `Showing: ${w}`,
    dateNoRange: "No range selected — all records",
    dateRangeNote: "The range includes both ends, and compares dates rather than strings",
    presenceAny: "Any",
    presenceHas: (f) => `Has ${f}`,
    presenceHasNot: (f) => `No ${f}`,

    browseSearchPlaceholder: "Search the list…",
    browseClearSearch: "Clear search",
    browseAddFilter: "Filter",
    browseAddFilterHint: "Add a filter by field — opens that field's facet panel",
    browseClose: "Close ✕",
    browseClearAll: "Clear all",
    browseHintValues: "Multi-select from the values in the result",
    browseHintDate: "A preset window or custom dates",
    browseHintPresence: "Has / has not / any",
    browseQuickDates: "Activity",
    browseLoadMore: (n) => `Load ${n} more`,
    browseCount: (shown, total) => `${shown} of ${total}`,

    viewsTitle: "Saved views",
    viewsAll: "All records",
    viewsAllHint: "Clears the filter and leaves the saved view",
    viewsBackToAll: "Back to all records",
    viewsNamePlaceholder: "View name",
    viewsRename: "Rename",
    viewsDuplicate: "Duplicate",
    viewsDelete: "Delete view",
    viewsShared: "Shared",
    viewsPrivate: "Private",
    viewsMakePrivate: "Shared with everyone — click to make private",
    viewsMakeShared: "Private — click to share",
    viewsEmpty: "No views yet. Filter the list and save it here.",
    viewsChangedBadge: "Changed",
    viewsConditions: (n) => (n === 1 ? "one condition" : `${n} conditions`),
    stateNoFilterHint: "Pick a saved view, or filter and then save",
    stateUnsaved: "Unsaved filter",
    stateSaveAsView: "Save as view",
    stateSaveChange: "Save change",
    stateSaveAsNew: "Save as new",
    stateRestore: "Restore",
    stateDrifted: "The filter differs from the saved view",
    stateSave: "Save",
    stateCancel: "Cancel",
    stateClear: "Clear",
    viewsCaption: "A view saves filtering, sorting and hidden columns — not data",
    viewsCreatedBy: (who) => `Created by ${who}`,
    viewsWillSave: "Will save:",
    viewsSaveCurrent: "Save current filter",
};

/** Built-in label sets, so a host with no i18n layer still gets both languages. */
export const microGridLabels = { he: HE_LABELS, en: EN_LABELS } as const;

export const DEFAULT_MICROGRID_CONFIG: MicroGridConfig = {
    Link: DefaultLink,
    labels: HE_LABELS,
    densityEventName: "appearance:density-change",
};

const MicroGridConfigContext = createContext<MicroGridConfig>(DEFAULT_MICROGRID_CONFIG);

/**
 * What a host may pass. Note `labels` is itself partial: the provider merges
 * labels field-by-field, so overriding one string must not force the host to
 * restate the rest. `Partial<MicroGridConfig>` alone would require a complete
 * labels object and reject the documented partial-override usage.
 */
export type MicroGridConfigInput = Partial<Omit<MicroGridConfig, "labels">> & {
    labels?: Partial<MicroGridLabels>;
};

export function MicroGridConfigProvider({
    value,
    children,
}: {
    /** Partial — anything omitted falls back to the default. */
    value: MicroGridConfigInput;
    children: ReactNode;
}) {
    const merged = useMemo<MicroGridConfig>(
        () => ({
            Link: value.Link ?? DEFAULT_MICROGRID_CONFIG.Link,
            labels: { ...DEFAULT_MICROGRID_CONFIG.labels, ...value.labels },
            densityEventName: value.densityEventName ?? DEFAULT_MICROGRID_CONFIG.densityEventName,
        }),
        [value.Link, value.labels, value.densityEventName],
    );
    return <MicroGridConfigContext.Provider value={merged}>{children}</MicroGridConfigContext.Provider>;
}

export function useMicroGridConfig(): MicroGridConfig {
    return useContext(MicroGridConfigContext);
}
