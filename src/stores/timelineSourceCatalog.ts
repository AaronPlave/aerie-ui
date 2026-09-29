// SPIKE (standalone timeline datasets): lets a page that is not the plan page supply the
// type catalog that timeline editor components otherwise read from mission-model stores.
// The plan page sets nothing, so every consumer falls back to its original global store.
import { getContext, setContext } from 'svelte';
import type { TimelineSourceCatalog } from '../types/timelineSource';

const timelineSourceCatalogKey = Symbol('timelineSourceCatalog');

export function setTimelineSourceCatalog(catalog: TimelineSourceCatalog): void {
  setContext(timelineSourceCatalogKey, catalog);
}

export function getTimelineSourceCatalog(): TimelineSourceCatalog {
  return getContext<TimelineSourceCatalog | undefined>(timelineSourceCatalogKey) ?? {};
}
