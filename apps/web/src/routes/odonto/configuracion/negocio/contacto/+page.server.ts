import {
  loadPublicPracticeSettings,
  savePublicPracticePart,
} from "$lib/server/public-practice-settings";
import type { PageServerLoad, Actions } from "./$types";
export const load: PageServerLoad = (event) =>
  loadPublicPracticeSettings(event, false);
export const actions: Actions = {
  save: (event) => savePublicPracticePart(event, "contact"),
};
