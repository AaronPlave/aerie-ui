import type {
  AnalysisActivityRef,
  AnalysisActivityRow,
  AnalysisDefinition,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
  AnalysisSourceTarget,
} from '../types/analysis';
import type { SourceResource } from '../types/importedSource';
import type { ResourceType, Span } from '../types/simulation';
import type { TimeRange, Timeline } from '../types/timeline';
import type {
  SourceBrowserNode,
  TimelineActivityRequest,
  TimelineActivitySubscription,
  TimelineResourceSubscription,
  TimelineResourceSubscriptionContext,
  TimelineSource,
  TimelineSourceId,
} from '../types/timelineSource';
import { createTimeline } from './timeline';
import { createStaticResourceSubscription, toIntervalType } from './timelineSources';
import { generateDefaultView } from './view';

/* Activity identity. */

/** An activity's identity across the analysis: its source and its id within that source. */
export function getAnalysisActivityKey(ref: AnalysisActivityRef): string {
  return `${ref.sourceId}::${ref.activityId}`;
}

export function analysisActivityRefsEqual(a: AnalysisActivityRef | null, b: AnalysisActivityRef | null): boolean {
  return !!a && !!b && a.sourceId === b.sourceId && a.activityId === b.activityId;
}

/*
 * The timeline draws, selects and hit-tests activities by a numeric `span_id` that must be unique on the page, while
 * an analysis activity is only unique as (source, id). Rather than re-key the renderer, each analysis activity is
 * drawn under an id that encodes both: (source index + 1) * 2^32 + activity id. Plan span ids are below 2^31, so
 * the two can never collide, and the encoding is reversible without keeping a map of every activity seen.
 */
const DRAWING_ID_STRIDE = 2 ** 32;
const drawingSourceIndexes = new Map<TimelineSourceId, number>();
const drawingSourceIds: TimelineSourceId[] = [];

export function getActivityDrawingId(ref: AnalysisActivityRef): number {
  let index = drawingSourceIndexes.get(ref.sourceId);
  if (index === undefined) {
    index = drawingSourceIds.length;
    drawingSourceIds.push(ref.sourceId);
    drawingSourceIndexes.set(ref.sourceId, index);
  }
  return (index + 1) * DRAWING_ID_STRIDE + ref.activityId;
}

export function getActivityRefFromDrawingId(drawingId: number): AnalysisActivityRef | null {
  const index = Math.floor(drawingId / DRAWING_ID_STRIDE) - 1;
  const sourceId = drawingSourceIds[index];
  return index >= 0 && sourceId !== undefined ? { activityId: drawingId % DRAWING_ID_STRIDE, sourceId } : null;
}

/** The activity a timeline span is, when it comes from an analysis source. */
export function getActivityRefFromSpan(span: Span): AnalysisActivityRef | null {
  return span.sourceId !== undefined && span.sourceActivityId !== undefined
    ? { activityId: span.sourceActivityId, sourceId: span.sourceId }
    : null;
}

/* Adapters: native activities as the timeline's Span view model, keeping their source identity. */

export type ImportedActivityRecord = {
  category: string | null;
  end_time: string;
  id: number;
  name: string;
  parameters: Record<string, unknown>;
  start_time: string;
  type: string;
};

export function importedActivityToSpan(sourceId: TimelineSourceId, activity: ImportedActivityRecord): Span {
  const startMs = Date.parse(activity.start_time);
  const endMs = Date.parse(activity.end_time);
  return {
    // Parameters are where activity filters look for argument values (Parameter filters).
    attributes: { arguments: activity.parameters as Span['attributes']['arguments'], computedAttributes: {} },
    dataset_id: -1,
    duration: '',
    durationMs: endMs - startMs,
    endMs,
    name: activity.name,
    parent_id: null,
    sourceActivityId: activity.id,
    sourceId,
    span_id: getActivityDrawingId({ activityId: activity.id, sourceId }),
    start_offset: '',
    startMs,
    type: activity.type,
  };
}

/**
 * A simulation span as an activity of the analysis source that reads it. Its hierarchy is kept (parents are
 * re-identified in the same source); its directive link is dropped, since an analysis has no directives to draw
 * it with and the id would be read as one of the page's directives.
 */
export function simulationSpanToActivity(sourceId: TimelineSourceId, span: Span): Span {
  const { directiveId: _directiveId, ...attributes } = span.attributes;
  return {
    ...span,
    attributes,
    parent_id: span.parent_id === null ? null : getActivityDrawingId({ activityId: span.parent_id, sourceId }),
    sourceActivityId: span.span_id,
    sourceId,
    span_id: getActivityDrawingId({ activityId: span.span_id, sourceId }),
  };
}

/* The analysis definition. */

export function createAnalysisDefinition(): AnalysisDefinition {
  const { definition } = generateDefaultView();
  return {
    sources: [],
    version: 1,
    view: {
      ...definition,
      plan: { ...definition.plan, timelines: [createTimeline([], { marginLeft: 250, marginRight: 30 })] },
    },
  };
}

/** A source id not yet used in the analysis. Layers store it, so it is never reused for another source. */
export function getNextAnalysisSourceId(bindings: AnalysisSourceBinding[]): TimelineSourceId {
  const used = bindings.map(binding => Number(/^source-(\d+)$/.exec(binding.id)?.[1] ?? 0));
  return `source-${Math.max(0, ...used) + 1}`;
}

export function isSameAnalysisSource(a: AnalysisSourceTarget, b: AnalysisSourceTarget): boolean {
  return a.kind === 'imported' && b.kind === 'imported'
    ? a.revisionId === b.revisionId
    : a.kind === 'simulation' && b.kind === 'simulation' && a.simulationDatasetId === b.simulationDatasetId;
}

/** The binding a row of merlin.analysis_activity comes from. */
export function getAnalysisActivityRowRef(
  bindings: AnalysisSourceBinding[],
  row: Pick<AnalysisActivityRow, 'activity_id' | 'source_kind' | 'source_ref'>,
): AnalysisActivityRef | null {
  const binding = bindings.find(binding =>
    row.source_kind === 'revision'
      ? binding.kind === 'imported' && binding.revisionId === row.source_ref
      : binding.kind === 'simulation' && binding.simulationDatasetId === row.source_ref,
  );
  return binding ? { activityId: row.activity_id, sourceId: binding.id } : null;
}

/* The activity table's server-side query. */

export type AnalysisActivityFilter = {
  /** Only these sources; null for every source of the analysis. */
  sourceIds: TimelineSourceId[] | null;
  text: string;
  /** Only these types; null for every type. */
  types: string[] | null;
};

/** The merlin.analysis_activity filter for the analysis's sources and the table's filters. */
export function getAnalysisActivityWhere(
  bindings: AnalysisSourceBinding[],
  filter: AnalysisActivityFilter,
): Record<string, unknown> {
  const sources = bindings
    .filter(binding => !filter.sourceIds || filter.sourceIds.includes(binding.id))
    .map(binding =>
      binding.kind === 'imported'
        ? { source_kind: { _eq: 'revision' }, source_ref: { _eq: binding.revisionId } }
        : { source_kind: { _eq: 'simulation' }, source_ref: { _eq: binding.simulationDatasetId } },
    );
  const conditions: Record<string, unknown>[] = [
    // No sources selected matches nothing, not everything.
    sources.length ? { _or: sources } : { activity_id: { _is_null: true } },
  ];
  if (filter.types) {
    conditions.push({ type: { _in: filter.types } });
  }
  const text = filter.text.trim();
  if (text) {
    const pattern = `%${text.replace(/[\\%_]/g, character => `\\${character}`)}%`;
    conditions.push({ _or: [{ name: { _ilike: pattern } }, { type: { _ilike: pattern } }] });
  }
  return { _and: conditions };
}

/** Start time order, with a stable tiebreak so paging never repeats or skips a row. */
export function getAnalysisActivityOrderBy(direction: 'asc' | 'desc'): Record<string, 'asc' | 'desc'>[] {
  return [{ start_time: direction }, { source_kind: direction }, { source_ref: direction }, { activity_id: direction }];
}

/**
 * What rows key a source's subscriptions by while it has no data to serve: null while it loads, the reason once it
 * is known to be unavailable, so rows replace the "loading" subscription they took first.
 */
function getUnavailableKey(unavailableReason: string | undefined): string | null {
  return unavailableReason ? `unavailable:${unavailableReason}` : null;
}

/**
 * Rows ordered before `row` under getAnalysisActivityOrderBy(direction): counting them gives `row`'s index, so the
 * table can scroll to an activity selected elsewhere.
 */
export function getAnalysisActivitiesBeforeWhere(
  row: Pick<AnalysisActivityRow, 'activity_id' | 'source_kind' | 'source_ref' | 'start_time'>,
  direction: 'asc' | 'desc',
): Record<string, unknown> {
  const before = direction === 'asc' ? '_lt' : '_gt';
  return {
    _or: [
      { start_time: { [before]: row.start_time } },
      { source_kind: { [before]: row.source_kind }, start_time: { _eq: row.start_time } },
      {
        source_kind: { _eq: row.source_kind },
        source_ref: { [before]: row.source_ref },
        start_time: { _eq: row.start_time },
      },
      {
        activity_id: { [before]: row.activity_id },
        source_kind: { _eq: row.source_kind },
        source_ref: { _eq: row.source_ref },
        start_time: { _eq: row.start_time },
      },
    ],
  };
}

/* Sources. Each binding becomes an ordinary TimelineSource, so the timeline, browser and editor need no Analysis. */

export type AnalysisSourcesInput = {
  bindings: AnalysisSourceBinding[];
  /** True while the revisions and datasets the bindings name are loading. */
  loading: boolean;
  revisions: AnalysisSourceRevision[];
  simulationDatasets: AnalysisSimulationDataset[];
  /** Span types present in each simulation dataset, by simulation dataset id; absent while they load. */
  simulationTypeCounts: Record<number, { count: number; name: string }[]>;
  subscribeImportedActivities: (
    binding: AnalysisSourceBinding,
    revision: AnalysisSourceRevision,
    request: TimelineActivityRequest,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineActivitySubscription;
  subscribeImportedResource: (
    binding: AnalysisSourceBinding,
    revision: AnalysisSourceRevision,
    resource: SourceResource,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
  subscribeSimulationActivities: (
    binding: AnalysisSourceBinding,
    dataset: AnalysisSimulationDataset,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineActivitySubscription;
  subscribeSimulationProfile: (
    binding: AnalysisSourceBinding,
    dataset: AnalysisSimulationDataset,
    name: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
};

export function getAnalysisSourceLabel(
  binding: AnalysisSourceBinding,
  revision?: AnalysisSourceRevision,
  dataset?: AnalysisSimulationDataset,
): string {
  if (binding.label) {
    return binding.label;
  }
  if (binding.kind === 'imported') {
    return revision ? `${revision.source.name} r${revision.id}` : `Revision ${binding.revisionId}`;
  }
  const plan = dataset?.simulation?.plan;
  return plan ? `${plan.name} · Sim ${binding.simulationDatasetId}` : `Simulation ${binding.simulationDatasetId}`;
}

function groupBrowserNodes<T>(
  sourceId: TimelineSourceId,
  kind: string,
  items: T[],
  getCategory: (item: T) => string | null,
  toNode: (item: T) => SourceBrowserNode,
): SourceBrowserNode[] {
  const byCategory = new Map<string, T[]>();
  items.forEach(item => {
    const category = getCategory(item) ?? 'Uncategorized';
    byCategory.set(category, [...(byCategory.get(category) ?? []), item]);
  });
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, members]) => ({
      badge: `${members.length}`,
      children: members.map(toNode),
      id: `${sourceId}/${kind}/category/${category}`,
      kind: 'group',
      label: category,
    }));
}

function activityItemNode(sourceId: TimelineSourceId, name: string, count: number): SourceBrowserNode {
  return {
    action: { item: toIntervalType(name), sourceId, typeName: 'activity' },
    badge: `${count}`,
    id: `${sourceId}/activity/${name}`,
    kind: 'item',
    label: name,
  };
}

export function createAnalysisSources(input: AnalysisSourcesInput): TimelineSource[] {
  return input.bindings.map(binding =>
    binding.kind === 'imported'
      ? createImportedRevisionSource(
          input,
          binding,
          input.revisions.find(revision => revision.id === binding.revisionId),
        )
      : createSimulationDatasetSource(
          input,
          binding,
          input.simulationDatasets.find(dataset => dataset.id === binding.simulationDatasetId),
        ),
  );
}

function createImportedRevisionSource(
  input: AnalysisSourcesInput,
  binding: AnalysisSourceBinding,
  revision: AnalysisSourceRevision | undefined,
): TimelineSource {
  const sourceId = binding.id;
  const label = getAnalysisSourceLabel(binding, revision);
  const ready = revision?.status === 'success';
  const unavailableReason = !revision
    ? input.loading
      ? undefined
      : 'The revision no longer exists'
    : ready
      ? undefined
      : revision.status === 'failed'
        ? 'The import failed'
        : 'The source is still being imported';
  const resources = revision?.resources ?? [];
  const activityTypes = revision?.activity_types ?? [];
  const resourcesByKey = new Map(resources.map(resource => [resource.key, resource]));
  return {
    browserNodes: [
      {
        children: groupBrowserNodes(
          sourceId,
          'resource',
          resources,
          resource => resource.category,
          resource => ({
            action: { item: { name: resource.key, schema: resource.schema }, sourceId, typeName: 'resource' },
            id: `${sourceId}/resource/${resource.key}`,
            kind: 'item',
            label: resource.key,
            tags: [resource.schema.type],
            tooltip: [resource.units, resource.sample_count !== null ? `${resource.sample_count} samples` : null]
              .filter(Boolean)
              .join(' · '),
          }),
        ),
        emptyMessage: unavailableReason ?? (input.loading ? 'Loading…' : 'No resources'),
        id: `${sourceId}/resources`,
        kind: 'group',
        label: `Resources (${resources.length})`,
      },
      {
        children: groupBrowserNodes(
          sourceId,
          'activity',
          activityTypes,
          type => type.category,
          type => activityItemNode(sourceId, type.type, type.count),
        ),
        emptyMessage: unavailableReason ?? (input.loading ? 'Loading…' : 'No activities'),
        id: `${sourceId}/activities`,
        kind: 'group',
        label: `Activities (${activityTypes.reduce((total, type) => total + type.count, 0)})`,
      },
    ],
    description: revision
      ? `Imported · ${revision.source.name}, revision ${revision.id} · ${revision.coverage_start ?? '?'} – ${revision.coverage_end ?? '?'}`
      : `Imported revision ${binding.kind === 'imported' ? binding.revisionId : ''}`,
    group: 'Imported Sources',
    id: sourceId,
    intervals: {
      catalog: activityTypes.map(type => toIntervalType(type.type, type.parameters)),
      hasDirectives: false,
      loading: input.loading,
      present: activityTypes.map(type => ({ count: type.count, name: type.type })),
      revisionKey: ready ? `source-revision:${revision.id}` : getUnavailableKey(unavailableReason),
      subscribe: (request, context) =>
        revision && ready
          ? input.subscribeImportedActivities(binding, revision, request, context)
          : createStaticActivitySubscription(unavailableReason ?? '', input.loading),
    },
    kind: 'imported',
    label,
    resources: {
      catalog: resources.map(resource => ({ name: resource.key, schema: resource.schema })),
      loading: input.loading,
      revisionKey: ready ? `source-revision:${revision.id}` : getUnavailableKey(unavailableReason),
      subscribe: (name, context) => {
        const resource = resourcesByKey.get(name);
        if (!revision || !ready || !resource) {
          return createStaticResourceSubscription({
            error: unavailableReason ?? `Resource not found in ${label}`,
            loading: input.loading,
            resource: null,
          });
        }
        return input.subscribeImportedResource(binding, revision, resource, context);
      },
      unavailableReason,
    },
  };
}

function createSimulationDatasetSource(
  input: AnalysisSourcesInput,
  binding: AnalysisSourceBinding,
  dataset: AnalysisSimulationDataset | undefined,
): TimelineSource {
  const sourceId = binding.id;
  const label = getAnalysisSourceLabel(binding, undefined, dataset);
  const unavailableReason = !dataset
    ? input.loading
      ? undefined
      : 'The simulation dataset no longer exists'
    : dataset.status === 'success'
      ? undefined
      : `The simulation is ${dataset.status}`;
  const catalog: ResourceType[] = (dataset?.dataset?.profiles ?? []).map(({ name, type }) => ({
    name,
    schema: type.schema,
  }));
  const present = dataset ? input.simulationTypeCounts[dataset.id] : undefined;
  const plan = dataset?.simulation?.plan;
  const modelTypes = plan?.mission_model?.activity_types ?? [];
  return {
    browserNodes: [
      {
        children: catalog.map(resourceType => ({
          action: { item: resourceType, sourceId, typeName: 'resource' },
          id: `${sourceId}/resource/${resourceType.name}`,
          kind: 'item',
          label: resourceType.name,
          tags: [resourceType.schema.type],
        })),
        emptyMessage: unavailableReason ?? (input.loading ? 'Loading…' : 'No simulated resources'),
        id: `${sourceId}/resources`,
        kind: 'group',
        label: `Resources (${catalog.length})`,
      },
      {
        children: (present ?? []).map(({ count, name }) => activityItemNode(sourceId, name, count)),
        emptyMessage: unavailableReason ?? (present ? 'No simulated activities' : 'Loading…'),
        id: `${sourceId}/activities`,
        kind: 'group',
        label: `Simulated Activities (${(present ?? []).reduce((total, type) => total + type.count, 0)})`,
      },
    ],
    description: dataset
      ? `Simulation dataset ${dataset.id}${plan ? ` of plan "${plan.name}" (${plan.id})` : ''} · ${dataset.simulation_start_time ?? '?'} – ${dataset.simulation_end_time ?? '?'}`
      : `Simulation dataset ${binding.kind === 'simulation' ? binding.simulationDatasetId : ''}`,
    group: 'Simulations',
    id: sourceId,
    intervals: {
      // The model's declarations where the plan's model still has them; types it no longer declares by name.
      catalog: (present ?? []).map(
        type => modelTypes.find(({ name }) => name === type.name) ?? toIntervalType(type.name),
      ),
      hasDirectives: false,
      loading: input.loading || !present,
      present: present ?? [],
      revisionKey: dataset ? `simulation-dataset:${dataset.id}` : getUnavailableKey(unavailableReason),
      // Simulations are small: every span is loaded once, so hierarchies are complete; rows filter by type.
      subscribe: (_request, context) =>
        dataset && !unavailableReason
          ? input.subscribeSimulationActivities(binding, dataset, context)
          : createStaticActivitySubscription(unavailableReason ?? '', input.loading),
    },
    kind: 'simulation',
    label,
    resources: {
      catalog,
      loading: input.loading,
      revisionKey: dataset ? `simulation-dataset:${dataset.id}` : getUnavailableKey(unavailableReason),
      subscribe: (name, context) =>
        dataset && !unavailableReason
          ? input.subscribeSimulationProfile(binding, dataset, name, context)
          : createStaticResourceSubscription({
              error: unavailableReason ?? '',
              loading: input.loading,
              resource: null,
            }),
      unavailableReason,
    },
  };
}

export function createStaticActivitySubscription(
  error: string,
  loading: boolean = false,
): TimelineActivitySubscription {
  return {
    store: { subscribe: run => (run({ error, loading, spans: [] }), () => {}) },
    unsubscribe: () => {},
  };
}

/* Time. */

function parseRange(start: string | null | undefined, end: string | null | undefined): TimeRange | null {
  const range = { end: Date.parse(end ?? ''), start: Date.parse(start ?? '') };
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start ? range : null;
}

function union(ranges: (TimeRange | null)[]): TimeRange | null {
  const present = ranges.filter((range): range is TimeRange => range !== null);
  return present.length
    ? { end: Math.max(...present.map(r => r.end)), start: Math.min(...present.map(r => r.start)) }
    : null;
}

/**
 * The extent the timeline can show: every source's data. The default view is the simulations' extent when there
 * are simulations (a plan's span is the usual unit of comparison), else everything.
 */
export function getAnalysisTimeRanges(
  revisions: AnalysisSourceRevision[],
  datasets: AnalysisSimulationDataset[],
): { initial: TimeRange; max: TimeRange } | null {
  const simulations = union(datasets.map(d => parseRange(d.simulation_start_time, d.simulation_end_time)));
  const max = union([
    simulations,
    ...revisions.map(r => parseRange(r.coverage_start, r.coverage_end)),
    ...revisions.flatMap(r => r.activity_types.map(t => parseRange(t.first_start, t.last_end))),
  ]);
  return max ? { initial: simulations ?? max, max } : null;
}

/* Removing a source. */

/**
 * The timelines without any layer bound to `sourceId`. A row left with no layers is removed (it only showed that
 * source), as are axes only those layers used and the guides on them. Rows and layers of other sources are kept as
 * they are.
 */
export function removeSourceFromTimelines(timelines: Timeline[], sourceId: TimelineSourceId): Timeline[] {
  return timelines.map(timeline => ({
    ...timeline,
    rows: timeline.rows.flatMap(row => {
      const removed = row.layers.filter(layer => layer.sourceId === sourceId);
      if (!removed.length) {
        return [row];
      }
      const layers = row.layers.filter(layer => layer.sourceId !== sourceId);
      if (!layers.length) {
        return [];
      }
      const keptAxes = new Set(layers.map(layer => layer.yAxisId));
      const droppedAxes = new Set(removed.map(layer => layer.yAxisId).filter(id => !keptAxes.has(id)));
      return [
        {
          ...row,
          horizontalGuides: row.horizontalGuides.filter(guide => !droppedAxes.has(guide.yAxisId)),
          layers,
          yAxes: row.yAxes.filter(axis => !droppedAxes.has(axis.id)),
        },
      ];
    }),
  }));
}
