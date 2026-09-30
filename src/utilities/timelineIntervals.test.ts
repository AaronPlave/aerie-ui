// SPIKE 3: source-qualified interval (span) identity, hierarchy, layer binding and filtering.
import { describe, expect, test } from 'vitest';
import type { ActivityType } from '../types/activity';
import type { Span } from '../types/simulation';
import type { TimelineSourceRegistry } from '../types/timelineSource';
import { inferIntervalTypeDescriptors } from './standaloneDataset';
import { applyActivityLayerFilter, generateDiscreteTreeUtil } from './timeline';
import {
  createTimelineIntervalData,
  getSpanKey,
  getSpanKeyForSpan,
  getSpanParent,
  getSpanRef,
  parseSourceBindings,
  PLAN_SIMULATION_SOURCE_ID,
  resolveActivityLayerSourceId,
  spanRefsEqual,
  toActivityLayerSourceId,
} from './timelineSources';

const DEFAULT = PLAN_SIMULATION_SOURCE_ID;
const TOUR = 'tour';

function span(span_id: number, type: string, startMs: number, parent_id: number | null = null, args = {}): Span {
  return {
    attributes: { arguments: args, computedAttributes: {} },
    dataset_id: 0,
    duration: '01:00:00',
    durationMs: 3600000,
    endMs: startMs + 3600000,
    parent_id,
    span_id,
    startMs,
    start_offset: '00:00:00',
    type,
  };
}

const type = (name: string): ActivityType => ({
  computed_attributes_value_schema: { items: {}, type: 'struct' },
  name,
  parameters: {},
  required_parameters: [],
  subsystem_tag: null,
});

// Plan: OBSERVE 1 with child SLEW 2. Tour: the same ids and types at other times, plus INSTR spans.
const planSpans = [span(1, 'OBSERVE', 1000), span(2, 'SLEW', 1100, 1)];
const tour = createTimelineIntervalData(
  'dataset:46',
  [
    span(1, 'OBSERVE', 9000, null, { legend: 'Science', subsystem: 'INSTR' }),
    span(2, 'SLEW', 9100, 1, { legend: 'GNC', subsystem: 'GNC' }),
    span(3, 'INSTR_Decontamination', 9500, null, { legend: 'INSTR', subsystem: 'INSTR' }),
  ],
  [type('INSTR_Decontamination'), type('OBSERVE'), type('SLEW')],
  TOUR,
);
const planData = createTimelineIntervalData('dataset:13', planSpans, [type('OBSERVE'), type('SLEW')], null);
const registry: TimelineSourceRegistry = {
  defaultSourceId: DEFAULT,
  sources: [
    { id: DEFAULT, intervals: planData, label: 'Plan', provider: null, resourceTypes: [] },
    { id: TOUR, intervals: tour, label: 'Imported Tour', provider: null, resourceTypes: [] },
  ],
};

describe('source-qualified span identity', () => {
  test('same span_id in two sources is two identities', () => {
    const planRef = getSpanRef(planSpans[0]);
    const tourRef = getSpanRef(tour.spans[0]);
    expect(planRef).toEqual({ sourceId: null, spanId: 1 });
    expect(tourRef).toEqual({ sourceId: TOUR, spanId: 1 });
    expect(spanRefsEqual(planRef, tourRef)).toBe(false);
    expect(getSpanKey(planRef)).not.toBe(getSpanKey(tourRef));
    expect(getSpanKeyForSpan(tour.spans[0])).toBe(getSpanKey({ sourceId: TOUR, spanId: 1 }));
  });

  test('interval data stamps non-default spans and keeps span maps source-local', () => {
    expect(tour.spans.every(s => s.sourceId === TOUR)).toBe(true);
    expect(planData.spans.every(s => s.sourceId === undefined)).toBe(true);
    expect(tour.spansMap[1].startMs).toBe(9000);
    expect(tour.spanUtilityMaps.spanIdToChildIdsMap[1]).toEqual([2]);
  });

  test('parent_id resolves within the span’s own source', () => {
    const tourChild = tour.spans[1];
    expect(getSpanParent(tourChild, registry, planData.spansMap)?.startMs).toBe(9000); // tour span 1
    const planChild = planSpans[1];
    expect(getSpanParent(planChild, registry, planData.spansMap)?.startMs).toBe(1000); // plan span 1
  });
});

describe('activity layer source binding', () => {
  test('legacy layers default to the default source; the default is never written back', () => {
    expect(resolveActivityLayerSourceId({}, DEFAULT)).toBe(DEFAULT);
    expect(resolveActivityLayerSourceId({ sourceId: TOUR }, DEFAULT)).toBe(TOUR);
    expect(toActivityLayerSourceId(DEFAULT, DEFAULT)).toBeUndefined();
    expect(toActivityLayerSourceId(TOUR, DEFAULT)).toBe(TOUR);
  });

  test('the unchanged activity filter selects only from the namespace it is given', () => {
    const filter = { static_types: ['OBSERVE'] };
    expect(
      applyActivityLayerFilter(filter, [], tour.spans, tour.intervalTypes, {}).spans.map(getSpanKeyForSpan),
    ).toEqual([getSpanKey({ sourceId: TOUR, spanId: 1 })]);
    expect(applyActivityLayerFilter(filter, [], planSpans, planData.intervalTypes, {}).spans).toEqual([planSpans[0]]);
    // Instance-level metadata via the existing Parameter filter (reads attributes.arguments).
    const bySubsystem = applyActivityLayerFilter(
      {
        other_filters: [
          {
            field: 'Parameter',
            id: 0,
            operator: 'equals',
            subfield: { name: 'subsystem', type: 'string' },
            value: 'INSTR',
          },
        ],
      },
      [],
      tour.spans,
      tour.intervalTypes,
      {},
    );
    expect(bySubsystem.spans.map(s => s.type)).toEqual(['OBSERVE', 'INSTR_Decontamination']);
  });

  test('a non-default source gets namespaced tree nodes built from its own maps', () => {
    const tree = generateDiscreteTreeUtil(
      [],
      tour.spans.slice(0, 1),
      [],
      { 'tour::OBSERVE': true },
      'flat',
      'event_type_name',
      false,
      tour.spanUtilityMaps,
      tour.spansMap,
      true,
      false,
      { end: 20000, start: 0 },
      false,
      true,
      { idPrefix: 'tour::', labelSuffix: ' · Imported Tour' },
    );
    expect(tree.map(node => [node.id, node.label])).toEqual([['tour::OBSERVE', 'OBSERVE · Imported Tour']]);
    // span 1's subtree is non-leaf because *tour* span 1 has a child (tour span 2)
    expect(tree[0].children[0].isLeaf).toBe(false);
  });

  test('directive hierarchy mode uses root spans for a source without directives', () => {
    const tree = generateDiscreteTreeUtil(
      [],
      tour.spans,
      [],
      {},
      'directive',
      'event_type_name',
      false,
      tour.spanUtilityMaps,
      tour.spansMap,
      true,
      false,
      { end: 20000, start: 0 },
      false,
      true,
      { idPrefix: 'tour::', labelSuffix: '' },
    );
    expect(tree.map(node => node.label)).toEqual(['INSTR_Decontamination', 'OBSERVE']); // SLEW is a child
  });
});

describe('runtime source bindings and inferred catalogs', () => {
  test('slots come from ?source.<slot>=standalone:<id>; Spike 2 ids still parse', () => {
    const bindings = parseSourceBindings(
      new URLSearchParams('source.tour=standalone:10&source.tour.catalog=inferred&standaloneDataset=9'),
    );
    expect(bindings).toEqual([
      { artifactId: 10, catalog: 'inferred', kind: 'standalone', slot: 'tour' },
      { artifactId: 9, catalog: 'names', kind: 'standalone', slot: 'standalone:9' },
    ]);
  });

  test('parameters are inferred from normalized span arguments', () => {
    const descriptors = inferIntervalTypeDescriptors(tour.spans);
    expect(descriptors.find(d => d.name === 'OBSERVE')?.parameters).toEqual({
      legend: { type: 'string' },
      subsystem: { type: 'string' },
    });
  });
});
