import { get } from 'svelte/store';
import { expect, test } from 'vitest';
import {
  acquireTimelineResource,
  releaseTimelineResource,
  setTimelineResourceState,
  timelineResourcesErroring,
} from './timelineResourceStatus';

test('profile and external entries with the same numeric id and name do not collide', () => {
  // Profiles key on merlin.dataset.id and external resources on simulation_dataset.id: the same
  // number can mean different things.
  acquireTimelineResource(12, '/battery/soc', 'sim');
  acquireTimelineResource(12, '/battery/soc', 'external');
  setTimelineResourceState(12, '/battery/soc', 'sim', { error: 'profile failed', loading: false, resource: null });
  setTimelineResourceState(12, '/battery/soc', 'external', {
    error: 'external failed',
    loading: false,
    resource: null,
  });
  expect(get(timelineResourcesErroring).map(e => `${e.kind}:${e.error}`)).toEqual(
    expect.arrayContaining(['sim:profile failed', 'external:external failed']),
  );
  releaseTimelineResource(12, '/battery/soc', 'external');
  expect(get(timelineResourcesErroring).map(e => e.kind)).toEqual(['sim']);
  releaseTimelineResource(12, '/battery/soc', 'sim');
  expect(get(timelineResourcesErroring)).toEqual([]);
});
