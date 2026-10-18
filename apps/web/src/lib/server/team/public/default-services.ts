export const DEFAULT_SERVICE_NAMES = ['Consulta', 'Otro servicio'] as const;
export const DEFAULT_SERVICE_DURATION_MINUTES = 30;

export const isDefaultServiceName = (name: string | null | undefined) =>
	DEFAULT_SERVICE_NAMES.some(
		(defaultName) =>
			defaultName.toLowerCase() ===
			String(name ?? '')
				.trim()
				.toLowerCase()
	);
