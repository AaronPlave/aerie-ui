// SPIKE (standalone timeline datasets): exploratory route, not final navigation.
import { base } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import effects from '../../../utilities/effects';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params }) => {
  const { user } = await parent();
  const standaloneDatasetId = parseFloat(params.id);

  if (!Number.isNaN(standaloneDatasetId)) {
    const result = await effects.getStandaloneDataset(standaloneDatasetId, user);
    if (result) {
      const { resourceTypes, standaloneDataset } = result;
      // getSpans is already dataset-generic: offsets are resolved against whatever start time it is given.
      const initialSpans = await effects.getSpans(standaloneDataset.dataset_id, standaloneDataset.start_time, user);
      return { initialSpans, resourceTypes, standaloneDataset };
    }
  }

  redirect(302, `${base}/plans`);
};
