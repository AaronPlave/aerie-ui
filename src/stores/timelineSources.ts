import { derived, type Readable } from 'svelte/store';
import type { ResourceType } from '../types/simulation';
import type { TimelineSourceRegistry } from '../types/timelineSource';
import gql from '../utilities/gql';
import {
  createExternalDatasetSources,
  createExternalEventsSource,
  createPlanSimulationSource,
} from '../utilities/timelineSources';
import { externalEventTypes, selectedExternalEvents, selectedExternalEventsRaw } from './external-event';
import {
  derivationGroups,
  derivationGroupsAcknowledged,
  derivationGroupVisibilityMap,
  planDerivationGroupLinks,
} from './external-source';
import { createExternalResourceSubscription } from './externalResource';
import { planDatasets, planModelActivityTypes } from './plan';
import { createProfileSubscription } from './profile';
import { simulationDataset, simulationDatasetId, spans } from './simulation';
import { gqlSubscribable } from './subscribable';

/** Profiles present in the selected simulation dataset: what the simulation actually produced. */
export const simulationProfileCatalog = gqlSubscribable<ResourceType[]>(
  gql.SUB_SIMULATION_DATASET_PROFILES,
  { simulationDatasetId },
  [],
  (
    simulationDataset: {
      dataset: { profiles: { name: string; type: { schema: ResourceType['schema'] } }[] } | null;
    } | null,
  ): ResourceType[] =>
    (simulationDataset?.dataset?.profiles ?? []).map(({ name, type }) => ({ name, schema: type.schema })),
);

const planSimulationSource = derived(
  [
    planModelActivityTypes,
    planModelActivityTypes.loading,
    simulationProfileCatalog,
    simulationProfileCatalog.loading,
    simulationDataset,
    spans,
  ],
  ([
    $planModelActivityTypes,
    $activityTypesLoading,
    $simulationProfileCatalog,
    $profileCatalogLoading,
    $simulationDataset,
    $spans,
  ]) =>
    createPlanSimulationSource({
      activityTypes: $planModelActivityTypes,
      activityTypesLoading: $activityTypesLoading,
      profileCatalog: $simulationDataset ? $simulationProfileCatalog : [],
      profileCatalogLoading: $profileCatalogLoading,
      simulationDataset: $simulationDataset,
      spans: $spans,
      subscribeProfile: (datasetId, name, startYmd, { user }) =>
        createProfileSubscription(datasetId, name, startYmd, user),
    }),
);

const externalDatasetSources = derived([planDatasets, simulationDatasetId], ([$planDatasets, $simulationDatasetId]) =>
  createExternalDatasetSources({
    planDatasets: $planDatasets,
    simulationDatasetId: $simulationDatasetId,
    subscribeExternal: (datasetId, name, { plan, simulationDataset, user }) =>
      createExternalResourceSubscription(simulationDataset?.id ?? -1, name, plan.start_time, user, datasetId),
  }),
);

const externalEventsSource = derived(
  [
    selectedExternalEvents,
    selectedExternalEventsRaw.loading,
    planDerivationGroupLinks,
    derivationGroups,
    derivationGroupVisibilityMap,
    derivationGroupsAcknowledged,
    externalEventTypes,
  ],
  ([$events, $loading, $links, $derivationGroups, $visibility, $acknowledged, $eventTypes]) =>
    createExternalEventsSource({
      acknowledged: $acknowledged,
      derivationGroups: $derivationGroups,
      eventTypes: $eventTypes,
      events: $events,
      loading: $loading,
      planDerivationGroupLinks: $links,
      visibility: $visibility,
    }),
);

/** Every source available to the current Plan page's timeline. */
export const timelineSources: Readable<TimelineSourceRegistry> = derived(
  [planSimulationSource, externalDatasetSources, externalEventsSource, planDatasets.loading],
  ([$planSimulationSource, $externalDatasetSources, $externalEventsSource, $planDatasetsLoading]) => ({
    loading: $planDatasetsLoading,
    sources: [$planSimulationSource, ...$externalDatasetSources, $externalEventsSource],
  }),
);
