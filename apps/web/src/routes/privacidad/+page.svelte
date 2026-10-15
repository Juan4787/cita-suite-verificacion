<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
</script>

<svelte:head>
	<title>Política de privacidad</title>
</svelte:head>

<div class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-[#eaf1ff]">
	<main class="mx-auto max-w-3xl px-4 py-10">
		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-8">
			<BackLink href="/login" label="Volver al ingreso" />
			<h1 class="mt-2 text-2xl font-semibold">Política de privacidad</h1>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
				Última actualización: 2026-08-28
			</p>

			<section class="mt-6 space-y-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
				<p>
					Esta política describe cómo se recopila, usa y protege la información dentro de la app
					“Cita Suite”. Si no estás de acuerdo, no uses el servicio.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Datos que recopilamos</h2>
				<ul class="mt-2 list-disc space-y-2 pl-5 text-sm text-neutral-700 dark:text-neutral-200">
					<li>Datos de cuenta: correo electrónico y credenciales de acceso.</li>
					<li>Datos de pacientes cargados por el usuario (nombre, DNI, teléfono, etc.).</li>
					<li>Historial clínico y notas registradas por el usuario.</li>
					<li>Radiografías e imágenes clínicas, sus miniaturas y metadatos asociados (nombre, fecha, tipo, tamaño, estado e identificadores técnicos).</li>
					<li>Datos técnicos mínimos para el funcionamiento (cookies de sesión y preferencias de tema).</li>
				</ul>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Cómo usamos los datos</h2>
				<ul class="mt-2 list-disc space-y-2 pl-5 text-sm text-neutral-700 dark:text-neutral-200">
					<li>Proveer el servicio de gestión de pacientes y consultas.</li>
					<li>Guardar imágenes clínicas, asociarlas a pacientes y mostrarlas únicamente a usuarios autorizados.</li>
					<li>Registrar acciones relevantes, como cargas, accesos a originales, envíos a la papelera y restauraciones.</li>
					<li>Preparar exportaciones Excel solicitadas por el dueño o un administrador autorizado.</li>
					<li>Mejorar estabilidad y soporte técnico.</li>
				</ul>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Google Calendar</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Si el paciente elige guardar su turno con avisos, la app solicita el alcance
					<span class="font-semibold">calendar.events.owned</span>. Google describe este permiso
					como la posibilidad de ver, crear, cambiar y borrar eventos en calendarios propios de la
					cuenta. Cita Suite limita su uso a crear y operar los eventos vinculados a turnos que la
					propia app generó; no enumera ni sincroniza los demás eventos del usuario.
				</p>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Se conserva un identificador técnico de la cuenta, el vínculo entre el turno y el evento,
					y una autorización cifrada para mantener la fecha y la hora actualizadas sin pedir una
					nueva acción en cada reprogramación. El evento usa texto neutral y no incluye el nombre
					del paciente ni el servicio reservado. El paciente puede quitar el evento desde la página
					del turno o revocar el acceso desde su cuenta de Google.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Proveedores y almacenamiento</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Los datos del sistema y las imágenes clínicas se alojan mediante infraestructura de Supabase y otros
					proveedores técnicos necesarios para operar Cita Suite. Las imágenes se guardan en un contenedor privado;
					el navegador recibe accesos temporales y específicos sólo después de que Cita Suite verifica el permiso
					del usuario sobre el paciente.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Seguridad</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Aplicamos medidas razonables de seguridad: autenticación, separación por consultorio, permisos por rol y
					vínculo clínico, políticas de acceso en la base de datos, enlaces temporales y transmisión segura. Aun así,
					ningún sistema es completamente infalible.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Exportaciones solicitadas</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					El dueño o un administrador con membresía directa pueden solicitar un Excel con datos tabulares de
					pacientes, ficha clínica, campos personalizados, historial, turnos y seguimientos. Cita Suite verifica
					los permisos y la pertenencia al consultorio antes de entregar los datos; el archivo se construye en
					el navegador del usuario y la operación puede quedar registrada con datos técnicos de auditoría.
				</p>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					La exportación no incluye radiografías, imágenes, PDF ni adjuntos, y no es una copia de seguridad
					restaurable. Una vez descargado el archivo, quien lo solicitó es responsable de protegerlo porque
					puede contener datos personales y sensibles.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Retención, papelera y recuperación</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Las imágenes enviadas a la papelera dejan de mostrarse en la ficha, pero el archivo y sus metadatos se
					conservan para que el dueño o un administrador puedan restaurarlos. La versión actual no ofrece borrado
					físico de imágenes clínicas desde Cita Suite, vaciado de papelera, exportación de esos archivos ni una copia de
					respaldo externa dedicada. Por ese motivo no se garantiza la recuperación frente a una pérdida física o
					corrupción completa de la infraestructura de almacenamiento.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Responsabilidad del usuario</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					El usuario es responsable de contar con el consentimiento y base legal necesarios para
					cargar datos de pacientes. La app es una herramienta de gestión y no reemplaza el
					cumplimiento normativo aplicable.
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Contacto</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Para consultas sobre privacidad escribí a:
					<span class="font-semibold">juanpabloaltamira@protonmail.com</span>
				</p>
			</section>

			<section class="mt-6 space-y-3">
				<h2 class="text-lg font-semibold">Cambios</h2>
				<p class="text-sm text-neutral-700 dark:text-neutral-200">
					Podemos actualizar esta política. Publicaremos cualquier cambio en esta misma página.
				</p>
			</section>
		</div>
	</main>
</div>
