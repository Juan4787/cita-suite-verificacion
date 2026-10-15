import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// La vista principal Profesionales fue reemplazada por Equipo.
// Los profesionales se gestionan desde Equipo > Profesionales > Ver profesional.
export const load: PageServerLoad = async () => {
	throw redirect(303, '/odonto/configuracion/usuarios');
};
