// SPIKE 2 (multi-source timelines): helpers for source-qualified resource identity.
// Rule used throughout: an absent sourceId (a legacy string filter, or an unstamped Resource /
// ResourceType) means "the timeline's default source".
import type { ResourceLayerFilter, ResourceRef } from '../types/timeline';
import type { TimelineSourceId, TimelineSourceRegistry } from '../types/timelineSource';

/** Role-based id for "whichever simulation the plan currently has selected", not a dataset id. */
export const PLAN_SIMULATION_SOURCE_ID = 'plan-simulation';

export function getStandaloneSourceId(standaloneDatasetId: number): TimelineSourceId {
  return `standalone:${standaloneDatasetId}`;
}

/** The resource name a filter refers to, whatever its form. */
export function getResourceFilterName(filter: ResourceLayerFilter | undefined | null): string {
  if (!filter) {
    return '';
  }
  return typeof filter === 'string' ? filter : filter.name;
}

/** Normalizes a stored filter to an explicit reference; legacy strings bind to the default source. */
export function resolveResourceRef(
  filter: ResourceLayerFilter | undefined | null,
  defaultSourceId: TimelineSourceId | null | undefined,
): { name: string; sourceId: TimelineSourceId | null } | null {
  if (!filter) {
    return null;
  }
  if (typeof filter === 'string') {
    return { name: filter, sourceId: defaultSourceId ?? null };
  }
  if (!filter.name) {
    return null;
  }
  return { name: filter.name, sourceId: filter.sourceId };
}

/**
 * Canonical stored form: the default source keeps the legacy bare string so views stay readable by
 * older UIs; any other source is written as an explicit ResourceRef.
 */
export function toResourceLayerFilter(
  name: string,
  sourceId: TimelineSourceId | null | undefined,
  defaultSourceId: TimelineSourceId | null | undefined,
): ResourceLayerFilter {
  if (!name) {
    return '';
  }
  if (!sourceId || sourceId === defaultSourceId) {
    return name;
  }
  const ref: ResourceRef = { name, sourceId };
  return ref;
}

/** Map key for per-row resource bookkeeping. Never key by bare name. */
export function getResourceRequestKey(name: string, sourceId: TimelineSourceId | null | undefined): string {
  return `${sourceId ?? ''}::${name}`;
}

/** True if a loaded/cataloged resource record is the one a filter refers to. */
export function resourceMatchesFilter(
  resource: { name: string; sourceId?: string },
  filter: ResourceLayerFilter | undefined | null,
  defaultSourceId: TimelineSourceId | null | undefined,
): boolean {
  const ref = resolveResourceRef(filter, defaultSourceId);
  if (!ref) {
    return false;
  }
  return resource.name === ref.name && (resource.sourceId ?? defaultSourceId ?? null) === ref.sourceId;
}

export function getSourceLabel(
  registry: TimelineSourceRegistry | null | undefined,
  sourceId: TimelineSourceId | null | undefined,
): string {
  if (!sourceId) {
    return '';
  }
  return registry?.sources.find(source => source.id === sourceId)?.label ?? sourceId;
}
