import type { Action } from 'svelte/action';

// Persistencia temporal de borradores de formularios (sessionStorage).
//
// Mientras el usuario completa un formulario y navega a otra sección sin guardar,
// lo escrito/marcado se conserva y se restaura al volver. Se borra al cerrar la
// pestaña o cuando el guardado tiene éxito (llamando a `clearDraft`).
//
// Uso:
//   <form use:persistDraft={'mi-form:' + id} use:enhance={...}>
// y en el callback de enhance, al tener éxito: clearDraft('mi-form:' + id)

const PREFIX = 'draft:';
const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'file', 'password', 'hidden']);

type FormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const fieldsOf = (form: HTMLFormElement): FormField[] =>
	Array.from(form.elements).filter(
		(el): el is FormField =>
			(el instanceof HTMLInputElement ||
				el instanceof HTMLTextAreaElement ||
				el instanceof HTMLSelectElement) &&
			Boolean(el.name) &&
			!SKIP_TYPES.has((el as HTMLInputElement).type)
	);

export const clearDraft = (key: string) => {
	try {
		sessionStorage.removeItem(PREFIX + key);
	} catch {
		/* sessionStorage no disponible */
	}
};

export const persistDraft: Action<HTMLFormElement, string | undefined> = (form, key) => {
	let storageKey = PREFIX + (key || form.getAttribute('action') || location.pathname);

	const save = () => {
		const data: Record<string, unknown> = {};
		for (const field of fieldsOf(form)) {
			if (field instanceof HTMLInputElement && field.type === 'checkbox') {
				data[field.name] = field.checked;
			} else if (field instanceof HTMLInputElement && field.type === 'radio') {
				if (field.checked) data[field.name] = field.value;
			} else {
				data[field.name] = field.value;
			}
		}
		try {
			sessionStorage.setItem(storageKey, JSON.stringify(data));
		} catch {
			/* cuota / no disponible */
		}
	};

	const restore = () => {
		let saved: Record<string, unknown> | null = null;
		try {
			const raw = sessionStorage.getItem(storageKey);
			saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
		} catch {
			saved = null;
		}
		if (!saved) return;

		for (const field of fieldsOf(form)) {
			if (!(field.name in saved)) continue;
			const value = saved[field.name];

			if (field instanceof HTMLInputElement && field.type === 'checkbox') {
				field.checked = Boolean(value);
				field.dispatchEvent(new Event('change', { bubbles: true }));
			} else if (field instanceof HTMLInputElement && field.type === 'radio') {
				if (field.value === value) {
					field.checked = true;
					field.dispatchEvent(new Event('change', { bubbles: true }));
				}
			} else if (typeof value === 'string') {
				field.value = value;
				field.dispatchEvent(new Event('input', { bubbles: true }));
			}
		}
	};

	// Restaurar antes de escuchar, para no re-guardar durante la restauración.
	restore();
	form.addEventListener('input', save);
	form.addEventListener('change', save);

	return {
		update(newKey: string | undefined) {
			if (newKey) storageKey = PREFIX + newKey;
		},
		destroy() {
			form.removeEventListener('input', save);
			form.removeEventListener('change', save);
		}
	};
};
