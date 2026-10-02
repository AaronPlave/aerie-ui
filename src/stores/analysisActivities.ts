import { writable } from 'svelte/store';
import type { AnalysisSimulationDataset, AnalysisSourceBinding } from '../types/analysis';
import type { User } from '../types/app';
import type { Span } from '../types/simulation';
import type { TimelineActivityState, TimelineActivitySubscription } from '../types/timelineSource';
import effects from '../utilities/effects';

/** The activities a row shows, loaded whole once. */
export function createLoadedActivitySubscription(load: () => Promise<Span[]>): TimelineActivitySubscription {
  const state = writable<TimelineActivityState>({ error: '', loading: true, spans: [] });
  let disposed = false;
  load()
    .then(spans => !disposed && state.set({ error: '', loading: false, spans }))
    .catch(e => !disposed && state.set({ error: (e as Error).message, loading: false, spans: [] }));
  return {
    store: { subscribe: state.subscribe },
    unsubscribe: () => {
      disposed = true;
    },
  };
}

const simulationSpans = new WeakMap<User, Map<number, Promise<Span[]>>>();
const revisionActivities = new WeakMap<User, Map<string, Promise<Span[]>>>();

/**
 * Every activity of one imported revision of the given types (all, for null), fetched once per session and shared
 * by the rows asking for the same types. Revisions are immutable, so what was fetched stays right.
 *
 * ponytail: whole loads, no windowing or LOD. Fine at hundreds of thousands of activities; page by time if a
 * revision outgrows what the browser holds.
 */
export function getRevisionActivities(
  revisionId: number,
  types: string[] | null,
  toSpan: (activity: Awaited<ReturnType<typeof effects.getSourceActivities>>[number]) => Span,
  user: User | null,
): Promise<Span[]> {
  if (!user) {
    return Promise.resolve([]);
  }
  const byKey = revisionActivities.get(user) ?? new Map<string, Promise<Span[]>>();
  revisionActivities.set(user, byKey);
  const key = `${revisionId}:${types ? [...types].sort().join(',') : '*'}`;
  let spans = byKey.get(key);
  if (!spans) {
    spans = effects.getSourceActivities(revisionId, types, user).then(activities => activities.map(toSpan));
    spans.catch(() => byKey.delete(key));
    byKey.set(key, spans);
  }
  return spans;
}

/**
 * Every span of one simulation dataset, at absolute times, fetched once per session and shared by every row, the
 * Sources browser and the table. Offsets are from the simulation's own start: the analysis has no plan to use.
 */
export function getSimulationDatasetSpans(
  dataset: { dataset_id: number; id: number; simulation_start_time: string | null },
  user: User | null,
): Promise<Span[]> {
  if (!user || !dataset.simulation_start_time) {
    return Promise.resolve([]);
  }
  const byDataset = simulationSpans.get(user) ?? new Map<number, Promise<Span[]>>();
  simulationSpans.set(user, byDataset);
  let spans = byDataset.get(dataset.id);
  if (!spans) {
    spans = effects.getSpans(dataset.dataset_id, dataset.simulation_start_time, user);
    byDataset.set(dataset.id, spans);
  }
  return spans;
}

const revisionActivityTimes = new WeakMap<User, Map<number, Promise<Pick<Span, 'durationMs' | 'startMs'>[]>>>();

/**
 * When every activity of the bound sources is, for the timeline's histogram. Fetched once per revision per session.
 *
 * ponytail: ships each imported activity's times to the browser (~60 MB for 670k). Bin in the database if
 * revisions grow much past that.
 */
export async function getAnalysisActivityTimes(
  bindings: AnalysisSourceBinding[],
  datasets: AnalysisSimulationDataset[],
  user: User | null,
): Promise<Pick<Span, 'durationMs' | 'startMs'>[]> {
  if (!user) {
    return [];
  }
  const byRevision =
    revisionActivityTimes.get(user) ?? new Map<number, Promise<Pick<Span, 'durationMs' | 'startMs'>[]>>();
  revisionActivityTimes.set(user, byRevision);
  const perSource = await Promise.all(
    bindings.map(binding => {
      if (binding.kind === 'simulation') {
        const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
        return dataset ? getSimulationDatasetSpans(dataset, user) : [];
      }
      let times = byRevision.get(binding.revisionId);
      if (!times) {
        times = effects.getSourceActivityTimes(binding.revisionId, user);
        times.catch(() => byRevision.delete(binding.revisionId));
        byRevision.set(binding.revisionId, times);
      }
      return times;
    }),
  );
  return perSource.flat();
}
