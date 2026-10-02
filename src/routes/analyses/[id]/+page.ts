import { base } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import effects from '../../../utilities/effects';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params }) => {
  const { user } = await parent();
  const id = Number(params.id);
  const initialAnalysis = Number.isInteger(id) ? await effects.getAnalysis(id, user) : null;
  if (!initialAnalysis) {
    redirect(302, `${base}/analyses`);
  }
  return { initialAnalysis };
};
