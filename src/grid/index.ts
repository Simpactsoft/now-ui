export { MicroGrid } from "./MicroGrid";
export {
    legacyColumnsToMicroColumns,
    legacyColumnsToNarrowColumn,
    legacyColumnsToNarrowColumns,
    type LegacyColumnAdapterOptions,
} from "./columnAdapter";
export type {
    MicroGridResponsiveFieldConfig,
    MicroGridResponsiveGroup,
    MicroGridResponsiveTier,
    ResolvedResponsiveColumn,
    ResolvedResponsiveColumns,
    ResolvedResponsiveField,
} from "./responsiveGroups";
export { resolveResponsiveColumns } from "./responsiveGroups";
export { bucketRows, NULL_GROUP_KEY, NULL_GROUP_LABEL } from "./bucketRows";
export type {
    MicroColumn,
    MicroEditConfig,
    MicroEditOption,
    MicroGroup,
    MicroGridDensity,
    MicroGridProps,
    MicroRowAction,
    MicroRowTone,
    MicroSelectionMode,
    MicroSortDirection,
    MicroSortState,
} from "./types";

// Host wiring — see config.tsx.
export {
    MicroGridConfigProvider,
    useMicroGridConfig,
    microGridLabels,
    DEFAULT_MICROGRID_CONFIG,
    type MicroGridConfig,
    type MicroGridConfigInput,
    type MicroGridLabels,
    type MicroGridLinkComponent,
    type MicroGridLinkProps,
} from "./config";

// Legacy column-shape compat types. These used to live in the host app as
// `entity-view/grid-column-shapes`; they belong to the adapter, so they ship
// with the grid now.
export type {
    CellValueChangedEvent,
    ColDef,
    GridCellRendererParams,
    GridValueGetterParams,
    GridValueSetterParams,
} from "./column-shapes";

export { cn } from "./utils";
