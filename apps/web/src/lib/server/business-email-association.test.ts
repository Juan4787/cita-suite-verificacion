import { describe, expect, it } from 'vitest';
import {
	businessEmailAssociationErrorMessage,
	businessEmailAssociationErrorStatus,
	EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE,
	isEmailAlreadyAssociatedWithOtherBusinessError
} from './business-email-association';

describe('business email association errors', () => {
	it('identifies the cross-business email rule and exposes its exact user message', () => {
		const error = { code: 'P0001', message: 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS' };

		expect(isEmailAlreadyAssociatedWithOtherBusinessError(error)).toBe(true);
		expect(businessEmailAssociationErrorMessage(error, 'No se pudo guardar el rol.')).toBe(
			EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS_MESSAGE
		);
		expect(businessEmailAssociationErrorStatus(error)).toBe(409);
	});

	it('preserves the context-specific fallback for unrelated failures', () => {
		expect(businessEmailAssociationErrorMessage({ message: 'network unavailable' }, 'Fallback')).toBe(
			'Fallback'
		);
		expect(businessEmailAssociationErrorStatus({ message: 'network unavailable' })).toBe(500);
	});
});
