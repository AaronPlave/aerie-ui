// SPIKE 2 (multi-source timelines): the plan page's source registry.
// Source A is the plan's own simulation (exactly the Spike 1 plan provider); any further sources are
// attached independently (for the spike: standalone datasets named in `?standaloneDataset=`).
import { derived, type Readable } from 'svelte/store';
import type { User } from '../types/app';
import type { TimelineResourceProvider, TimelineSource, TimelineSourceRegistry } from '../types/timelineSource';
import { createPlanTimelineResourceProvider } from '../utilities/timelineResourceProviders';
import { PLAN_SIMULATION_SOURCE_ID } from '../utilities/timelineSources';
import { plan } from './plan';
import { allResourceTypes, resourceTypes, resourceTypesLoading, simulationDataset } from './simulation';

export const PLAN_SIMULATION_SOURCE_LABEL = 'Plan Simulation';

export function createPlanTimelineSourceRegistry(
  user: User | null,
  attachedSources: Readable<TimelineSource[]>,
): Readable<TimelineSourceRegistry> {
  let planProvider: TimelineResourceProvider | null = null;
  return derived(
    [plan, simulationDataset, resourceTypes, resourceTypesLoading, allResourceTypes, attachedSources],
    ([$plan, $simulationDataset, $resourceTypes, $resourceTypesLoading, $allResourceTypes, $attachedSources]) => {
      // Same gating TimelinePanel applied in Spike 1: no sim dataset -> no resources; while model
      // resource types load, keep the current provider rather than misclassifying names as external.
      if ($simulationDataset === null) {
        planProvider = null;
      } else if ($plan && !$resourceTypesLoading) {
        planProvider = createPlanTimelineResourceProvider($plan, $simulationDataset, $resourceTypes, user);
      }
      const planSource: TimelineSource = {
        id: PLAN_SIMULATION_SOURCE_ID,
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
