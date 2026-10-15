<script lang="ts">
import Modal from '$lib/components/Modal.svelte';
import { CASE_STATUS } from '$lib/constants';
import { formatDate } from '$lib/utils/format';
import { goto } from '$app/navigation';
import { page } from '$app/stores';

type FormResult = {
	message?: string;
	person_name?: string;
	person_dni?: string;
	title?: string;
};

let { data, form } = $props<{ data: any; form: FormResult }>();
const normalize = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

	let search = $state('');
	let showCreate = $state($page.url.searchParams.has('nuevo'));

	$effect(() => {
		if ($page.url.searchParams.has('nuevo')) {
			showCreate = true;
		}
	});

	let filteredCases = $state<any[]>([]);

	$effect(() => {
		const term = normalize(search);
		const source = data.cases ?? [];
		if (!term) {
			filteredCases = source;
			return;
		}
		filteredCases = source.filter((c: any) => {
			const title = normalize(c.title || '');
			const person = normalize(c.person_name || '');
			const dni = normalize(c.person_dni || '');
			return title.includes(term) || person.includes(term) || dni.includes(term);
		});
	});

	const closeModal = () => {
		showCreate = false;
		const url = new URL($page.url);
		url.searchParams.delete('nuevo');
		goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true });
	};
</script>

<section class="flex flex-col gap-4">
	<div class="flex flex-col gap-3 rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between dark:border-[#1f3554] dark:bg-[#122641]">
		<div class="space-y-1">
			<p class="text-xs font-semibold uppercase tracking-[0.25em] text-primary-500 dark:text-primary-300">Expedientes</p>
			<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Seguimiento ágil</h1>
			<p class="text-sm text-neutral-600 dark:text-neutral-200">Búsqueda por persona o carátula. Acción principal: nuevo movimiento.</p>
		</div>
		<button
			class="rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
			onclick={() => (showCreate = true)}
		>
			+ Nuevo expediente
		</button>
	</div>

	<div class="flex flex-col gap-3 rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between dark:border-[#1f3554] dark:bg-[#122641]">
		<div class="w-full md:w-auto md:flex-1">
			<label class="sr-only" for="q">Buscar</label>
			<div class="relative">
				<input
					id="q"
					type="search"
					placeholder="Escribí para filtrar por persona, DNI/CUIL o carátula"
					value={search}
					oninput={(event) => (search = (event.currentTarget as HTMLInputElement).value)}
					class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-[#eaf1ff] dark:focus:border-primary-400 dark:focus:ring-primary-800"
				/>
			</div>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">Filtra mientras escribís; sin distinguir mayúsculas ni acentos.</p>
		</div>
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<a
				href="/administrativo/expedientes"
				class={`rounded-full px-3 py-2 font-semibold ${
					data.statusFilter === 'todos'
						? 'bg-primary-50 text-primary-700'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
			>
				Todos
			</a>
			{#each data.statuses as status}
				<a
					href={`?estado=${encodeURIComponent(status)}`}
					class={`rounded-full px-3 py-2 font-semibold ${
						data.statusFilter === status
							? 'bg-primary-50 text-primary-700'
							: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
					}`}
				>
					{status}
				</a>
			{/each}
		</div>
	</div>

	<div class="grid gap-3">
		{#if filteredCases.length === 0}
			<div class="rounded-2xl border border-dashed border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm dark:border-[#1f3554] dark:bg-[#122641] dark:text-[#c8d4e8]">
				No hay expedientes con ese filtro.
			</div>
		{:else}
			{#each filteredCases as caseItem}
				<a
					class="flex items-center justify-between gap-3 rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card dark:border-[#1f3554] dark:bg-[#122641] dark:text-[#eaf1ff]"
					href={`/administrativo/expedientes/${caseItem.id}`}
				>
					<div>
						<p class="text-lg font-semibold text-neutral-900 dark:text-white">{caseItem.title}</p>
						<p class="text-sm text-neutral-600 dark:text-neutral-200">
							{caseItem.person_name}
							{caseItem.person_dni ? ` • DNI/CUIL ${caseItem.person_dni}` : ''}
						</p>
					</div>
					<div class="text-right text-sm text-neutral-600 dark:text-neutral-200">
						<p class="font-semibold text-primary-700 dark:text-primary-300">{caseItem.status}</p>
						<p class="text-xs dark:text-neutral-300">
							Última act.: {caseItem.updated_at ? formatDate(caseItem.updated_at) : '—'}
							{caseItem.next_action ? ` • Próx: ${caseItem.next_action}` : ''}
						</p>
					</div>
				</a>
			{/each}
		{/if}
	</div>
</section>

<Modal open={showCreate} title="Alta rápida de expediente" on:close={closeModal}>
	<form method="post" class="space-y-4">
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="person_name">Persona *</label>
				<input
					id="person_name"
					name="person_name"
					required
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
					placeholder="Nombre y apellido"
					value={form?.person_name ?? ''}
				/>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="person_dni">DNI / CUIL</label>
				<input
					id="person_dni"
					name="person_dni"
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
					placeholder="Solo números"
					value={form?.person_dni ?? ''}
				/>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="person_phone">Teléfono</label>
				<input
					id="person_phone"
					name="person_phone"
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
					placeholder="Opcional"
				/>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="person_email">Correo electrónico</label>
				<input
					id="person_email"
					name="person_email"
					type="email"
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
					placeholder="Opcional"
				/>
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800" for="title">Carátula / título *</label>
			<input
				id="title"
				name="title"
				required
				class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
				placeholder="Ej: Jubilación / Asignación"
				value={form?.title ?? ''}
			/>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="status">Estado</label>
				<select
					id="status"
					name="status"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
				>
					{#each CASE_STATUS as status}
						<option value={status}>{status}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800" for="next_action">Próxima acción</label>
				<input
					id="next_action"
					name="next_action"
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
					placeholder="Ej: Enviar documentación"
				/>
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800" for="next_action_date">Fecha objetivo</label>
			<input
				id="next_action_date"
				name="next_action_date"
				type="date"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
			/>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<div class="flex items-center justify-end gap-2">
			<button
				type="button"
				onclick={closeModal}
				class="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
			>
				Crear expediente
			</button>
		</div>
	</form>
</Modal>
