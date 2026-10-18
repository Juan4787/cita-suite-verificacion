<script lang="ts">
	import { enhance } from '$app/forms';
	import { onDestroy, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PatientHistoryEntry } from '$lib/patients/contracts';
	import type { BusinessIndustry } from '$lib/access/contracts';
	import Modal from '$lib/components/Modal.svelte';
	import DateTimePartsInput from '$lib/components/DateTimePartsInput.svelte';
	import { CLINICAL_ENTRY_TYPES } from '$lib/constants';
	import { clinicalAmountForEdit, clinicalAmountFromDisplay } from '$lib/patients/clinical-amount';
	import { formatMoneyInteger, moneyDigits } from '$lib/utils/money-input';
	let {
		open = $bindable(false),
		patient,
		scope,
		entry = null,
		canViewCosts,
		isProfessional,
		timeZone,
		industry,
		errorMessage,
		onCreated,
		onCommitted
	}: {
		open: boolean;
		patient: { id: string; full_name: string };
		scope: string;
		entry?: PatientHistoryEntry | null;
		canViewCosts: boolean;
		isProfessional: boolean;
		timeZone?: string;
		industry?: BusinessIndustry;
		errorMessage?: string;
		onCreated: (value: unknown) => boolean;
		onCommitted: () => void;
	} = $props();
	let entryType = $state(untrack(() => entry?.entry_type ?? ''));
	let description = $state(untrack(() => entry?.description ?? ''));
	let teeth = $state(untrack(() => entry?.teeth ?? ''));
	let note = $state(untrack(() => entry?.internal_note ?? ''));
	let amountDisplay = $state(untrack(() => clinicalAmountForEdit(entry?.amount).display));
	let amountRaw = $state(untrack(() => clinicalAmountForEdit(entry?.amount).raw));
	let showErrors = $state(false),
		saving = $state(false),
		uncertain = $state(false);
	let seed: string | null = null;
	let activePatient = untrack(() => patient.id),
		activeScope = untrack(() => scope);
	let destroyed = false;
	const prefix = $derived(entry ? 'edit_' : '');
	$effect(() => {
		const nextPatient = patient.id,
			nextScope = scope;
		if (nextPatient !== activePatient || nextScope !== activeScope) {
			activePatient = nextPatient;
			activeScope = nextScope;
			open = false;
			seed = null;
			uncertain = false;
			saving = false;
			return;
		}
		if (!open) {
			seed = null;
			return;
		}
		const key = `${nextPatient}:${nextScope}:${entry?.id ?? 'new'}`;
		if (seed === key) return;
		seed = key;
		entryType = entry?.entry_type ?? '';
		description = entry?.description ?? '';
		teeth = entry?.teeth ?? '';
		note = entry?.internal_note ?? '';
		const amount = clinicalAmountForEdit(entry?.amount);
		amountDisplay = amount.display;
		amountRaw = amount.raw;
		showErrors = false;
		saving = false;
	});
	onDestroy(() => {
		destroyed = true;
	});
	function validateDate(event: SubmitEvent) {
		showErrors = true;
		const form = event.currentTarget;
		if (!(form instanceof HTMLFormElement)) return;
		const hidden = form.querySelector<HTMLInputElement>('[name="created_at"]');
		if (!hidden?.value || hidden.value === '__invalid__') event.preventDefault();
	}
	const submit: SubmitFunction<{ savedEntry?: unknown }, { message?: string }> = ({
		cancel,
		formElement
	}) => {
		showErrors = true;
		const hidden = formElement.querySelector<HTMLInputElement>('[name="created_at"]');
		if (saving || uncertain || !hidden?.value || hidden.value === '__invalid__') {
			cancel();
			return;
		}
		const requestedPatient = patient.id,
			requestedScope = scope;
		const isCurrent = () => !destroyed && requestedPatient === patient.id && requestedScope === scope;
		saving = true;
		return async ({ update, result }) => {
			if (!isCurrent()) return;
			try {
				if (result.type === 'success') {
					const merged = onCreated(result.data?.savedEntry);
					open = false;
					await update(merged ? { invalidateAll: false } : undefined);
					return;
				}
				if (result.type === 'redirect') {
					onCommitted();
					open = false;
					await update();
					return;
				}
				if (result.type === 'error') {
					uncertain = true;
					return;
				}
				await update({ reset: false });
			} finally {
				if (isCurrent()) saving = false;
			}
		};
	};
	function enhanceCreation(node: HTMLFormElement) {
		// Editing keeps its native POST/redirect contract. Creation retains the
		// validated saved-entry merge and reload fallback already used by the page.
		if (!entry) return enhance(node, submit);
	}
	function handleAmountChange(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		if (entry) {
			const state = clinicalAmountFromDisplay(input.value);
			input.setCustomValidity(
				state.valid ? '' : 'Revisá el importe. Usá una coma para los decimales.'
			);
			amountRaw = state.raw;
			amountDisplay = state.display;
		} else {
			amountRaw = moneyDigits(input.value);
			amountDisplay = formatMoneyInteger(amountRaw);
		}
		input.value = amountDisplay;
	}
	function preventEnterSubmit(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		const target = event.target;
		if (
			!(target instanceof HTMLElement) ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'BUTTON'
		)
			return;
		event.preventDefault();
	}
</script>

<Modal {open} title={entry ? 'Editar entrada' : `Registrar consulta - ${patient.full_name}`} on:close={() => { if (!saving) open = false; }}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action={entry ? "?/update_entry" : "?/add_entry"} class="space-y-4" onkeydown={preventEnterSubmit} onsubmit={validateDate} use:enhanceCreation aria-busy={saving}>
		<input type="hidden" name="amount_format" value="canonical" />
		<input type="hidden" name="entry_id" value={entry?.id ?? ''} />
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for={`${prefix}entry_type`}>Tipo de consulta</label>
				<select
					id={`${prefix}entry_type`}
					name="entry_type"
					required
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={entryType}
				>
					<option value="">Seleccionar</option>
					{#if entry && !CLINICAL_ENTRY_TYPES.some(type => type === entryType)}<option value={entryType}>{entryType}</option>{/if}
					{#each CLINICAL_ENTRY_TYPES as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="created_at-year">Fecha y hora</label>
				<DateTimePartsInput name="created_at" readOnly={isProfessional} timeZone={timeZone} minYear={2000} maxYear={2045} initialValue={entry?.created_at} showErrors={showErrors} />
				{#if isProfessional}<p class="text-xs text-neutral-600 dark:text-neutral-300">{entry ? 'La fecha y hora de registro se conservan.' : 'La fecha y hora se registrarán al guardar.'}</p>{/if}
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800 dark:text-white" for={`${prefix}description`}>Descripción</label>
			<textarea
				id={`${prefix}description`}
				name="description"
				required
				rows="4"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				bind:value={description}
				placeholder="Motivo de consulta, hallazgos, indicaciones..."
			></textarea>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for={`${prefix}teeth`}>{industry && industry!=='odontology'?'Zona / referencia (opcional)':'Dientes / zona (opcional)'}</label>
				<input
					id={`${prefix}teeth`}
					name="teeth"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={teeth}
					placeholder="Ej: 11-12"
				/>
			</div>
			{#if canViewCosts}
				<div class="space-y-2">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for={`${prefix}amount`}>Importe (opcional)</label>
					<input type="hidden" name="amount" value={amountRaw} />
					<input
						id={`${prefix}amount`}
						name="amount_display"
						type="text"
						inputmode={entry ? "decimal" : "numeric"}
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						value={amountDisplay}
						oninput={handleAmountChange}
						placeholder="Ej: 18.000"
					/>
				</div>
			{/if}
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for={`${prefix}internal_note`}>Nota interna (opcional)</label>
				<input
					id={`${prefix}internal_note`}
					name="internal_note"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={note}
					placeholder="Ej: recordar control"
				/>
			</div>
		</div>
		{#if errorMessage}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{errorMessage}</p>
		{/if}
		{#if uncertain}<p class="text-sm text-neutral-700 dark:text-neutral-200" role="alert">No pudimos confirmar si se guardó la consulta. Revisá el historial antes de volver a guardarla. <a class="font-semibold underline" href={`/odonto/pacientes/${patient.id}`}>Revisar historial</a></p>{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				onclick={() => (open = false)} disabled={saving}
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
			>
				Cancelar
			</button>
			<button
				type="submit"
				disabled={saving || uncertain}
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
			>
				{saving ? 'Guardando…' : entry ? 'Guardar cambios' : 'Guardar'}
			</button>
		</div>
	</form>
</Modal>
