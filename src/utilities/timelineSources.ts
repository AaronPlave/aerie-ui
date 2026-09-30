// SPIKE 2 (multi-source timelines): helpers for source-qualified resource identity.
// Rule used throughout: an absent sourceId (a legacy string filter, or an unstamped Resource /
// ResourceType) means "the timeline's default source".
import type { ActivityType } from '../types/activity';
import type { Span } from '../types/simulation';
import type { ActivityLayer, ResourceLayerFilter, ResourceRef } from '../types/timeline';
import type {
  SpanKey,
  SpanRef,
  TimelineIntervalData,
  TimelineSource,
  TimelineSourceId,
  TimelineSourceRegistry,
} from '../types/timelineSource';
import { createSpanUtilityMaps } from './activities';

/**
 * Role-based id for the plan's own slot: its directives plus whichever simulation it currently has
 * selected. Not a dataset id. (SPIKE 3: renamed from 'plan-simulation'; being the default source it is
 * never written into views, so the rename is invisible to saved views.)
 */
export const PLAN_SIMULATION_SOURCE_ID = 'plan';

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

// ---------------------------------------------------------------------------------------------
// SPIKE 3: source-qualified intervals (spans).
// Invariant: spans from the default source are unstamped; spans from any other source carry
// `sourceId`. So `span.sourceId ?? null` is the span's source, with null meaning "default".
// ---------------------------------------------------------------------------------------------

export function getSpanRef(span: Pick<Span, 'span_id' | 'sourceId'>): SpanRef {
  return { sourceId: span.sourceId ?? null, spanId: span.span_id };
}

export function getSpanKey(ref: SpanRef): SpanKey {
  return `${ref.sourceId ?? ''}::${ref.spanId}` as SpanKey;
}

export function getSpanKeyForSpan(span: Pick<Span, 'span_id' | 'sourceId'>): SpanKey {
  return getSpanKey(getSpanRef(span));
}

export function spanRefsEqual(a: SpanRef | null | undefined, b: SpanRef | null | undefined): boolean {
  return !!a && !!b && a.spanId === b.spanId && (a.sourceId ?? null) === (b.sourceId ?? null);
}

/** The source a stamped/unstamped span belongs to, as a registry id. */
export function getSpanSourceId(span: Pick<Span, 'sourceId'>, defaultSourceId: TimelineSourceId | null) {
  return span.sourceId ?? defaultSourceId;
}

/**
 * The one place legacy activity layers are defaulted: no `sourceId` means the default source.
 * Returns null only when the timeline has no registry at all (then everything is default).
 */
export function resolveActivityLayerSourceId(
  layer: Pick<ActivityLayer, 'sourceId'>,
  defaultSourceId: TimelineSourceId | null,
): TimelineSourceId | null {
  return layer.sourceId ?? defaultSourceId;
}

/** Canonical stored form: the default source is omitted so views stay readable by older UIs. */
export function toActivityLayerSourceId(
  sourceId: TimelineSourceId | null | undefined,
  defaultSourceId: TimelineSourceId | null | undefined,
): TimelineSourceId | undefined {
  return !sourceId || sourceId === defaultSourceId ? undefined : sourceId;
}

export function isDefaultSource(sourceId: TimelineSourceId | null, defaultSourceId: TimelineSourceId | null) {
  return sourceId === null || sourceId === defaultSourceId;
}

export function getSource(
  registry: TimelineSourceRegistry | null | undefined,
  sourceId: TimelineSourceId | null | undefined,
): TimelineSource | undefined {
  const id = sourceId ?? registry?.defaultSourceId;
  return registry?.sources.find(source => source.id === id);
}

/**
 * Builds one source's interval data. Stamps spans with `sourceId` unless it is null (the default
 * source), and builds span maps that are local to this source.
 */
export function createTimelineIntervalData(
  key: string,
  spans: Span[],
  intervalTypes: ActivityType[],
  sourceId: TimelineSourceId | null,
): TimelineIntervalData {
  const stamped = sourceId ? spans.map(span => ({ ...span, sourceId })) : spans;
  const spansMap: TimelineIntervalData['spansMap'] = {};
  stamped.forEach(span => {
    spansMap[span.span_id] = span;
  });
  return { intervalTypes, key, spanUtilityMaps: createSpanUtilityMaps(stamped), spans: stamped, spansMap };
}

/** Parent of a span, looked up in the span's own source (never across sources). */
export function getSpanParent(
  span: Span,
  registry: TimelineSourceRegistry | null | undefined,
  defaultSpansMap?: Record<number, Span> | null,
): Span | null {
  if (span.parent_id === null) {
    return null;
  }
  const spansMap = span.sourceId ? getSource(registry, span.sourceId)?.intervals?.spansMap : defaultSpansMap;
  return spansMap?.[span.parent_id] ?? null;
}

export type SourceBinding = { artifactId: number; catalog: 'inferred' | 'names'; kind: 'standalone'; slot: string };

/**
 * SPIKE 3: fake runtime bindings from the URL.
 *   ?source.tour=standalone:10              slot "tour" -> standalone_dataset 10
 *   ?source.tour.catalog=inferred           infer parameters from span attributes.arguments
 *   ?standaloneDataset=9                    Spike 2 form: slot "standalone:9" -> standalone_dataset 9
 */
export function parseSourceBindings(params: URLSearchParams): SourceBinding[] {
  const bindings: SourceBinding[] = [];
  params.forEach((value, name) => {
    const match = /^source\.([A-Za-z0-9_-]+)$/.exec(name);
    const target = /^standalone:(\d+)$/.exec(value);
    if (match && target) {
      const slot = match[1];
      const catalog = params.get(`source.${slot}.catalog`) === 'inferred' ? 'inferred' : 'names';
      bindings.push({ artifactId: parseInt(target[1], 10), catalog, kind: 'standalone', slot });
    }
  });
  (params.get('standaloneDataset') ?? '')
    .split(',')
    .map(id => parseInt(id, 10))
    .filter(id => !Number.isNaN(id))
    .forEach(id =>
      bindings.push({ artifactId: id, catalog: 'names', kind: 'standalone', slot: getStandaloneSourceId(id) }),
    );
  return bindings;
}
