import {
  loadProfessionalQuestions,
  saveProfessionalQuestions,
} from "$lib/server/professional-questions";
import type { PageServerLoad, Actions } from "./$types";
export const load: PageServerLoad = loadProfessionalQuestions;
export const actions: Actions = { save_form: saveProfessionalQuestions };
