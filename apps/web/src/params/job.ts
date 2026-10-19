import { isScheduledJobKind, type ScheduledJobKind } from '@cita-suite/shared/scheduled-jobs';
import type { ParamMatcher } from '@sveltejs/kit';

/** Only the categories the scheduler can name reach the job route. */
export const match = ((param: string): param is ScheduledJobKind => isScheduledJobKind(param)) satisfies ParamMatcher;
