// SPIKE (standalone timeline datasets): the two TimelineResourceProvider implementations.
import { createExternalResourceSubscription } from '../stores/externalResource';
import { createProfileSubscription } from '../stores/profile';
import type { User } from '../types/app';
import type { Plan } from '../types/plan';
import type { ActivityType } from '../types/activity';
import type { ResourceType, SimulationDataset, Span } from '../types/simulation';
import type {
  StandaloneDataset,
  TimelineResourceProvider,
  TimelineSource,
  TimelineSourceId,
} from '../types/timelineSource';
import { createTimelineIntervalData, getStandaloneSourceId, PLAN_SIMULATION_SOURCE_ID } from './timelineSources';

/**
 * The plan page's existing behavior, moved out of Row.svelte unchanged: a resource is either a
 * profile of the active simulation's dataset (if the mission model declares it) or a profile of
 * an external plan_dataset attached to the plan.
 */
export function createPlanTimelineResourceProvider(
  plan: Plan,
  simulationDataset: SimulationDataset,
  modelResourceTypes: ResourceType[],
  user: User | null,
): TimelineResourceProvider {
  const simProfileStartYmd = simulationDataset.simulation_start_time ?? plan.start_time;
  return {
    key: `plan-simulation:${simulationDataset.dataset_id}`,
    sourceId: PLAN_SIMULATION_SOURCE_ID,
    subscribeResource(name) {
      const isExternal = !modelResourceTypes.find(type => type.name === name);
      // External datasets are matched by the simulation_dataset *id* (what
      // plan_dataset.simulation_dataset_id references), whereas internal
      // profiles are fetched by dataset_id. These are distinct id spaces;
      // passing dataset_id to the external factory makes its sim-tied
      // plan_dataset row preference silently never match.
      return isExternal
        ? createExternalResourceSubscription(simulationDataset.id, name, plan.start_time, user)
        : createProfileSubscription(simulationDataset.dataset_id, name, simProfileStartYmd, user);
    },
  };
}

/**
 * SPIKE 2: the standalone dataset as a registry entry. Its catalog is stamped with the source id so
 * layers created from it (drag/drop, "add to row") are source-qualified.
 * SPIKE 3: `sourceId` may be a view slot ("tour") instead of the artifact-derived id, and the source
 * can also expose intervals (its spans) when they are passed in.
 */
export function createStandaloneTimelineSource(
  standaloneDataset: StandaloneDataset,
  resourceTypes: ResourceType[],
  user: User | null,
  stampResourceTypes: boolean = true,
  options: { intervalTypes?: ActivityType[]; sourceId?: TimelineSourceId; spans?: Span[] } = {},
): TimelineSource {
  const provider = createStandaloneTimelineResourceProvider(standaloneDataset, user, options.sourceId);
  return {
    binding: `standalone_dataset ${standaloneDataset.id} (${standaloneDataset.name}) / dataset ${standaloneDataset.dataset_id}`,
    id: provider.sourceId,
    intervals: options.spans
      ? createTimelineIntervalData(
          `dataset:${standaloneDataset.dataset_id}`,
          options.spans,
          options.intervalTypes ?? [],
          stampResourceTypes ? provider.sourceId : null,
        )
      : undefined,
    label: standaloneDataset.name,
    provider,
    resourceTypes: stampResourceTypes
      ? resourceTypes.map(type => ({ ...type, sourceId: provider.sourceId }))
      : resourceTypes,
  };
}

/**
 * A standalone dataset: every resource is a profile in one merlin.dataset, and offsets are relative
 * to the standalone dataset's own start_time. No plan, model, or simulation is consulted.
 *
 * Reuses createProfileSubscription as-is: its fetch is already keyed only by (dataset_id, name).
 * Its only simulation coupling is liveness (it listens to the global simulationDataset store to
 * refetch while a sim streams); with no matching simulation it does a single fetch.
 */
export function createStandaloneTimelineResourceProvider(
  standaloneDataset: StandaloneDataset,
  user: User | null,
  sourceId: TimelineSourceId = getStandaloneSourceId(standaloneDataset.id),
): TimelineResourceProvider {
  return {
    key: `standalone:${standaloneDataset.dataset_id}`,
    sourceId,
    subscribeResource(name) {
      return createProfileSubscription(standaloneDataset.dataset_id, name, standaloneDataset.start_time, user);
    },
  };
}
