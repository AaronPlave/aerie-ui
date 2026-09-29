import { describe, expect, test } from 'vitest';
import type { Resource, ResourceType } from '../types/simulation';
import type { Axis } from '../types/timeline';
import { createTimelineLineLayer, createTimelineResourceLayer, getResourceForLayer, getYAxisBounds } from './timeline';
import {
  getResourceFilterName,
  getResourceRequestKey,
  PLAN_SIMULATION_SOURCE_ID,
  resolveResourceRef,
  resourceMatchesFilter,
  toResourceLayerFilter,
} from './timelineSources';

const DEFAULT = PLAN_SIMULATION_SOURCE_ID;
const OTHER = 'standalone:42';
const schema: ResourceType['schema'] = { type: 'real' };

describe('source-qualified resource identity', () => {
  test('legacy string filters resolve to the default source', () => {
    expect(resolveResourceRef('/battery/soc', DEFAULT)).toEqual({ name: '/battery/soc', sourceId: DEFAULT });
    expect(resolveResourceRef({ name: '/battery/soc', sourceId: OTHER }, DEFAULT)).toEqual({
      name: '/battery/soc',
      sourceId: OTHER,
    });
    expect(resolveResourceRef('', DEFAULT)).toBeNull();
    expect(resolveResourceRef(undefined, DEFAULT)).toBeNull();
    expect(getResourceFilterName({ name: '/a', sourceId: OTHER })).toBe('/a');
    expect(getResourceFilterName('/a')).toBe('/a');
  });

  test('canonical stored form keeps strings for the default source only', () => {
    expect(toResourceLayerFilter('/battery/soc', DEFAULT, DEFAULT)).toBe('/battery/soc');
    expect(toResourceLayerFilter('/battery/soc', undefined, DEFAULT)).toBe('/battery/soc');
    expect(toResourceLayerFilter('/battery/soc', OTHER, DEFAULT)).toEqual({ name: '/battery/soc', sourceId: OTHER });
    expect(toResourceLayerFilter('', OTHER, DEFAULT)).toBe('');
  });

  test('request keys never collide for same-named resources from different sources', () => {
    expect(getResourceRequestKey('/battery/soc', DEFAULT)).not.toEqual(getResourceRequestKey('/battery/soc', OTHER));
  });

  test('matching uses (source, name); unstamped records belong to the default source', () => {
    const predicted: Resource = { name: '/battery/soc', schema, sourceId: DEFAULT, values: [] };
    const unstamped: Resource = { name: '/battery/soc', schema, values: [] };
    const imported: Resource = { name: '/battery/soc', schema, sourceId: OTHER, values: [] };
    const importedRef = { name: '/battery/soc', sourceId: OTHER };
    expect(resourceMatchesFilter(predicted, '/battery/soc', DEFAULT)).toBe(true);
    expect(resourceMatchesFilter(unstamped, '/battery/soc', DEFAULT)).toBe(true);
    expect(resourceMatchesFilter(imported, '/battery/soc', DEFAULT)).toBe(false);
    expect(resourceMatchesFilter(imported, importedRef, DEFAULT)).toBe(true);
    expect(resourceMatchesFilter(predicted, importedRef, DEFAULT)).toBe(false);
    // No registry at all (legacy callers): plain name matching still works.
    expect(resourceMatchesFilter(unstamped, '/battery/soc', undefined)).toBe(true);
  });

  test('getResourceForLayer picks the right one of two same-named resources', () => {
    const predicted: Resource = { name: '/battery/soc', schema, sourceId: DEFAULT, values: [] };
    const imported: Resource = { name: '/battery/soc', schema, sourceId: OTHER, values: [] };
    const layerA = createTimelineLineLayer([], [], { filter: { resource: '/battery/soc' } });
    const layerB = createTimelineLineLayer([], [], { filter: { resource: { name: '/battery/soc', sourceId: OTHER } } });
    // Order must not matter: the imported one first would win under bare-name matching.
    expect(getResourceForLayer(layerA, [imported, predicted], DEFAULT)).toBe(predicted);
    expect(getResourceForLayer(layerB, [predicted, imported], DEFAULT)).toBe(imported);
  });

  test('y-axis bounds span both sources when two same-named layers share an axis', () => {
    const predicted: Resource = {
      name: '/battery/soc',
      schema,
      sourceId: DEFAULT,
      values: [
        { x: 0, y: 70 },
        { x: 10, y: 90 },
      ],
    };
    const imported: Resource = {
      name: '/battery/soc',
      schema,
      sourceId: OTHER,
      values: [
        { x: 2, y: 30 },
        { x: 5, y: 50 },
      ],
    };
    const yAxis: Axis = {
      color: '',
      domainFitMode: 'fitTimeWindow',
      id: 1,
      label: { text: '' },
      scaleDomain: [],
      tickCount: 5,
    };
    const layerA = createTimelineLineLayer([], [], { filter: { resource: '/battery/soc' }, yAxisId: 1 });
    const layerB = createTimelineLineLayer([], [], {
      filter: { resource: { name: '/battery/soc', sourceId: OTHER } },
      yAxisId: 1,
    });
    expect(getYAxisBounds(yAxis, [layerA, layerB], [predicted, imported], undefined, DEFAULT)).toEqual([30, 90]);
    expect(getYAxisBounds(yAxis, [layerB], [predicted, imported], undefined, DEFAULT)).toEqual([30, 50]);
  });

  test('layers created from a stamped catalog entry keep their source', () => {
    const { layer } = createTimelineResourceLayer([], { name: '/battery/soc', schema, sourceId: OTHER });
    expect(layer?.filter.resource).toEqual({ name: '/battery/soc', sourceId: OTHER });
    const { layer: legacy } = createTimelineResourceLayer([], { name: '/battery/soc', schema });
    expect(legacy?.filter.resource).toBe('/battery/soc');
  });
});
