export const EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS =
	'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS';

export const EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE =
	'Ese email ya pertenece a otro consultorio.';

const errorMessage = (error: unknown) =>
	typeof error === 'object' && error !== null && 'message' in error
		? String((error as { message?: unknown }).message ?? '')
		: String(error ?? '');

export const isEmailAlreadyAssociatedWithOtherBusinessError = (error: unknown) =>
	errorMessage(error).includes(EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS);

export const businessEmailAssociationErrorMessage = (error: unknown, fallback: string) =>
	isEmailAlreadyAssociatedWithOtherBusinessError(error)
		? EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE
		: fallback;

export const businessEmailAssociationErrorStatus = (error: unknown, fallback = 500) =>
	isEmailAlreadyAssociatedWithOtherBusinessError(error) ? 409 : fallback;
