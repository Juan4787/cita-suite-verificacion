<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import DateTimePartsInput from '$lib/components/DateTimePartsInput.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import { CASE_EVENT_TYPES, CASE_STATUS } from '$lib/constants';
	import { formatDate, formatDateTime } from '$lib/utils/format';

let { data, form } = $props<{
	data: { caseFile: any; person: any; events: any[]; statuses: typeof CASE_STATUS; eventTypes: typeof CASE_EVENT_TYPES };
	form: { message?: string };
}>();

let showEventModal = $state(false);
let showEditModal = $state(false);
let showEventErrors = $state(false);
let showEditErrors = $state(false);

const preventEnterSubmit = (event: KeyboardEvent) => {
	if (event.key !== 'Enter') return;
	const target = event.target as HTMLElement | null;
	if (target instanceof HTMLTextAreaElement) return;
	event.preventDefault();
};

const handleEventSubmit = (event: SubmitEvent) => {
	showEventErrors = true;
	const formEl = event.currentTarget as HTMLFormElement;
	const hidden = formEl.querySelector<HTMLInputElement>('input[name="created_at"]');
	if (!hidden || !hidden.value || hidden.value === '__invalid__') {
		event.preventDefault();
	}
};

const handleEditSubmit = (event: SubmitEvent) => {
	showEditErrors = true;
	const formEl = event.currentTarget as HTMLFormElement;
	// No custom parts here (date native), so rely on form validity. Keeping hook for symmetry if we add parts later.
	if (!formEl.checkValidity()) {
		event.preventDefault();
	}
};
</script>

<div class="flex flex-col gap-4">
	<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
		<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div>
				<p class="text-xs font-semibold uppercase tracking-[0.25em] text-primary-500 dark:text-primary-300">Expediente</p>
				<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">{data.caseFile.title}</h1>
				<p class="text-sm text-neutral-600 dark:text-neutral-200">
					{data.caseFile.person_name}
					{data.caseFile.person_dni ? ` • DNI/CUIL ${data.caseFile.person_dni}` : ''}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<a
					href="/administrativo/expedientes"
					class="rounded-2xl border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 hover:shadow-card dark:border-[#1f3554] dark:text-[#eaf1ff] dark:hover:bg-[#122641]"
				>
					← Atrás
				</a>
				<form method="post" action="?/archive_case" class="contents">
					<button
						type="submit"
						class="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-[#eaf1ff] dark:hover:bg-[#0f1f36]"
						onclick={(event: MouseEvent) => {
							event.preventDefault();
							if (confirm('¿Cerrar/archivar este expediente?')) {
								(event.target as HTMLButtonElement).closest('form')?.submit();
							}
						}}
					>
						Archivar
					</button>
				</form>
				<button
					class="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 dark:text-[#eaf1ff] dark:hover:bg-[#0f1f36]"
					type="button"
					onclick={() => (showEditModal = true)}
				>
					Editar
				</button>
				<button
					class="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
					type="button"
					onclick={() => (showEventModal = true)}
				>
					+ Nuevo movimiento
				</button>
			</div>
		</div>
		<div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
			<span class="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-[#0f1f36] dark:text-primary-200">{data.caseFile.status}</span>
			{#if data.caseFile.next_action}
				<span class="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700 dark:bg-[#0f1f36] dark:text-neutral-200">
					Próxima acción: {data.caseFile.next_action}
					{data.caseFile.next_action_date ? ` • ${formatDate(data.caseFile.next_action_date)}` : ''}
				</span>
			{/if}
		</div>
	</div>

	<div class="grid gap-4 lg:grid-cols-[2fr,1fr]">
		<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Timeline</h2>
				<p class="text-sm text-neutral-600 dark:text-neutral-200">Nuevo movimiento en 1 click.</p>
			</div>
			<div class="mt-4">
				{#if data.events.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-200">
						Sin movimientos aún.
					</p>
				{:else}
					<Timeline
						items={data.events.map((event: any) => ({
							id: event.id,
							title: event.event_type,
							description: event.detail,
							meta: formatDateTime(event.created_at),
							badge: event.event_type
						}))}
					/>
				{/if}
			</div>
		</div>

		<div class="space-y-4">
			<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
				<h3 class="text-base font-semibold text-neutral-900 dark:text-white">Persona</h3>
				<div class="mt-3 space-y-1 text-sm text-neutral-600 dark:text-neutral-200">
					<p class="font-semibold text-neutral-800 dark:text-neutral-100">{data.person?.full_name ?? data.caseFile.person_name}</p>
					<p>{data.person?.dni ?? data.caseFile.person_dni ?? 'Sin DNI/CUIL'}</p>
					<p>{data.person?.phone ?? 'Sin teléfono'}</p>
					<p>{data.person?.email ?? 'Sin correo electrónico'}</p>
				</div>
			</div>
			<div class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#122641]">
				<h3 class="text-base font-semibold text-neutral-900 dark:text-white">Notas internas</h3>
				<p class="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-200">
					{data.caseFile.notes ?? 'Agregá notas desde "Editar".'}
				</p>
				<p class="mt-3 text-xs text-neutral-500 dark:text-neutral-300">
					Creado: {formatDate(data.caseFile.created_at)} • Última actualización:
					{formatDateTime(data.caseFile.updated_at)}
				</p>
			</div>
		</div>
	</div>
</div>

<Modal open={showEventModal} title="Nuevo movimiento" on:close={() => (showEventModal = false)}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action="?/add_event" class="space-y-3" onkeydown={preventEnterSubmit} onsubmit={handleEventSubmit}>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="event_type">Tipo</label>
				<select
					id="event_type"
					name="event_type"
					required
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
				>
					<option value="">Seleccionar</option>
					{#each data.eventTypes as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="created_at-year">Fecha y hora</label>
				<DateTimePartsInput name="created_at" minYear={2000} maxYear={2045} showErrors={showEventErrors} />
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800" for="detail">Detalle</label>
			<textarea
				id="detail"
				name="detail"
				required
				rows="4"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
				placeholder="Qué pasó, con quién, resultado..."
			></textarea>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<div class="flex items-center justify-end gap-2">
			<button
				type="button"
				onclick={() => (showEventModal = false)}
				class="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
			>
				Guardar
			</button>
		</div>
	</form>
</Modal>

<Modal open={showEditModal} title="Editar expediente" on:close={() => (showEditModal = false)}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action="?/update_case" class="space-y-3" onkeydown={preventEnterSubmit} onsubmit={handleEditSubmit}>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800" for="status">Estado</label>
			<select
				id="status"
				name="status"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
				bind:value={data.caseFile.status}
			>
				{#each CASE_STATUS as status}
					<option value={status}>{status}</option>
				{/each}
			</select>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="next_action">Próxima acción</label>
				<input
					id="next_action"
					name="next_action"
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
					value={data.caseFile.next_action ?? ''}
				/>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="next_action_date">Fecha objetivo</label>
				<input
					id="next_action_date"
					name="next_action_date"
					type="date"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
					value={data.caseFile.next_action_date ?? ''}
				/>
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800" for="notes">Notas internas</label>
			<textarea
				id="notes"
				name="notes"
				rows="3"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
			>{data.caseFile.notes ?? ''}</textarea>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<div class="flex items-center justify-end gap-2">
			<button
				type="button"
				class="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
				onclick={() => (showEditModal = false)}
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
			>
				Guardar cambios
			</button>
		</div>
	</form>
</Modal>
