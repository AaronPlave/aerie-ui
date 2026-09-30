// SPIKE 2 (multi-source timelines): the plan page's source registry.
// Source A is the plan's own simulation (exactly the Spike 1 plan provider); any further sources are
// attached independently (for the spike: standalone datasets named in `?standaloneDataset=`).
import { derived, writable, type Readable, type Writable } from 'svelte/store';
import type { User } from '../types/app';
import type { Span } from '../types/simulation';
import type { TimelineResourceProvider, TimelineSource, TimelineSourceRegistry } from '../types/timelineSource';
import { createPlanTimelineResourceProvider } from '../utilities/timelineResourceProviders';
import { PLAN_SIMULATION_SOURCE_ID } from '../utilities/timelineSources';
import { plan, planModelActivityTypes } from './plan';
import {
  allResourceTypes,
  resourceTypes,
  resourceTypesLoading,
  simulationDataset,
  spans,
  spansMap,
  spanUtilityMaps,
} from './simulation';

export const PLAN_SIMULATION_SOURCE_LABEL = 'Plan';

/**
 * SPIKE 3: selection of a span from a non-default source (the span carries its `sourceId`).
 * Deliberately separate from `selectedSpanId`, which every plan panel reads as "span N of the plan's
 * simulation" — putting an imported span's id there would show the plan's span with the same id.
 */
export const selectedSourceSpan: Writable<Span | null> = writable(null);

export function createPlanTimelineSourceRegistry(
  user: User | null,
  attachedSources: Readable<TimelineSource[]>,
): Readable<TimelineSourceRegistry> {
  let planProvider: TimelineResourceProvider | null = null;
  return derived(
    [
      plan,
      simulationDataset,
      resourceTypes,
      resourceTypesLoading,
      allResourceTypes,
      attachedSources,
      spans,
      spansMap,
      spanUtilityMaps,
      planModelActivityTypes,
    ],
    ([
      $plan,
      $simulationDataset,
      $resourceTypes,
      $resourceTypesLoading,
      $allResourceTypes,
      $attachedSources,
      $spans,
      $spansMap,
      $spanUtilityMaps,
      $planModelActivityTypes,
    ]) => {
      // Same gating TimelinePanel applied in Spike 1: no sim dataset -> no resources; while model
      // resource types load, keep the current provider rather than misclassifying names as external.
      if ($simulationDataset === null) {
        planProvider = null;
      } else if ($plan && !$resourceTypesLoading) {
        planProvider = createPlanTimelineResourceProvider($plan, $simulationDataset, $resourceTypes, user);
      }
      const planSource: TimelineSource = {
        binding: $simulationDataset
          ? `plan ${$plan?.id} / dataset ${$simulationDataset.dataset_id}`
          : `plan ${$plan?.id}`,
        // SPIKE 3: the plan slot's activity layers keep their existing meaning (directives + simulated
        // spans); these intervals are exposed for the catalog, tooltips and hierarchy lookups only.
        hasDirectives: true,
        id: PLAN_SIMULATION_SOURCE_ID,
        intervals: {
          intervalTypes: $planModelActivityTypes,
          key: `dataset:${$simulationDataset?.dataset_id ?? 'none'}`,
          spanUtilityMaps: $spanUtilityMaps,
          spans: $spans ?? [],
          spansMap: $spansMap ?? {},
        },
        label: PLAN_SIMULATION_SOURCE_LABEL,
        provider: planProvider,
        // The default source's catalog is unstamped, so layers created from it stay legacy strings.
        resourceTypes: $allResourceTypes,
        resourceTypesLoading: $resourceTypesLoading,
      };
      return { defaultSourceId: PLAN_SIMULATION_SOURCE_ID, sources: [planSource, ...$attachedSources] };
    },
  );
}
