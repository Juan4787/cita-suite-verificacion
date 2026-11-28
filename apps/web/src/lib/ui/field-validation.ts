// The browser still decides what is valid and still blocks the submit. Only its bubble is replaced:
// the browser draws it in its own language and look, outside the page. Without JavaScript the
// bubble stays, and the styled selects and calendars keep their own message.
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isField = (target: EventTarget | null): target is Field =>
	target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

export const fieldValidationMessage = (field: Field) => {
	const { validity } = field;
	if (validity.customError) return field.validationMessage;
	const type = field instanceof HTMLSelectElement ? 'select' : field.type;
	if (validity.valueMissing) {
		if (type === 'checkbox') return 'Marcá esta casilla para continuar.';
		if (type === 'radio' || type === 'select') return 'Elegí una opción para continuar.';
		if (type === 'file') return 'Elegí un archivo para continuar.';
		return 'Completá este dato para continuar.';
	}
	if (validity.typeMismatch) {
		return type === 'email'
			? 'Revisá el correo: tiene que ser como nombre@ejemplo.com.'
			: 'Revisá el enlace: tiene que empezar con https://.';
	}
	if (validity.patternMismatch) return field.dataset.invalidMessage ?? 'Revisá el formato de este dato.';
	if (validity.tooShort) return `Escribí al menos ${(field as HTMLInputElement).minLength} caracteres.`;
	if (validity.tooLong) return `Escribí como máximo ${(field as HTMLInputElement).maxLength} caracteres.`;
	if (validity.rangeUnderflow) return `El mínimo es ${(field as HTMLInputElement).min}.`;
	if (validity.rangeOverflow) return `El máximo es ${(field as HTMLInputElement).max}.`;
	if (validity.badInput || validity.stepMismatch) return 'Revisá el valor: no es válido para este dato.';
	return 'Revisá este dato para continuar.';
};

export function installFieldValidation(root: Document = document) {
	const shown = new Map<Field, HTMLElement>();
	let nextId = 0;
	const hide = (field: Field) => {
		const message = shown.get(field);
		if (!message) return;
		const described = (field.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== message.id);
		if (described.length) field.setAttribute('aria-describedby', described.join(' '));
		else field.removeAttribute('aria-describedby');
		field.removeAttribute('aria-invalid');
		message.remove();
		shown.delete(field);
	};
	const show = (field: Field) => {
		let message = shown.get(field);
		if (!message) {
			message = root.createElement('span');
			message.className = 'ux-control-error';
			message.id = `ux-field-error-${++nextId}`;
			// A box or a hidden file input lives inside a row: the message goes under the whole row.
			const inline = field instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(field.type);
			(inline ? (field.closest('label') ?? field) : field).after(message);
			field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' '));
			shown.set(field, message);
		}
		message.textContent = fieldValidationMessage(field);
		field.setAttribute('aria-invalid', 'true');
	};
	const refresh = () => {
		for (const field of [...shown.keys()]) if (!field.isConnected || field.validity.valid) hide(field);
	};
	const onInvalid = (event: Event) => {
		const field = event.target;
		if (!isField(field) || field.classList.contains('ux-native-source')) return;
		if (field.validity.valueMissing && field.dataset.missingErrorHandled === 'true') {
			event.preventDefault();
			const first = [...(field.form?.elements ?? [])].find((element) => isField(element) && !element.validity.valid);
			if (!first || first === field) field.focus();
			return;
		}
		event.preventDefault();
		show(field);
		const first = [...(field.form?.elements ?? [])].find((element) => isField(element) && !element.validity.valid);
		if (!first || first === field) field.focus();
	};
	root.addEventListener('invalid', onInvalid, true);
	root.addEventListener('input', refresh, true);
	root.addEventListener('change', refresh, true);
	root.addEventListener('focusin', refresh, true);
	return () => {
		root.removeEventListener('invalid', onInvalid, true);
		root.removeEventListener('input', refresh, true);
		root.removeEventListener('change', refresh, true);
		root.removeEventListener('focusin', refresh, true);
		for (const field of [...shown.keys()]) hide(field);
	};
}
