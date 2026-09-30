import { get } from 'svelte/store';
import { describe, expect, test, vi } from 'vitest';
import type { ExternalEvent } from '../types/external-event';
import type { PlanDataset, ResourceType, SimulationDataset, Span } from '../types/simulation';
import type { SourceBrowserNode, TimelineSourceRegistry } from '../types/timelineSource';
import {
  createExternalDatasetSources,
  createExternalEventsSource,
  createPlanSimulationSource,
  EXTERNAL_EVENTS_SOURCE_ID,
  filterSourceBrowserNodes,
  getExternalDatasetSourceId,
  getLayerResourceRequestKey,
  getResourceRequestKey,
  PLAN_SOURCE_ID,
  resolveActivityLayerSourceId,
  resolveResourceLayerSource,
} from './timelineSources';

const soc: ResourceType = { name: '/battery/soc', schema: { type: 'real' } };

function planDataset(datasetId: number, simulationDatasetId: number | null, names: string[]): PlanDataset {
  return {
    dataset: {
      profiles: names.map((name, i) => ({
        dataset_id: datasetId,
        duration: '24:00:00',
        id: datasetId * 100 + i,
        name,
        profile_segments: [],
        type: { schema: { type: 'real' }, type: 'real' },
      })),
    },
    dataset_id: datasetId,
    offset_from_plan_start: '00:00:00',
    simulation_dataset_id: simulationDatasetId,
  };
}

const staticSubscription = () => ({
  store: { subscribe: (run: (value: unknown) => void) => (run(null), () => {}) },
  unsubscribe: () => {},
});

function planSource(simulationDataset: SimulationDataset | null, spans: Span[] = []) {
  return createPlanSimulationSource({
    activityTypes: [],
    activityTypesLoading: false,
    profileCatalog: [soc],
    profileCatalogLoading: false,
    simulationDataset,
    spans,
    subscribeProfile: vi.fn(staticSubscription) as any,
  });
}

const externalSources = createExternalDatasetSources({
  planDatasets: [planDataset(12, null, ['/battery/soc']), planDataset(11, 7, ['/battery/soc', '/power'])],
  simulationDatasetId: 7,
  subscribeExternal: vi.fn(staticSubscription) as any,
});

const registry: TimelineSourceRegistry = {
  loading: false,
  sources: [planSource({ dataset_id: 40, id: 7 } as SimulationDataset), ...externalSources],
};

describe('source identity', () => {
  test('each plan_dataset is its own source, even when profile names collide', () => {
    expect(externalSources.map(source => source.id)).toEqual(['external-dataset:11', 'external-dataset:12']);
    expect(externalSources.map(source => source.resources?.catalog.map(type => type.name))).toEqual([
      ['/battery/soc', '/power'],
      ['/battery/soc'],
    ]);
    expect(externalSources[0].description).toContain('Tied to the selected simulation (7)');
    expect(externalSources[1].description).toContain('Plan-level');
  });

  test('resource request keys never alias across sources or with the legacy namespace', () => {
    const keys = [
      getResourceRequestKey(undefined, '/battery/soc'),
      getResourceRequestKey(PLAN_SOURCE_ID, '/battery/soc'),
      getResourceRequestKey(getExternalDatasetSourceId(11), '/battery/soc'),
      getResourceRequestKey(getExternalDatasetSourceId(12), '/battery/soc'),
    ];
    expect(new Set(keys).size).toBe(4);
    expect(getLayerResourceRequestKey({ filter: {} })).toBeNull();
  });

  test('the data revision is separate from the stable source id', () => {
    const simulated7 = planSource({ dataset_id: 40, id: 7 } as SimulationDataset);
    const simulated8 = planSource({ dataset_id: 41, id: 8 } as SimulationDataset);
    expect(simulated7.id).toBe(simulated8.id);
    expect(simulated7.resources?.revisionKey).not.toBe(simulated8.resources?.revisionKey);
  });
});

describe('layer source resolution', () => {
  test('legacy resource layers keep the merged lookup; activity layers default to the Plan', () => {
    expect(resolveResourceLayerSource({}, registry)).toEqual({ kind: 'legacy' });
    expect(resolveActivityLayerSourceId({})).toBe(PLAN_SOURCE_ID);
  });

  test('a bound layer resolves to its own source', () => {
    const resolution = resolveResourceLayerSource({ sourceId: 'external-dataset:12' }, registry);
    expect(resolution.kind === 'source' && resolution.source.id).toBe('external-dataset:12');
  });

  test('a missing source is unavailable, never rebound, and only while the registry is settled', () => {
    expect(resolveResourceLayerSource({ sourceId: 'external-dataset:99' }, registry)).toEqual({
      kind: 'unavailable',
      message: 'Source "external-dataset:99" is not available in this plan',
    });
    expect(resolveResourceLayerSource({ sourceId: 'external-dataset:99' }, { ...registry, loading: true })).toEqual({
      kind: 'loading',
    });
  });

  test('without simulation results the Plan source serves an explanatory error instead of data', () => {
    const source = planSource(null);
    expect(source.resources?.catalog).toEqual([soc]);
    const subscription = source.resources?.subscribe('/battery/soc', {
      plan: { start_time: '2029-001T00:00:00' } as any,
      simulationDataset: null,
      user: null,
    });
    expect(subscription && get(subscription.store)).toEqual({
      error: 'The plan has no simulation results',
      loading: false,
      resource: null,
    });
  });
});

describe('source browser adapters', () => {
  test('the Plan source lists simulated resources and the activity types present in spans', () => {
    const spans = [{ type: 'OBSERVE' }, { type: 'SLEW' }, { type: 'OBSERVE' }] as Span[];
    const [resources, activities] = planSource({ dataset_id: 40, id: 7 } as SimulationDataset, spans).browserNodes;
    expect(resources.children?.map(node => [node.label, node.action?.sourceId, node.action?.typeName])).toEqual([
      ['/battery/soc', PLAN_SOURCE_ID, 'resource'],
    ]);
    expect(activities.children?.map(node => [node.label, node.badge, node.action?.typeName])).toEqual([
      ['OBSERVE', '2', 'activity'],
      ['SLEW', '1', 'activity'],
    ]);
  });

  test('external events keep derivation group > source > event type, and add through the unbound event path', () => {
    const event = (derivation_group_name: string, source_key: string, event_type_name: string, key: string) =>
      ({ pkey: { derivation_group_name, event_type_name, key, source_key } }) as ExternalEvent;
    const source = createExternalEventsSource({
      acknowledged: { 'DG B': { last_acknowledged_at: '' } },
      derivationGroups: [
        { derived_event_total: 2, name: 'DG A', owner: 'a', source_type_name: 'DSN', sources: ['a.json', 'b.json'] },
        { derived_event_total: 1, name: 'DG B', owner: 'a', source_type_name: 'Ephemeris', sources: ['c.json'] },
      ],
      eventTypes: [{ attribute_schema: {}, name: 'Pass' }],
      events: [
        event('DG A', 'a.json', 'Pass', '1'),
        event('DG A', 'a.json', 'Pass', '2'),
        event('DG B', 'c.json', 'Eclipse', '1'),
      ],
      loading: false,
      planDerivationGroupLinks: [
        { acknowledged: true, derivation_group_name: 'DG B', last_acknowledged_at: '', plan_id: 1 },
        { acknowledged: true, derivation_group_name: 'DG A', last_acknowledged_at: '', plan_id: 1 },
      ],
      visibility: { 'DG A': false },
    });
    expect(source.id).toBe(EXTERNAL_EVENTS_SOURCE_ID);
    expect(source.resources).toBeUndefined();
    expect(source.intervals).toBeUndefined();
    expect(source.events?.catalog.map(type => type.name)).toEqual(['Eclipse', 'Pass']);
    const shape = (nodes: SourceBrowserNode[]): unknown =>
      nodes.map(node =>
        node.children ? [node.label, node.tags ?? [], shape(node.children)] : [node.label, node.badge],
      );
    expect(shape(source.browserNodes)).toEqual([
      [
        'DG A',
        ['DSN', 'hidden'],
        [
          ['a.json', [], [['Pass', '2']]],
          ['b.json', [], []],
        ],
      ],
      ['DG B', ['Ephemeris', 'updated'], [['c.json', [], [['Eclipse', '1']]]]],
    ]);
    const pass = source.browserNodes[0].children?.[0].children?.[0];
    expect(pass?.action).toEqual({
      item: { attribute_schema: {}, name: 'Pass' },
      sourceId: null,
      typeName: 'externalEvent',
    });
  });

  test('filtering keeps matching items with their ancestors', () => {
    const filtered = filterSourceBrowserNodes(registry.sources[0].browserNodes, 'soc');
    expect(filtered.map(node => [node.label, node.children?.map(child => child.label)])).toEqual([
      ['Resources (1)', ['/battery/soc']],
    ]);
  });
});
