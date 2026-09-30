import { readable } from 'svelte/store';
import type { TimelineResourceState } from '../stores/timelineResourceStatus';
import type { ActivityType } from '../types/activity';
import type { ExternalEvent, ExternalEventType } from '../types/external-event';
import type { DerivationGroup, PlanDerivationGroup } from '../types/external-source';
import type { PlanDataset, ResourceType, SimulationDataset, Span } from '../types/simulation';
import type { Layer } from '../types/timeline';
import type {
  SourceBrowserNode,
  TimelineResourceSubscription,
  TimelineResourceSubscriptionContext,
  TimelineSource,
  TimelineSourceId,
  TimelineSourceRegistry,
} from '../types/timelineSource';

/* Source ids. These are what view layers persist, so they must stay stable across data revisions. */

export const PLAN_SOURCE_ID: TimelineSourceId = 'plan';
export const EXTERNAL_EVENTS_SOURCE_ID: TimelineSourceId = 'external-events';
const EXTERNAL_DATASET_SOURCE_PREFIX = 'external-dataset:';

/** A plan_dataset is identified by (plan, dataset); within one plan's registry the dataset id is enough. */
export function getExternalDatasetSourceId(datasetId: number): TimelineSourceId {
  return `${EXTERNAL_DATASET_SOURCE_PREFIX}${datasetId}`;
}

/**
 * The declaration of a resource as a layer bound to `sourceId` would read it. An unbound (legacy) layer reads the
 * first source that provides the name, in registry order: the Plan's simulation, then attached datasets.
 */
export function findResourceType(
  registry: TimelineSourceRegistry | null | undefined,
  sourceId: TimelineSourceId | null | undefined,
  name: string | undefined,
): ResourceType | null {
  if (!registry || !name) {
    return null;
  }
  const sources = sourceId ? [getSource(registry, sourceId)] : registry.sources;
  for (const source of sources) {
    const resourceType = source?.resources?.catalog.find(type => type.name === name);
    if (resourceType) {
      return resourceType;
    }
  }
  return null;
}

export function getSource(
  registry: TimelineSourceRegistry | null | undefined,
  sourceId: TimelineSourceId | null | undefined,
): TimelineSource | null {
  if (!registry || !sourceId) {
    return null;
  }
  return registry.sources.find(source => source.id === sourceId) ?? null;
}

/* Layer binding. */

/**
 * Activity layers without a source predate sources and always meant the Plan (its directives and simulated
 * spans), so they resolve to the Plan source.
 */
export function resolveActivityLayerSourceId(layer: Pick<Layer, 'sourceId'>): TimelineSourceId {
  return layer.sourceId ?? PLAN_SOURCE_ID;
}

/**
 * Identity of one resource request in a row. A resource layer without a source keeps the legacy meaning:
 * the name looked up in the model's simulation profiles, then in the attached external datasets. That
 * merged namespace gets its own key so it never aliases a source-bound layer with the same name.
 */
export function getResourceRequestKey(sourceId: TimelineSourceId | null | undefined, name: string): string {
  return `${sourceId ?? ''}::${name}`;
}

export function getLayerResourceRequestKey(layer: Pick<Layer, 'filter' | 'sourceId'>): string | null {
  return layer.filter.resource ? getResourceRequestKey(layer.sourceId, layer.filter.resource) : null;
}

export type ResourceLayerSourceResolution =
  | { kind: 'legacy' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'source'; source: TimelineSource };

/**
 * Resolves the source of a resource layer. A layer bound to a source that is not (or no longer) available
 * resolves to `unavailable`; it never falls back to another source with the same resource name.
 */
export function resolveResourceLayerSource(
  layer: Pick<Layer, 'sourceId'>,
  registry: TimelineSourceRegistry | null,
): ResourceLayerSourceResolution {
  if (!layer.sourceId) {
    return { kind: 'legacy' };
  }
  const source = getSource(registry, layer.sourceId);
  if (source?.resources) {
    return { kind: 'source', source };
  }
  if (!source && (!registry || registry.loading)) {
    return { kind: 'loading' };
  }
  return {
    kind: 'unavailable',
    message: source
      ? `Source "${source.label}" has no resources`
      : `Source "${layer.sourceId}" is not available in this plan`,
  };
}

export function getSourceLabel(registry: TimelineSourceRegistry | null, sourceId: TimelineSourceId | null | undefined) {
  if (!sourceId) {
    return null;
  }
  return getSource(registry, sourceId)?.label ?? sourceId;
}

/** A subscription whose state never changes, for sources that cannot serve a request. */
export function createStaticResourceSubscription(state: TimelineResourceState): TimelineResourceSubscription {
  return { store: readable(state), unsubscribe: () => {} };
}

/* Source adapters. Each turns one existing domain object into a TimelineSource. */

type ResourceSubscriber = (name: string, context: TimelineResourceSubscriptionContext) => TimelineResourceSubscription;

export type PlanSimulationSourceInput = {
  activityTypes: ActivityType[];
  activityTypesLoading: boolean;
  /** Resources the mission model declares: the Plan can provide them once simulated. */
  modelResourceTypes: ResourceType[];
  /** Profiles present in the selected simulation dataset. */
  profileCatalog: ResourceType[];
  profileCatalogLoading: boolean;
  simulationDataset: SimulationDataset | null;
  spans: Span[] | null;
  subscribeProfile: (
    datasetId: number,
    name: string,
    startYmd: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
};

export function createPlanSimulationSource(input: PlanSimulationSourceInput): TimelineSource {
  const { activityTypes, profileCatalog, simulationDataset, spans } = input;
  const counts = new Map<string, number>();
  (spans ?? []).forEach(span => counts.set(span.type, (counts.get(span.type) ?? 0) + 1));
  const present = [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const catalog = [...profileCatalog].sort((a, b) => a.name.localeCompare(b.name));
  // What layers can bind to: the simulated profiles plus the model's declared resources (so a Plan layer can be
  // set up before simulating); a simulated profile's declaration wins over the model's.
  const simulatedNames = new Set(catalog.map(type => type.name));
  const bindableCatalog = [...catalog, ...input.modelResourceTypes.filter(type => !simulatedNames.has(type.name))].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  const unavailableReason = simulationDataset ? undefined : 'The plan has no simulation results';

  // Serve the simulation dataset this source was built from, so the data always matches `revisionKey`.
  const subscribe: ResourceSubscriber = (name, context) => {
    if (!simulationDataset) {
      return createStaticResourceSubscription({ error: unavailableReason ?? '', loading: false, resource: null });
    }
    // Simulation profiles are fetched by merlin.dataset id, with offsets from the simulation start.
    return input.subscribeProfile(
      simulationDataset.dataset_id,
      name,
      simulationDataset.simulation_start_time ?? context.plan.start_time,
      context,
    );
  };

  const activityTypesByName = new Map(activityTypes.map(type => [type.name, type]));
  return {
    browserNodes: [
      {
        children: catalog.map(resourceType => ({
          action: { item: resourceType, sourceId: PLAN_SOURCE_ID, typeName: 'resource' },
          id: `${PLAN_SOURCE_ID}/resource/${resourceType.name}`,
          kind: 'item',
          label: resourceType.name,
          tags: [resourceType.schema.type],
        })),
        emptyMessage: unavailableReason ?? (input.profileCatalogLoading ? 'Loading…' : 'No simulated resources'),
        id: `${PLAN_SOURCE_ID}/resources`,
        kind: 'group',
        label: `Resources (${catalog.length})`,
      },
      {
        children: present.map(({ count, name }) => ({
          action: {
            item: activityTypesByName.get(name) ?? toIntervalType(name),
            sourceId: PLAN_SOURCE_ID,
            typeName: 'activity',
          },
          badge: `${count}`,
          id: `${PLAN_SOURCE_ID}/activity/${name}`,
          kind: 'item',
          label: name,
          tooltip: activityTypesByName.has(name) ? undefined : 'Not a type in the current mission model',
        })),
        emptyMessage: unavailableReason ?? 'No simulated activities',
        id: `${PLAN_SOURCE_ID}/activities`,
        kind: 'group',
        label: `Simulated Activities (${present.length})`,
      },
    ],
    description: simulationDataset ? `Simulation dataset ${simulationDataset.id}` : 'Not simulated',
    group: 'Plan',
    id: PLAN_SOURCE_ID,
    intervals: {
      catalog: activityTypes,
      hasDirectives: true,
      loading: input.activityTypesLoading,
      present,
    },
    kind: 'plan',
    label: 'Simulation',
    resources: {
      catalog: bindableCatalog,
      loading: input.profileCatalogLoading,
      revisionKey: simulationDataset ? `simulation-dataset:${simulationDataset.id}` : null,
      subscribe,
      unavailableReason,
    },
  };
}

function toIntervalType(name: string): ActivityType {
  return {
    computed_attributes_value_schema: { items: {}, type: 'struct' },
    name,
    parameters: {},
    required_parameters: [],
  };
}

export type ExternalDatasetSourcesInput = {
  planDatasets: PlanDataset[];
  simulationDatasetId: number;
  subscribeExternal: (
    datasetId: number,
    name: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
};

/**
 * One source per plan_dataset row. plan_dataset has no name of its own, so the label comes from the dataset id
 * and its association (tied to a simulation or plan-level). Datasets tied to a different simulation than the
 * selected one are still real, addressable data, so they are listed too; the legacy merged namespace hides them.
 */
export function createExternalDatasetSources(input: ExternalDatasetSourcesInput): TimelineSource[] {
  const { planDatasets, simulationDatasetId } = input;
  return [...planDatasets]
    .sort((a, b) => a.dataset_id - b.dataset_id)
    .map(planDataset => {
      const sourceId = getExternalDatasetSourceId(planDataset.dataset_id);
      const catalog: ResourceType[] = planDataset.dataset.profiles
        .map(profile => ({ name: profile.name, schema: profile.type.schema }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const simId = planDataset.simulation_dataset_id;
      const association =
        simId === null
          ? 'Plan-level'
          : simId === simulationDatasetId
            ? `Tied to the selected simulation (${simId})`
            : `Tied to simulation ${simId}`;
      return {
        browserNodes: catalog.map(resourceType => ({
          action: { item: resourceType, sourceId, typeName: 'resource' as const },
          id: `${sourceId}/resource/${resourceType.name}`,
          kind: 'item' as const,
          label: resourceType.name,
          tags: [resourceType.schema.type],
        })),
        description: `${association} · offset ${planDataset.offset_from_plan_start}`,
        group: 'External Datasets',
        id: sourceId,
        kind: 'externalDataset' as const,
        label: `Dataset ${planDataset.dataset_id}`,
        resources: {
          catalog,
          loading: false,
          revisionKey: `dataset:${planDataset.dataset_id}`,
          subscribe: (name: string, context: TimelineResourceSubscriptionContext) =>
            input.subscribeExternal(planDataset.dataset_id, name, context),
        },
      };
    });
}

export type ExternalEventsSourceInput = {
  acknowledged: Record<string, { last_acknowledged_at: string }>;
  derivationGroups: DerivationGroup[];
  eventTypes: ExternalEventType[];
  events: ExternalEvent[];
  loading: boolean;
  planDerivationGroupLinks: PlanDerivationGroup[];
  visibility: Record<string, boolean>;
};

/**
 * The plan's external events, organized the way the External Events domain is: derivation groups linked to the
 * plan, their external sources, and the event types those sources contribute within the plan bounds. Adding an
 * event type creates an ordinary external-event layer restricted to that type and that external source
 * (`ExternalEventLayerFilter.external_sources`); events keep their own identity (derivation group, source key,
 * type, key), so nothing here is flattened into profiles or intervals.
 */
export function createExternalEventsSource(input: ExternalEventsSourceInput): TimelineSource {
  const eventTypesByName = new Map(input.eventTypes.map(type => [type.name, type]));
  const derivationGroupsByName = new Map(input.derivationGroups.map(group => [group.name, group]));
  // derivation group -> source key -> event type -> count
  const counts = new Map<string, Map<string, Map<string, number>>>();
  input.events.forEach(({ pkey }) => {
    const bySource = counts.get(pkey.derivation_group_name) ?? new Map<string, Map<string, number>>();
    const byType = bySource.get(pkey.source_key) ?? new Map<string, number>();
    byType.set(pkey.event_type_name, (byType.get(pkey.event_type_name) ?? 0) + 1);
    bySource.set(pkey.source_key, byType);
    counts.set(pkey.derivation_group_name, bySource);
  });

  const presentTypes = new Set(input.events.map(event => event.pkey.event_type_name));
  const linkedGroupNames = [...new Set(input.planDerivationGroupLinks.map(link => link.derivation_group_name))].sort();
  const browserNodes: SourceBrowserNode[] = linkedGroupNames.map(groupName => {
    const group = derivationGroupsByName.get(groupName);
    const bySource = counts.get(groupName) ?? new Map<string, Map<string, number>>();
    const sourceKeys = [...new Set([...(group?.sources ?? []), ...bySource.keys()])].sort();
    const hidden = input.visibility[groupName] === false;
    const tags = [
      group?.source_type_name ?? '',
      hidden ? 'hidden' : '',
      input.acknowledged[groupName] ? 'updated' : '',
    ].filter(Boolean);
    return {
      children: sourceKeys.map(sourceKey => {
        const byType = bySource.get(sourceKey) ?? new Map<string, number>();
        return {
          children: [...byType.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([typeName, count]) => ({
              // The layer keeps the scope this node shows: this type, from this source key in this group.
              action: {
                externalSources: [{ derivation_group_name: groupName, source_key: sourceKey }],
                item: eventTypesByName.get(typeName) ?? { attribute_schema: {}, name: typeName },
                sourceId: null,
                typeName: 'externalEvent' as const,
              },
              badge: `${count}`,
              id: `${EXTERNAL_EVENTS_SOURCE_ID}/${groupName}/${sourceKey}/${typeName}`,
              kind: 'item' as const,
              label: typeName,
              tooltip: `${typeName} events from ${sourceKey} (${groupName})`,
            })),
          emptyMessage: input.loading ? 'Loading…' : 'No events within the plan bounds',
          id: `${EXTERNAL_EVENTS_SOURCE_ID}/${groupName}/${sourceKey}`,
          kind: 'group' as const,
          label: sourceKey,
          tooltip: 'External source',
        };
      }),
      emptyMessage: 'No external sources',
      id: `${EXTERNAL_EVENTS_SOURCE_ID}/${groupName}`,
      kind: 'group',
      label: groupName,
      tags,
      tooltip: hidden
        ? 'Derivation group (hidden on the timeline for this plan)'
        : `Derivation group${group ? ` of source type ${group.source_type_name}` : ''}`,
    };
  });

  return {
    browserNodes,
    description: `${linkedGroupNames.length} linked derivation group${linkedGroupNames.length === 1 ? '' : 's'}`,
    events: {
      catalog: [...presentTypes].sort().map(name => eventTypesByName.get(name) ?? { attribute_schema: {}, name }),
      loading: input.loading,
    },
    group: 'External Events',
    id: EXTERNAL_EVENTS_SOURCE_ID,
    kind: 'externalEvents',
    label: 'External Events',
  };
}

/* Browser helpers. */

/** Keeps items whose label matches, with their ancestors; a matching group keeps its whole subtree. */
export function filterSourceBrowserNodes(nodes: SourceBrowserNode[], text: string): SourceBrowserNode[] {
  const needle = text.trim().toLowerCase();
  if (!needle) {
    return nodes;
  }
  const result: SourceBrowserNode[] = [];
  nodes.forEach(node => {
    if (node.label.toLowerCase().includes(needle)) {
      result.push(node);
      return;
    }
    const children = filterSourceBrowserNodes(node.children ?? [], needle);
    if (children.length) {
      result.push({ ...node, children });
    }
  });
  return result;
}
