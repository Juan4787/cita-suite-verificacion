import {
  loadPublicPracticeSettings,
  savePublicPracticePart,
  legacyPublicPracticeActions,
} from "$lib/server/sites/public/public-practice-settings";
import type { PageServerLoad, Actions } from "./$types";
export const load: PageServerLoad = (event) =>
  loadPublicPracticeSettings(event, true);
export const actions: Actions = {
  save: (event) => savePublicPracticePart(event, "documents"),
  cleanup: legacyPublicPracticeActions.cleanup,
};
