import { derived, writable, type Readable } from 'svelte/store';
import type { User } from '../types/app';
import type { Profile, ProfileSegment, Resource } from '../types/simulation';
import effects from '../utilities/effects';
import { INITIAL_SINCE, sampleProfiles } from '../utilities/resources';
import { selectLegacyExternalProfile } from '../utilities/timelineSources';
import { catchError } from './console';
import { planDatasets } from './plan';
import {
  acquireTimelineResource,
  releaseTimelineResource,
  setTimelineResourceState,
  type TimelineResourceState,
} from './timelineResourceStatus';

export type ExternalResourceSubscription = {
  store: Readable<TimelineResourceState>;
  unsubscribe: () => void;
};

type ProfileMetadata = {
  datasetId: number;
  duration: string;
  offsetFromPlanStart: string;
  profileId: number;
  type: Profile['type'];
};

/**
 * Per-(simDatasetId, name) live view of an external dataset resource.
 * Mirrors createProfileSubscription: subscribes to a metadata source
 * (planDatasets), windowed-pulls segments past the last seen start_offset
 * whenever metadata advances, accumulates, and re-samples into a Resource.
 *
 * `simDatasetId` is the current simulation's dataset id (or -1 for plan-
 * level). It's used to pick *which* plan_dataset row owns this name when
 * multiple rows define it — preferring the row tied to the active sim, then
 * the plan-level (null) row. This is the legacy merged-namespace lookup.
 *
 * With `datasetId`, the lookup is instead restricted to that one plan_dataset
 * row: the resource is "this name in this external dataset", and the same
 * name in other datasets or in the simulation never satisfies it.
 */
export function createExternalResourceSubscription(
  simDatasetId: number,
  name: string,
  planStartTimeYmd: string,
  user: User | null,
  datasetId?: number,
): ExternalResourceSubscription {
  const initialState: TimelineResourceState = { error: '', loading: true, resource: null };
  const statusId = datasetId ?? simDatasetId;
  const statusKind = datasetId === undefined ? 'external' : 'externalDataset';
  acquireTimelineResource(statusId, name, statusKind);
  setTimelineResourceState(statusId, name, statusKind, initialState);
  const state = writable<TimelineResourceState>(initialState);
  function setState(next: TimelineResourceState) {
    state.set(next);
    setTimelineResourceState(statusId, name, statusKind, next);
  }

  const accumulator: ProfileSegment[] = [];
  let sinceOffset = INITIAL_SINCE;
  let resolved = false;
  let lastError = '';
  let inFlight = false;
  // Re-fire once from the finally block if a refetch was requested while
  // another was in flight, so we don't miss the tail if the request
  // happened to be the last meaningful trigger (e.g. ingestion finished
  // while we were already fetching).
  let pendingRefetch = false;
  // Tracks the metadata snapshot we last refetched against, so we only
  // refire when duration advances or the chosen plan_dataset row changes.
  let lastMeta: ProfileMetadata | null = null;
  let currentMeta: ProfileMetadata | null = null;
  let disposed = false;
  const abortController = new AbortController();
  const unsubscribers: Array<() => void> = [];

  // Live metadata slice: pick the right plan_dataset row for (simDatasetId,
  // name) with the shared legacy precedence (selectLegacyExternalProfile).
  // Also surfaces "settling" so we don't flash a "not found" error during the
  // initial subscription bootstrap.
  type MetaResolution = { kind: 'settling' } | { kind: 'missing' } | { kind: 'found'; meta: ProfileMetadata };

  const metadata: Readable<MetaResolution> = derived(
    [planDatasets, planDatasets.loading],
    ([$planDatasets, $loading]): MetaResolution => {
      if ($loading) {
        return { kind: 'settling' };
      }
      const picked = selectLegacyExternalProfile(
        $planDatasets,
        simDatasetId > -1 ? simDatasetId : null,
        name,
        datasetId,
      );
      if (!picked) {
        return { kind: 'missing' };
      }
      return {
        kind: 'found',
        meta: {
          datasetId: picked.datasetId,
          duration: picked.profile.duration,
          offsetFromPlanStart: picked.offsetFromPlanStart,
          profileId: picked.profile.id,
          type: picked.profile.type,
        },
      };
    },
  );

  function emit() {
    if (disposed) {
      return;
    }
    let resource: Resource | null = null;
    if (currentMeta && resolved) {
      const synthesised: Profile = {
        dataset_id: currentMeta.datasetId,
        duration: currentMeta.duration,
        id: currentMeta.profileId,
        name,
        profile_segments: accumulator,
        type: currentMeta.type,
      };
      resource = sampleProfiles([synthesised], planStartTimeYmd, currentMeta.offsetFromPlanStart)[0] ?? null;
    }
    const nextState: TimelineResourceState = { error: lastError, loading: !resolved && !lastError, resource };
    setState(nextState);
  }

  async function refetch() {
    if (disposed || !currentMeta) {
      return;
    }
    if (inFlight) {
      pendingRefetch = true;
      return;
    }
    inFlight = true;
    try {
      const segments = await effects.getExternalProfileSegmentsSince(
        currentMeta.datasetId,
        currentMeta.profileId,
        sinceOffset,
        user,
        abortController.signal,
      );
      if (disposed) {
        return;
      }
      if (segments && segments.length > 0) {
        accumulator.push(...segments);
        sinceOffset = segments[segments.length - 1].start_offset;
      }
      resolved = true;
      lastError = '';
      emit();
    } catch (e) {
      if (disposed) {
        return;
      }
      const err = e as Error;
      if (err.name === 'AbortError') {
        return;
      }
      lastError = err.message || 'External profile fetch failed';
      emit();
    } finally {
      inFlight = false;
      if (pendingRefetch && !disposed) {
        pendingRefetch = false;
        refetch();
      }
    }
  }

  function resetForNewProfile() {
    accumulator.length = 0;
    sinceOffset = INITIAL_SINCE;
    resolved = false;
  }

  // Race-defer for missing: gqlSubscribable.next() flips `.loading` to
  // false BEFORE propagating the new value to subscribers. So the derived
  // briefly sees `{loading: false, planDatasets: []}` on the first tick and
  // would emit 'missing' just before the value update arrives as 'found'.
  // Defer the missing verdict by a microtask so a synchronously-following
  // 'found' can cancel it. Genuine misconfigs still surface — the microtask
  // flushes with `pendingMissing` still true.
  let pendingMissing = false;

  unsubscribers.push(
    metadata.subscribe(next => {
      if (disposed) {
        return;
      }
      if (next.kind === 'settling') {
        pendingMissing = false;
        return;
      }
      if (next.kind === 'missing') {
        pendingMissing = true;
        queueMicrotask(() => {
          if (disposed || !pendingMissing) {
            return;
          }
          pendingMissing = false;
          currentMeta = null;
          lastMeta = null;
          resetForNewProfile();
          lastError =
            datasetId === undefined
              ? 'Resource not found in attached external datasets'
              : `Resource not found in external dataset ${datasetId}`;
          catchError('log', `Unable to load resource "${name}"`, new Error(lastError));
          emit();
        });
        return;
      }
      pendingMissing = false;
      const { meta } = next;
      currentMeta = meta;
      // If we switched to a different profile row (different dataset or id),
      // reset accumulator and sinceOffset before refetching.
      const switched =
        lastMeta !== null && (lastMeta.datasetId !== meta.datasetId || lastMeta.profileId !== meta.profileId);
      if (switched) {
        resetForNewProfile();
      }
      const durationAdvanced = lastMeta === null || lastMeta.duration !== meta.duration;
      lastMeta = meta;
      // Assumption: external profiles only grow via `duration` advancement.
      // If a backend ever appends segments without bumping duration, those
      // segments are silently missed here — refetches are gated on duration.
      // Static-at-write-time today; revisit if a "live external dataset"
      // feature ships.
      if (switched || durationAdvanced || !resolved) {
        refetch();
      } else if (lastError) {
        // Re-emit to clear lingering error if metadata is now clean.
        emit();
      }
      // Otherwise: meta unchanged, no error pending, no need to re-sample
      // the full accumulator and re-push identical state downstream.
    }),
  );

  return {
    store: { subscribe: state.subscribe },
    unsubscribe: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      releaseTimelineResource(statusId, name, statusKind);
      abortController.abort();
      unsubscribers.forEach(unsub => unsub());
    },
  };
}
