<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { styledDate, styledSelect } from '$lib/ui/styled-controls';
	import { formatDate, formatDateTime, formatInTimeZone } from '$lib/utils/format';
	import {
		normalizeTimeRangesForCommit,
		normalizeTimeRangesInput,
		parseTimeRanges
	} from '$lib/utils/time-ranges';
	import {
		createEmptyScheduleBlock,
		serializeScheduleBlocks,
		validateScheduleBlocks,
		type ScheduleBlockDraft
	} from '$lib/utils/schedule-blocks';
	import {
		hasProfessionalExceptionDraft as hasExceptionDraft,
		type ProfessionalDraft,
		type ProfessionalEditorData,
		type ProfessionalEditorException as Exception,
		type ProfessionalEditorService as Service,
		type ProfessionalEditorSaving,
		type ProfessionalDirtyFields
	} from '$lib/team/professional-editor';
	let {
		active,
		availabilityRevision,
		data,
		draft = $bindable(),
		baseline,
		dirtyFields,
		missingItems,
		canOperate,
		saving,
		acknowledgedAppointments = $bindable(),
		scheduleTimeEditing = $bindable(),
		sectionEnhance,
		refreshEnhance,
		form
	}: {
		active: boolean;
		availabilityRevision: number;
		data: ProfessionalEditorData;
		draft: ProfessionalDraft;
		baseline: ProfessionalDraft;
		dirtyFields: ProfessionalDirtyFields;
		missingItems: string[];
		canOperate: boolean;
		saving: ProfessionalEditorSaving;
		acknowledgedAppointments: boolean;
		scheduleTimeEditing: boolean;
		sectionEnhance: (section: 'profile' | 'services' | 'schedule' | 'exception') => SubmitFunction;
		refreshEnhance: SubmitFunction;
		form?: { exceptionConflict?: boolean };
	} = $props();
	let scheduleError = $state('');
	let scheduleBlockSeq = 100;
	const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	const professional = $derived(data.professional);
	const businessTimeZone = $derived(data.context.business.timezone);
	const defaultServiceIdSet = $derived(new Set(data.defaultServiceIds));
	const normalizedText = (value: string) => value.trim();
	const uniqueSortedNumbers = (items: number[]) => [...new Set(items)].sort((a, b) => a - b);
	const scheduleBlocksJson = $derived(serializeScheduleBlocks(draft.schedule.blocks));
	const fieldStateClass = (dirty: boolean, missing = false) =>
		missing ? 'ux-state-required' : dirty ? 'ux-state-unsaved' : '';
	const sectionStateClass = fieldStateClass;
	const restrictionLabel = (ids: string[]) =>
		ids.length
			? ids
					.map((id) => {
						const service = data.services.find((item) => item.id === id);
						return service
							? service.name + (service.is_active ? '' : ' (no disponible)')
							: 'Prestación no disponible';
					})
					.join(', ')
			: 'Franja cerrada';
	const scheduleHasAnyDay = $derived(
		draft.schedule.blocks.some((block) => block.weekdays.length > 0)
	);
	const scheduleCanSave = $derived(validateScheduleBlocks(draft.schedule.blocks).ok);
	const exceptionErrorFor = (exception: ProfessionalDraft['exception']) => {
		if (!hasExceptionDraft(exception)) return '';
		if (exception.periodMode === 'multiple')
			return exception.dates?.length ? '' : 'Agregá al menos una fecha.';
		if (exception.periodMode === 'range') {
			if (!exception.dateFrom.trim() || !exception.dateTo.trim()) {
				return 'Completá las fechas Desde y Hasta.';
			}
			if (exception.dateTo < exception.dateFrom) {
				return 'La fecha Hasta no puede ser anterior a Desde.';
			}
			return '';
		}
		if (!exception.date.trim() || !exception.timeRange.trim()) {
			return 'Completá la fecha y el horario.';
		}
		const ranges = parseTimeRanges(exception.timeRange);
		return !ranges || ranges.length !== 1 ? 'Ingresá una sola franja horaria válida.' : '';
	};
	const exceptionValidationMessage = $derived(exceptionErrorFor(draft.exception));
	const exceptionCanSave = $derived(dirtyFields.exception && !exceptionValidationMessage);
	const schedulePreview = (block: ScheduleBlockDraft) => parseTimeRanges(block.timeRanges) ?? [];
	const sameNumberList = (left: number[], right: number[]) =>
		uniqueSortedNumbers(left).join('|') === uniqueSortedNumbers(right).join('|');

	const baselineBlockFor = (block: ScheduleBlockDraft) =>
		baseline.schedule.blocks.find((saved) => saved.id === block.id) ?? null;

	const canonicalTimeRanges = (value: string) => {
		const parsed = parseTimeRanges(value);
		return parsed
			? parsed.map((range) => `${range.start}-${range.end}`).join(',')
			: normalizedText(value);
	};

	const scheduleBlockDaysDirty = (block: ScheduleBlockDraft) => {
		const saved = baselineBlockFor(block);
		if (!saved) return block.weekdays.length > 0;
		return !sameNumberList(block.weekdays, saved.weekdays);
	};

	const scheduleBlockTimeDirty = (block: ScheduleBlockDraft) => {
		const saved = baselineBlockFor(block);
		if (!saved) return normalizedText(block.timeRanges).length > 0;
		return canonicalTimeRanges(block.timeRanges) !== canonicalTimeRanges(saved.timeRanges);
	};

	const scheduleBlockIntervalDirty = (block: ScheduleBlockDraft) => {
		const saved = baselineBlockFor(block);
		if (!saved) return Number(block.slotInterval || 15) !== 15;
		return String(Number(block.slotInterval || 15)) !== String(Number(saved.slotInterval || 15));
	};

	const scheduleBlockTimeStatus = (block: ScheduleBlockDraft) => {
		const parsed = parseTimeRanges(block.timeRanges);
		if (!parsed || parsed.length === 0) {
			return normalizedText(block.timeRanges) ? 'Horario inválido' : 'Necesario para recibir turnos';
		}
		return scheduleBlockTimeDirty(block) ? 'Sin guardar' : '';
	};

	const scheduleBlockIntervalStatus = (block: ScheduleBlockDraft) => {
		const rawInterval = String(block.slotInterval ?? '').trim();
		const interval = rawInterval === '' ? Number.NaN : Number(rawInterval);
		if (!Number.isInteger(interval) || interval < 0) return 'Ingresá un entero desde 0';
		return scheduleBlockIntervalDirty(block) ? 'Sin guardar' : '';
	};

	const scheduleBlockDaysStatus = (block: ScheduleBlockDraft) => {
		if (block.weekdays.length === 0) return 'Elegí días';
		return scheduleBlockDaysDirty(block) ? 'Sin guardar' : '';
	};

	const scheduleBlockCardClass = (block: ScheduleBlockDraft) => {
		const hasProblem =
			block.weekdays.length === 0 ||
			!parseTimeRanges(block.timeRanges) ||
			Boolean(
				scheduleBlockIntervalStatus(block) && scheduleBlockIntervalStatus(block) !== 'Sin guardar'
			);
		if (hasProblem) return 'border-red-400/35';
		if (
			scheduleBlockDaysDirty(block) ||
			scheduleBlockTimeDirty(block) ||
			scheduleBlockIntervalDirty(block) ||
			!baselineBlockFor(block)
		) {
			return 'border-amber-300/35';
		}
		return '';
	};
	const usedWeekdays = (exceptBlockId = '') =>
		new Set(
			draft.schedule.blocks
				.filter((block) => block.id !== exceptBlockId)
				.flatMap((block) => block.weekdays)
		);

	const updateScheduleBlock = (blockId: string | undefined, patch: Partial<ScheduleBlockDraft>) => {
		draft.schedule.blocks = draft.schedule.blocks.map((block) =>
			block.id === blockId ? { ...block, ...patch } : block
		);
		scheduleError = '';
	};

	const toggleBlockWeekday = (blockId: string | undefined, weekday: number) => {
		const target = draft.schedule.blocks.find((block) => block.id === blockId);
		if (!target) return;
		const adding = !target.weekdays.includes(weekday);
		draft.schedule.blocks = draft.schedule.blocks.map((block) => {
			if (block.id === blockId) {
				return {
					...block,
					weekdays: adding
						? [...block.weekdays, weekday].sort((a, b) => a - b)
						: block.weekdays.filter((item) => item !== weekday)
				};
			}
			return block;
		});
		scheduleError = '';
	};

	const setBlockWeekdays = (blockId: string | undefined, items: number[]) => {
		const normalized = uniqueSortedNumbers(items);
		draft.schedule.blocks = draft.schedule.blocks.map((block) => {
			if (block.id === blockId) return { ...block, weekdays: normalized };
			return block;
		});
		scheduleError = '';
	};

	const addScheduleBlock = () => {
		const next = createEmptyScheduleBlock(`new-block-${scheduleBlockSeq++}`);
		draft.schedule.blocks = [...draft.schedule.blocks, next];
		scheduleError = '';
	};

	const removeScheduleBlock = (blockId: string | undefined) => {
		if (draft.schedule.blocks.length <= 1) {
			draft.schedule.blocks = [
				{ ...draft.schedule.blocks[0], weekdays: [], timeRanges: '', slotInterval: '15' }
			];
		} else {
			draft.schedule.blocks = draft.schedule.blocks.filter((block) => block.id !== blockId);
		}
		scheduleError = '';
	};

	const rulesByWeekday = $derived.by(() =>
		weekdays.map((day, weekday) => ({
			day,
			weekday,
			rules: data.rules.filter((rule) => rule.weekday === weekday)
		}))
	);

	const exceptionTarget = (item: Exception) =>
		item.professional_id ? (professional?.name ?? 'Profesional') : 'Todo el consultorio';
	const exceptionPeriodLabel = (item: Exception) => {
		const starts = formatInTimeZone(item.starts_at, businessTimeZone);
		const ends = formatInTimeZone(item.ends_at, businessTimeZone);
		const isMidnight = (value: string) => value === '00:00' || value === '24:00';
		const endMs = Date.parse(item.ends_at);
		if (isMidnight(starts.timeLabel) && isMidnight(ends.timeLabel) && Number.isFinite(endMs)) {
			const inclusiveEnd = new Date(endMs - 60_000);
			const startLabel = formatDate(item.starts_at, businessTimeZone);
			const endLabel = formatDate(inclusiveEnd.toISOString(), businessTimeZone);
			return startLabel === endLabel
				? `${startLabel} · Día completo`
				: `Del ${startLabel} al ${endLabel} · Días completos`;
		}
		return `${formatDateTime(item.starts_at, businessTimeZone)} - ${formatDateTime(item.ends_at, businessTimeZone)}`;
	};

	const commitScheduleBlockTimeRanges = (blockId: string | undefined) => {
		const block = draft.schedule.blocks.find((item) => item.id === blockId);
		if (!block) return false;
		const result = normalizeTimeRangesForCommit(block.timeRanges);
		if (!result.ok) {
			scheduleError = 'Horario inválido.';
			return false;
		}
		updateScheduleBlock(block.id, { timeRanges: result.value });
		return true;
	};
	const finishScheduleBlockTimeEdit = (blockId: string | undefined) => {
		commitScheduleBlockTimeRanges(blockId);
		scheduleTimeEditing = false;
	};

	export const normalizeScheduleBeforeSubmit = (event?: SubmitEvent) => {
		for (const block of draft.schedule.blocks) {
			if (!commitScheduleBlockTimeRanges(block.id)) {
				event?.preventDefault();
				return false;
			}
		}
		const result = validateScheduleBlocks(draft.schedule.blocks);
		if (!result.ok) {
			scheduleError = result.message;
			event?.preventDefault();
			return false;
		}
		scheduleError = '';
		if (!event) return true;
		const form = event.currentTarget as HTMLFormElement;
		const input = form.elements.namedItem('schedule_blocks') as HTMLInputElement | null;
		if (input) {
			input.value = serializeScheduleBlocks(draft.schedule.blocks);
		}
		return true;
	};

	const normalizeExceptionTime = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		draft.exception.timeRange = normalizeTimeRangesInput(input.value);
	};
	export const normalizeExceptionBeforeSubmit = (event?: SubmitEvent) => {
		if (draft.exception.periodMode === 'single') {
			draft.exception.timeRange = normalizeTimeRangesInput(draft.exception.timeRange);
		}
		if (exceptionErrorFor(draft.exception)) {
			event?.preventDefault();
			return false;
		}
		return true;
	};
</script>
	{#if active}
		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<form method="POST" action="?/save_weekly_rules" class={`ux-card ${sectionStateClass(dirtyFields.schedule, missingItems.includes('Horarios de atención'))}`} onsubmit={normalizeScheduleBeforeSubmit} use:enhance={sectionEnhance('schedule')}>
				<div>
					<h2 class="ux-section-title">Horarios de atención</h2>
					<p class="mt-2 text-sm text-white/55">Marcá los días y escribí los bloques horarios.</p>
					{#if missingItems.includes('Horarios de atención')}
						<p class="ux-section-meta ux-section-meta-danger">Necesario para recibir turnos</p>
					{:else if dirtyFields.schedule}
						<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
					{/if}
				</div>
				<input type="hidden" name="schedule_blocks" value={scheduleBlocksJson} /><input type="hidden" name="availability_revision" value={availabilityRevision}/><input type="hidden" name="exception_request_id" value={draft.exception.requestId}/>
				<div class="mt-6 grid gap-4">
					{#each draft.schedule.blocks as block, blockIndex (block.id)}
						{@const assignedByOtherBlock = usedWeekdays(block.id)}
						{@const preview = schedulePreview(block)}
						{@const daysStatus = scheduleBlockDaysStatus(block)}
						{@const timeStatus = scheduleBlockTimeStatus(block)}
						{@const intervalStatus = scheduleBlockIntervalStatus(block)}
						<div class={`ux-soft-card p-4 ${scheduleBlockCardClass(block)}`}>
							<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div class="min-w-0 flex-1">
									<h3 class="text-base font-bold text-white">Bloque {blockIndex + 1}</h3>
									<p class="mt-1 text-sm text-white/55">Días que comparten la misma franja habitual.</p><div class="mt-4"><label class="ux-label">Prestaciones de esta franja<select use:styledSelect={block.serviceScope??'all'} class="ux-input mt-2" value={block.serviceScope??'all'} onchange={event=>updateScheduleBlock(block.id,{serviceScope:event.currentTarget.value as 'all'|'restricted',allowedServiceIds:block.allowedServiceIds??[]})}><option value="all">Todas las habilitadas</option><option value="restricted">Sólo las seleccionadas</option></select></label>{#if block.serviceScope==='restricted'}<fieldset class="mt-3"><legend class="ux-label">Prestaciones permitidas</legend>{#if dirtyFields.services}<p class="mt-2 text-sm text-white/75">Usá Guardar todo para aplicar juntos los cambios de prestaciones y horarios.</p>{/if}{#each data.services.filter((service:Service)=>draft.serviceIds.includes(service.id)||defaultServiceIdSet.has(service.id)) as service}<label class="mt-2 flex min-h-11 items-center gap-3 text-sm text-white/80"><input type="checkbox" checked={block.allowedServiceIds?.includes(service.id)??false} onchange={event=>updateScheduleBlock(block.id,{allowedServiceIds:event.currentTarget.checked?[...(block.allowedServiceIds??[]),service.id]:(block.allowedServiceIds??[]).filter(id=>id!==service.id)})}/>{service.name}</label>{/each}{#if !block.allowedServiceIds?.length}<p class="mt-2 text-sm text-white/80">La franja está cerrada hasta que elijas una prestación.</p>{/if}</fieldset>{/if}</div>
								</div>
								<button type="button" class="ux-btn-secondary shrink-0 text-sm" disabled={!canOperate} onclick={() => removeScheduleBlock(block.id)}>
									Quitar bloque
								</button>
							</div>

							<div class="mt-5">
								<span class="ux-label flex flex-wrap items-center gap-2">
									Días
									{#if daysStatus === 'Elegí días'}
										<span class="ux-inline-status ux-inline-status-danger">{daysStatus}</span>
									{:else if daysStatus}
										<span class="ux-inline-status ux-inline-status-warning">{daysStatus}</span>
									{/if}
								</span>
								<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2">
									{#each weekdays as day, index}
										<button
											type="button"
											disabled={!canOperate}
											class={`min-h-14 min-w-0 rounded-2xl border px-3 py-3 text-center text-sm font-bold leading-tight whitespace-normal transition disabled:cursor-not-allowed disabled:opacity-50 ${
												block.weekdays.includes(index)
													? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
													: false /* Another block on this weekday is valid when the time ranges do not overlap. */
														? 'border-white/5 bg-white/[0.015] text-white/30'
														: 'border-white/10 bg-white/[0.03] text-white/65 hover:border-[#8b5cf6]/60 hover:bg-white/[0.06]'
											}`}
											onclick={() => toggleBlockWeekday(block.id, index)}
										>
											{day}
										</button>
									{/each}
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [1, 2, 3, 4, 5])}>Lunes a viernes</button>
									<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [6])}>Sólo sábado</button>
									<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [])}>Limpiar</button>
								</div>
							</div>

							<div class="mt-5 grid gap-4 lg:grid-cols-[1fr_180px]">
								<label>
									<span class="ux-label flex flex-wrap items-center gap-2">
										Horarios
										{#if timeStatus === 'Necesario para recibir turnos' || timeStatus === 'Horario inválido'}
											<span class="ux-inline-status ux-inline-status-danger">{timeStatus}</span>
										{:else if timeStatus}
											<span class="ux-inline-status ux-inline-status-warning">{timeStatus}</span>
										{/if}
									</span>
									<input
										type="text"
										placeholder="9 a 13, 15 a 19"
										value={block.timeRanges}
										disabled={!canOperate}
										aria-invalid={timeStatus === 'Necesario para recibir turnos' || timeStatus === 'Horario inválido'}
										class={`ux-input text-lg font-bold ${fieldStateClass(
											timeStatus === 'Sin guardar',
											timeStatus === 'Necesario para recibir turnos' || timeStatus === 'Horario inválido'
										)}`}
										oninput={(event) => updateScheduleBlock(block.id, { timeRanges: (event.currentTarget as HTMLInputElement).value })}
										onfocus={() => (scheduleTimeEditing = true)}
										onblur={() => finishScheduleBlockTimeEdit(block.id)}
									/>
									{#if preview.length > 0}
										<div class="mt-3 flex flex-wrap gap-2">
											{#each preview as range}
												<span class="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
													{range.start} - {range.end}
												</span>
											{/each}
										</div>
									{/if}
								</label>
								<label>
									<span class="ux-label flex flex-wrap items-center gap-2">
										Descanso entre consultas
										{#if intervalStatus === 'Ingresá un entero desde 0'}
											<span class="ux-inline-status ux-inline-status-danger">{intervalStatus}</span>
										{:else if intervalStatus}
											<span class="ux-inline-status ux-inline-status-warning">{intervalStatus}</span>
										{/if}
									</span>
									<input
										type="number"
										inputmode="numeric"
										min="0"
										step="1"
										value={block.slotInterval}
										disabled={!canOperate}
										class={`ux-input text-lg font-bold ${fieldStateClass(
											intervalStatus === 'Sin guardar',
											intervalStatus === 'Ingresá un entero desde 0'
										)}`}
										oninput={(event) => updateScheduleBlock(block.id, { slotInterval: (event.currentTarget as HTMLInputElement).value })}
									/>
									<span class="mt-2 block text-xs font-semibold leading-relaxed text-white/45">
										0 permite otro turno inmediatamente. También podés usar cualquier entero, por ejemplo 2, 23 o 60.
									</span>
								</label>
							</div>
						</div>
					{/each}
				</div>
				{#if scheduleError}
					<p class="ux-alert mt-4">{scheduleError}</p>
				{/if}
				<button type="button" disabled={!canOperate} class="ux-btn-secondary mt-4 w-full" onclick={addScheduleBlock}>
					Agregar otro bloque
				</button>
				<button type="submit" disabled={!canOperate || !scheduleHasAnyDay || !scheduleCanSave || saving !== null || !dirtyFields.schedule} class="ux-btn-secondary mt-3 w-full">
					{saving === 'schedule' ? 'Guardando...' : 'Guardar sólo horarios'}
				</button>
			</form>

			<form
				method="POST"
				action="?/create_exception"
				class={`ux-card ${sectionStateClass(dirtyFields.exception)}`}
				onsubmit={normalizeExceptionBeforeSubmit}
				use:enhance={sectionEnhance('exception')}
			>
				<h2 class="ux-section-title">Ausencia o cambio de horario</h2>{#if form?.exceptionConflict}<label class="ux-alert mt-3 flex items-start gap-3"><input type="checkbox" name="ack_existing_appointments" value="true" bind:checked={acknowledgedAppointments} required/><span>Revisé los turnos existentes. Confirmo el bloqueo de nuevos turnos; los anteriores se conservan.</span></label>{/if}
				<p class="mt-2 text-sm text-white/55">Bloqueá un horario puntual o varios días completos.</p><label class="mt-4 flex min-h-11 items-center gap-3 text-sm text-white/80"><input type="radio" name="type" value="restricted" bind:group={draft.exception.type} onclick={()=>draft.exception.periodMode='single'}/>Reservar esta franja para prestaciones específicas</label>{#if draft.exception.type==='restricted'}<fieldset class="mt-3"><legend class="ux-label">Prestaciones permitidas en esta fecha</legend>{#each data.services.filter((service:Service)=>draft.exception.appliesTo==='business'||draft.serviceIds.includes(service.id)||defaultServiceIdSet.has(service.id)) as service}<label class="mt-2 flex min-h-11 items-center gap-3 text-sm text-white/80"><input type="checkbox" name="exception_service_ids" value={service.id} bind:group={draft.exception.allowedServiceIds}/>{service.name}</label>{/each}</fieldset>{/if}
				{#if dirtyFields.exception}
					<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
				{/if}
				<input type="hidden" name="period_mode" value={draft.exception.periodMode} /><input type="hidden" name="availability_revision" value={availabilityRevision}/><input type="hidden" name="exception_request_id" value={draft.exception.requestId}/><input type="hidden" name="dates" value={JSON.stringify(draft.exception.dates??[])}/>
				<div class="mt-5 grid gap-4">
					<div>
						<span class="ux-label">Afecta a</span>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.appliesTo === 'professional' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="applies_to" value="professional" bind:group={draft.exception.appliesTo} class="mr-2 accent-[#7c3aed]" />
								{professional?.name ?? 'Profesional'}
							</label>
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.appliesTo === 'business' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="applies_to" value="business" bind:group={draft.exception.appliesTo} class="mr-2 accent-[#7c3aed]" />
								Todo el consultorio
							</label>
						</div>
					</div>
					<div>
						<span class="ux-label">Tipo</span>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.type === 'blocked' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="type" value="blocked" bind:group={draft.exception.type} class="mr-2 accent-[#7c3aed]" />
								Bloquear
							</label>
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.type === 'extra_available' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="type" value="extra_available" bind:group={draft.exception.type} class="mr-2 accent-[#7c3aed]" />
								Sumar horario
							</label>
						</div>
					</div>
					{#if draft.exception.type === 'blocked'}
						<div>
							<span class="ux-label flex flex-wrap items-center gap-2">
								Duración del bloqueo
								{#if dirtyFields.exception}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
							</span>
							<div class="mt-3 grid gap-2 sm:grid-cols-2">
								<button
									type="button"
									disabled={!canOperate}
									aria-pressed={draft.exception.periodMode === 'single'}
									class={`ux-choice p-4 text-left ${draft.exception.periodMode === 'single' ? 'ux-choice-active' : ''}`}
									onclick={() => (draft.exception.periodMode = 'single')}
								>
									<span class="block font-bold text-white">Un día</span>
									<span class="mt-1 block text-xs text-white/50">Elegís fecha y horario.</span>
								</button>
								<button
									type="button"
									disabled={!canOperate}
									aria-pressed={draft.exception.periodMode === 'range'}
									class={`ux-choice p-4 text-left ${draft.exception.periodMode === 'range' ? 'ux-choice-active' : ''}`}
									onclick={() => (draft.exception.periodMode = 'range')}
								>
									<span class="block font-bold text-white">Rango de días</span>
									<span class="mt-1 block text-xs text-white/50">Desde y hasta, días completos.</span>
								</button><button type="button" class="ux-choice p-4 text-left" aria-pressed={draft.exception.periodMode==='multiple'} onclick={()=>draft.exception.periodMode='multiple'}><span class="block font-bold">Fechas separadas</span><span class="mt-1 block text-xs text-white/70">Elegí varios días completos.</span></button>
							</div>
						</div>
					{/if}
					{#if draft.exception.periodMode==='multiple'}<label class="ux-label">Agregar una fecha<input use:styledDate={draft.exception.date} type="date" bind:value={draft.exception.date} class="ux-input"/></label><button type="button" class="ux-btn-secondary" disabled={!draft.exception.date} onclick={()=>{draft.exception.dates=[...new Set([...(draft.exception.dates??[]),draft.exception.date])].sort();draft.exception.date='';}}>Agregar fecha</button><ul>{#each draft.exception.dates??[] as date}<li class="mt-2 flex items-center justify-between gap-3"><span>{date}</span><button type="button" class="ux-btn-secondary" aria-label={`Quitar fecha ${date}`} onclick={()=>draft.exception.dates=draft.exception.dates.filter(item=>item!==date)}>Quitar</button></li>{/each}</ul>{:else if draft.exception.periodMode === 'single'}
						<div class="grid gap-4 sm:grid-cols-2">
							<label>
								<span class="ux-label">Fecha</span>
								<input use:styledDate={draft.exception.date} name="date" type="date" bind:value={draft.exception.date} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
							<label>
								<span class="ux-label">Horario</span>
								<input name="time_range" type="text" placeholder="10 a 12" bind:value={draft.exception.timeRange} onblur={normalizeExceptionTime} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
						</div>
					{:else}
						<div class="grid gap-4 sm:grid-cols-2">
							<label>
								<span class="ux-label">Desde</span>
								<input use:styledDate={draft.exception.dateFrom} name="date_from" type="date" bind:value={draft.exception.dateFrom} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
							<label>
								<span class="ux-label">Hasta</span>
								<input use:styledDate={draft.exception.dateTo} name="date_to" type="date" min={draft.exception.dateFrom} bind:value={draft.exception.dateTo} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
						</div>
						<p class="rounded-2xl border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-sm font-bold text-violet-100">
							Incluye ambos días completos. Los turnos ya agendados no se cancelan.
						</p>
					{/if}
					<label>
						<span class="ux-label">Motivo (opcional)</span>
						<input name="reason" placeholder="Vacaciones, feriado…" bind:value={draft.exception.reason} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
					</label>
					{#if exceptionValidationMessage}
						<p class="ux-alert">{exceptionValidationMessage}</p>
					{/if}
				</div>
				<button type="submit" disabled={!canOperate || saving !== null || !exceptionCanSave} class="ux-btn-secondary mt-5 w-full">
					{saving === 'exception' ? 'Guardando...' : draft.exception.periodMode === 'range' ? 'Guardar rango' : 'Guardar cambio'}
				</button>
			</form>
		</div>

		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<div class="ux-card">
				<div class="flex items-center justify-between gap-4">
					<h2 class="ux-section-title">Semana habitual</h2>
					<span class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55">
						{data.rules.length} bloques
					</span>
				</div>
				<div class="mt-5 grid gap-3">
					{#each rulesByWeekday as day}
						<div class="ux-soft-card p-4">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p class="min-w-28 text-sm font-bold text-white">{day.day}</p>
								<div class="flex flex-1 flex-wrap gap-2">
									{#if day.rules.length > 0}
										{#each day.rules as rule}
											<form method="POST" action="?/delete_rule" class="flex w-full flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2" use:enhance={refreshEnhance}>
												<input type="hidden" name="rule_id" value={rule.id}/><input type="hidden" name="availability_revision" value={data.availabilityRevision??0} />
												<span class="whitespace-nowrap text-sm font-bold text-white">{rule.start_time.slice(0, 5)} - {rule.end_time.slice(0, 5)}</span>
												<span class="text-xs font-bold text-white/50">Descanso entre consultas: {rule.break_minutes} min</span>{#if rule.service_scope==='restricted'}<span class="text-xs text-white/75">{restrictionLabel((rule.rule_services??[]).map(item=>item.service_id))}</span>{/if}
												<button type="submit" disabled={!canOperate} class="min-h-11 whitespace-nowrap font-bold text-red-200 disabled:opacity-50">Quitar</button>
											</form>
										{/each}
									{:else}
										<span class="rounded-full border border-dashed border-white/10 px-3 py-2 text-sm font-bold text-white/35">Sin atención</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="ux-card">
				<h2 class="ux-section-title">Cambios puntuales</h2>
				<div class="mt-5 grid gap-3">
						{#each data.exceptions as item}
							<form method="POST" action="?/delete_exception" class="ux-soft-card p-4" use:enhance={refreshEnhance}>
							<input type="hidden" name="exception_id" value={item.id} />
							<div class="flex items-start justify-between gap-3">
								<div class="text-sm">
									<p class="font-bold text-white">{item.type === 'blocked' ? 'Bloqueo' : item.type==='restricted'?'Franja reservada':'Horario extra'} · {exceptionTarget(item)}</p>
									<p class="mt-1 text-white/55">{exceptionPeriodLabel(item)}</p>{#if item.type==='restricted'}<p class="mt-1 text-xs text-white/75">{restrictionLabel((item.exception_services??[]).map((row:{service_id:string})=>row.service_id))}</p>{/if}
									{#if item.reason}<p class="mt-1 text-xs text-white/42">{item.reason}</p>{/if}
								</div>
								<button type="submit" disabled={!canOperate} class="min-h-11 shrink-0 whitespace-nowrap text-sm font-bold text-red-200 disabled:opacity-50">Eliminar</button>
							</div>
						</form>
					{/each}
					{#if data.exceptions.length === 0}
						<p class="ux-empty">Sin cambios puntuales cargados.</p>
					{/if}
				</div>
			</div>
			</div>
		{/if}
