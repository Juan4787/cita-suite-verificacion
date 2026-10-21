<script lang="ts">
	import { formatDuration } from '$lib/utils/format';
	import { onDestroy } from 'svelte';
	import type { BusinessRole } from '$lib/access/contracts';
	import { isRecord } from '$lib/contracts/json';
	import {
		roleLabels,
		type TeamServiceOption,
		type TeamActionFeedback
	} from '$lib/team/member-editor';
	import { shouldConfigureProfessionalProfile } from '$lib/utils/team-permissions';
	import { formatPriceLabel } from '$lib/utils/money-input';
	import {
		normalizeTimeRangesForCommit,
		normalizeTimeRangesInput,
		parseTimeRanges
	} from '$lib/utils/time-ranges';
	import {
		createEmptyScheduleBlock,
		serializeScheduleBlocks,
		parseScheduleBlocksJson,
		validateScheduleBlocks,
		type ScheduleBlockDraft
	} from '$lib/utils/schedule-blocks';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	let {
		services,
		roles,
		defaultServiceNames,
		canManage,
		form,
		onclose
	}: {
		services: TeamServiceOption[];
		roles: readonly BusinessRole[];
		defaultServiceNames: readonly string[];
		canManage: boolean;
		form?: TeamActionFeedback;
		onclose: () => void;
	} = $props();
	const customServices = $derived(services.filter((service) => !service.is_default));
	type NewService = { name: string; duration_minutes: number; price_label: string };
	const roleDescriptions: Record<BusinessRole, string> = {
		owner: 'Control total del consultorio.',
		admin: 'Configura equipo, agenda y pacientes.',
		reception: 'Opera agenda y pacientes sin historia clínica.',
		professional: 'Atiende turnos y accede a sus pacientes.',
		readonly: 'Sólo consulta información.'
	};

	const weekdayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

	// ----- Wizard Agregar integrante -----
	const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	let stepIndex = $state(0);
	let email = $state('');
	let role = $state<BusinessRole>('reception');
	let professionalProfileRequested = $state(false);
	let professionalName = $state('');
	let professionalSpecialty = $state('');
	let selectedServiceIds = $state<string[]>([]);
	let newServices = $state<NewService[]>([]);
	let newServiceName = $state('');
	let newServiceDuration = $state('30');
	let newServicePrice = $state('');
	let scheduleBlocks = $state<ScheduleBlockDraft[]>([
		{ ...createEmptyScheduleBlock('wizard-block-1') }
	]);
	let scheduleBlockSeq = 20;
	let exceptionAppliesTo = $state<'professional' | 'business'>('professional');
	let exceptionType = $state<'blocked' | 'extra_available'>('blocked');
	let exceptionPeriodMode = $state<'single' | 'range'>('single');
	let exceptionDate = $state('');
	let exceptionDateFrom = $state('');
	let exceptionDateTo = $state('');
	let exceptionTimeRange = $state('');
	let exceptionReason = $state('');

	let emailError = $state('');
	let nameError = $state('');
	let newServiceError = $state('');
	let scheduleError = $state('');
	let exceptionError = $state('');
	let wizardSubmitting = $state(false);
	let wizardUncertain = $state(false);
	let wizardError = $state('');
	let disposed = false;
	onDestroy(() => {
		disposed = true;
	});

	const hasProfessionalProfile = $derived(
		shouldConfigureProfessionalProfile({ role, requested: professionalProfileRequested })
	);
	const steps = $derived(
		hasProfessionalProfile
			? ['email', 'rol', 'datos', 'servicios', 'horarios', 'resumen']
			: ['email', 'rol', 'resumen']
	);
	const currentStep = $derived(steps[Math.min(stepIndex, steps.length - 1)]);

	$effect(() => {
		const values = form?.values;
		if (!values) return;
		if (values.email) email = String(values.email);
		const restoredRole = roles.find((candidate) => candidate === String(values.role ?? ''));
		if (restoredRole) role = restoredRole;
		professionalProfileRequested = values.has_professional_profile === 'true';
		if (values.professional_name) professionalName = String(values.professional_name);
		if (values.professional_specialty) professionalSpecialty = String(values.professional_specialty);
		if (values.schedule_blocks) {
			const restoredBlocks = parseScheduleBlocksJson(String(values.schedule_blocks));
			scheduleBlocks = restoredBlocks?.map((block, index) => ({
				...block,
				id: `restored-wizard-block-${index + 1}`
			})) ?? [{ ...createEmptyScheduleBlock('wizard-block-1') }];
		} else if (values.time_ranges || values.weekdays_csv) {
			scheduleBlocks = [
				{
					id: 'restored-wizard-block-1',
					weekdays: String(values.weekdays_csv ?? '')
						.split(',')
						.map((value) => Number(value))
						.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
					timeRanges: String(values.time_ranges ?? ''),
					slotInterval: String(values.break_minutes ?? '15'),
					gridInterval: String(values.slot_interval_minutes ?? '15')
				}
			];
		}
		if (values.service_ids_csv) {
			selectedServiceIds = String(values.service_ids_csv).split(',').filter(Boolean);
		}
		if (values.new_services) {
			try {
				const parsed: unknown = JSON.parse(String(values.new_services));
				if (Array.isArray(parsed)) {
					const rows: unknown[] = parsed;
					if (
						rows.every(
							(item): item is NewService =>
								isRecord(item) &&
								typeof item.name === 'string' &&
								typeof item.duration_minutes === 'number' &&
								Number.isFinite(item.duration_minutes) &&
								typeof item.price_label === 'string'
						)
					)
						newServices = rows;
				}
			} catch {
				newServices = [];
			}
		}
		if (values.exception_applies_to === 'business') exceptionAppliesTo = 'business';
		if (values.exception_type === 'extra_available') exceptionType = 'extra_available';
		if (values.exception_period_mode === 'range' && exceptionType === 'blocked') {
			exceptionPeriodMode = 'range';
		}
		if (values.exception_date) exceptionDate = String(values.exception_date);
		if (values.exception_date_from) exceptionDateFrom = String(values.exception_date_from);
		if (values.exception_date_to) exceptionDateTo = String(values.exception_date_to);
		if (values.exception_time_range) exceptionTimeRange = String(values.exception_time_range);
		if (values.exception_reason) exceptionReason = String(values.exception_reason);
	});

	$effect(() => {
		if (exceptionType === 'extra_available' && exceptionPeriodMode === 'range') {
			exceptionPeriodMode = 'single';
		}
	});

	const resetWizard = () => {
		stepIndex = 0;
		email = '';
		role = 'reception';
		professionalProfileRequested = false;
		professionalName = '';
		professionalSpecialty = '';
		selectedServiceIds = [];
		newServices = [];
		newServiceName = '';
		newServiceDuration = '30';
		newServicePrice = '';
		scheduleBlocks = [{ ...createEmptyScheduleBlock(`wizard-block-${scheduleBlockSeq++}`) }];
		exceptionAppliesTo = 'professional';
		exceptionType = 'blocked';
		exceptionPeriodMode = 'single';
		exceptionDate = '';
		exceptionDateFrom = '';
		exceptionDateTo = '';
		exceptionTimeRange = '';
		exceptionReason = '';
		emailError = '';
		nameError = '';
		newServiceError = '';
		scheduleError = '';
		exceptionError = '';
	};

	const usedWeekdays = (exceptBlockId = '') =>
		new Set(
			scheduleBlocks.filter((block) => block.id !== exceptBlockId).flatMap((block) => block.weekdays)
		);

	const updateScheduleBlock = (blockId: string | undefined, patch: Partial<ScheduleBlockDraft>) => {
		scheduleBlocks = scheduleBlocks.map((block) =>
			block.id === blockId ? { ...block, ...patch } : block
		);
		scheduleError = '';
	};

	const commitScheduleBlockTimeRanges = (blockId: string | undefined) => {
		const block = scheduleBlocks.find((item) => item.id === blockId);
		if (!block) return false;
		const result = normalizeTimeRangesForCommit(block.timeRanges);
		if (!result.ok) {
			scheduleError = 'Horario inválido.';
			return false;
		}
		updateScheduleBlock(block.id, { timeRanges: result.value });
		return true;
	};

	const validateCurrentStep = () => {
		if (currentStep === 'email') {
			if (!email.trim()) {
				emailError = 'Completá el email para continuar.';
				return false;
			}
			if (!EMAIL_FORMAT_REGEX.test(email.trim().toLowerCase())) {
				emailError = 'Ingresá un email válido.';
				return false;
			}
			emailError = '';
			return true;
		}
		if (currentStep === 'datos') {
			if (!professionalName.trim()) {
				nameError = 'Completá el nombre para continuar.';
				return false;
			}
			nameError = '';
			return true;
		}
		if (currentStep === 'horarios') {
			let valid = true;
			for (const block of scheduleBlocks) {
				if (!commitScheduleBlockTimeRanges(block.id)) valid = false;
			}
			const scheduleResult = validateScheduleBlocks(scheduleBlocks);
			if (!scheduleResult.ok) {
				scheduleError = scheduleResult.message;
				valid = false;
			} else {
				scheduleError = '';
			}
			if (exceptionPeriodMode === 'single') {
				const hasDate = Boolean(exceptionDate.trim());
				const hasTime = Boolean(exceptionTimeRange.trim());
				const ranges = hasTime ? parseTimeRanges(exceptionTimeRange) : null;
				if (hasDate !== hasTime) {
					exceptionError = 'Completá fecha y horario, o dejá ambos vacíos.';
					valid = false;
				} else if (hasTime && (!ranges || ranges.length !== 1)) {
					exceptionError = 'Ingresá una sola franja horaria válida.';
					valid = false;
				} else {
					exceptionError = '';
				}
			} else {
				const hasFrom = Boolean(exceptionDateFrom.trim());
				const hasTo = Boolean(exceptionDateTo.trim());
				if (hasFrom !== hasTo) {
					exceptionError = 'Completá las fechas Desde y Hasta, o dejá ambas vacías.';
					valid = false;
				} else if (hasFrom && exceptionDateTo < exceptionDateFrom) {
					exceptionError = 'La fecha Hasta no puede ser anterior a Desde.';
					valid = false;
				} else {
					exceptionError = '';
				}
			}
			return valid;
		}
		return true;
	};

	const nextStep = () => {
		if (!validateCurrentStep()) return;
		if (stepIndex < steps.length - 1) stepIndex += 1;
	};

	const previousStep = () => {
		stepIndex = Math.max(Math.min(stepIndex, steps.length - 1) - 1, 0);
	};

	const toggleService = (serviceId: string) => {
		selectedServiceIds = selectedServiceIds.includes(serviceId)
			? selectedServiceIds.filter((id) => id !== serviceId)
			: [...selectedServiceIds, serviceId];
	};

	const addNewService = () => {
		const name = newServiceName.trim();
		const duration = Number(newServiceDuration);
		if (!name) {
			newServiceError = 'Completá el nombre del servicio.';
			return;
		}
		if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
			newServiceError = 'La duración debe estar entre 5 y 480 minutos.';
			return;
		}
		newServiceError = '';
		newServices = [
			...newServices,
			{ name, duration_minutes: duration, price_label: newServicePrice.trim() }
		];
		newServiceName = '';
		newServiceDuration = '30';
		newServicePrice = '';
	};

	const removeNewService = (index: number) => {
		newServices = newServices.filter((_, itemIndex) => itemIndex !== index);
	};

	const toggleBlockWeekday = (blockId: string | undefined, weekday: number) => {
		const target = scheduleBlocks.find((block) => block.id === blockId);
		if (!target) return;
		const adding = !target.weekdays.includes(weekday);
		scheduleBlocks = scheduleBlocks.map((block) => {
			if (block.id === blockId) {
				return {
					...block,
					weekdays: adding
						? [...block.weekdays, weekday].sort((a, b) => a - b)
						: block.weekdays.filter((item) => item !== weekday)
				};
			}
			return adding
				? { ...block, weekdays: block.weekdays.filter((item) => item !== weekday) }
				: block;
		});
		scheduleError = '';
	};

	const setBlockWeekdays = (blockId: string | undefined, items: number[]) => {
		const normalized = [...new Set(items)].sort((a, b) => a - b);
		scheduleBlocks = scheduleBlocks.map((block) => {
			if (block.id === blockId) return { ...block, weekdays: normalized };
			return {
				...block,
				weekdays: block.weekdays.filter((weekday) => !normalized.includes(weekday))
			};
		});
		scheduleError = '';
	};

	const addScheduleBlock = () => {
		const next = createEmptyScheduleBlock(`wizard-block-${scheduleBlockSeq++}`);
		scheduleBlocks = [...scheduleBlocks, next];
		scheduleError = '';
	};

	const removeScheduleBlock = (blockId: string | undefined) => {
		if (scheduleBlocks.length <= 1) {
			scheduleBlocks = [{ ...scheduleBlocks[0], weekdays: [], timeRanges: '', slotInterval: '15' }];
		} else {
			scheduleBlocks = scheduleBlocks.filter((block) => block.id !== blockId);
		}
		scheduleError = '';
	};

	const handlePriceInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = formatPriceLabel(input.value);
		newServicePrice = input.value;
	};

	const normalizeExceptionTime = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		exceptionTimeRange = normalizeTimeRangesInput(input.value);
	};

	const schedulePreview = (block: ScheduleBlockDraft) => parseTimeRanges(block.timeRanges) ?? [];
	const selectedCustomServices = $derived(
		customServices.filter((service) => selectedServiceIds.includes(service.id))
	);
	const summaryAdditionalServices = $derived([
		...selectedCustomServices.map((service) => service.name),
		...newServices.map((service) => service.name)
	]);
	const summaryScheduleBlocks = $derived(
		scheduleBlocks.map((block) => ({
			days: block.weekdays.map((weekday) => weekdayNames[weekday]).join(', '),
			ranges: schedulePreview(block)
				.map((range) => `${range.start} a ${range.end}`)
				.join(', '),
			slotInterval: block.slotInterval || '15'
		}))
	);
	const hasExceptionLoaded = $derived(
		exceptionPeriodMode === 'range'
			? Boolean(exceptionDateFrom.trim() && exceptionDateTo.trim())
			: Boolean(exceptionDate.trim() && exceptionTimeRange.trim())
	);
	const formatDateKey = (value: string) => {
		const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
	};
	const newServicesJson = $derived(JSON.stringify(newServices));
	const scheduleBlocksJson = $derived(serializeScheduleBlocks(scheduleBlocks));

	const defaultServiceRows = $derived(
		defaultServiceNames.map((name) => {
			const existing = services.find(
				(service) => service.is_default && service.name.trim().toLowerCase() === name.toLowerCase()
			);
			return {
				name,
				duration_minutes: existing?.duration_minutes ?? 30,
				price_label: existing?.price_label ?? null
			};
		})
	);


	const handleWizardSubmit = (event: SubmitEvent) => {
		if (!hasProfessionalProfile) return;
		if (validateCurrentStep()) return;
		event.preventDefault();
		stepIndex = steps.indexOf('horarios');
	};

	const wizardEnhance: SubmitFunction = ({ cancel }) => {
		if (wizardSubmitting || wizardUncertain) {
			cancel();
			return;
		}
		wizardError = '';
		if (hasProfessionalProfile && !validateCurrentStep()) {
			stepIndex = steps.indexOf('horarios');
			cancel();
			return;
		}
		wizardSubmitting = true;
		return async ({ result, update }) => {
			if (disposed) return;
			wizardSubmitting = false;
			if (result.type === 'error' || (result.type === 'failure' && result.status >= 500)) {
				wizardUncertain = true;
				wizardError = 'No pudimos confirmar el cambio. Revisá Equipo antes de volver a intentarlo.';
				return;
			}
			if (result.type === 'success') {
				onclose();
				resetWizard();
				await update({ reset: false, invalidateAll: false });
				await invalidate('app:team');
				return;
			}
			await update({ reset: false, invalidateAll: false });
			await invalidate('app:team');
		};
	};
</script>
		<form
			method="POST"
			action="?/add_user"
			class="ux-card scroll-mt-5"
			onsubmit={handleWizardSubmit}
			use:enhance={wizardEnhance}
			aria-busy={wizardSubmitting}
		>
            {#if wizardError}<p class="ux-alert" role="alert">{wizardError} <a href="/odonto/configuracion/usuarios" class="underline">Revisar equipo</a></p>{/if}
            <fieldset disabled={wizardSubmitting || wizardUncertain} class="m-0 min-w-0 border-0 p-0">
            <legend class="sr-only">Datos del integrante</legend>
			<div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 class="ux-section-title">Agregar integrante</h2>
				<div class="flex shrink-0 gap-2">
					{#each steps as _, item}
						<span class={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${stepIndex === item ? 'bg-[#7c3aed] text-white' : 'bg-white/10 text-white/45'}`}>
							{item + 1}
						</span>
					{/each}
				</div>
			</div>

			<input type="hidden" name="email" value={email.trim().toLowerCase()} />
			<input type="hidden" name="role" value={role} />
			<input type="hidden" name="has_professional_profile" value={hasProfessionalProfile ? 'true' : 'false'} />
			<input type="hidden" name="professional_name" value={professionalName} />
			<input type="hidden" name="professional_specialty" value={professionalSpecialty} />
			{#each selectedServiceIds as serviceId}
				<input type="hidden" name="service_ids" value={serviceId} />
			{/each}
			<input type="hidden" name="service_ids_csv" value={selectedServiceIds.join(',')} />
			<input type="hidden" name="new_services" value={newServicesJson} />
			<input type="hidden" name="schedule_blocks" value={scheduleBlocksJson} />
			<input type="hidden" name="exception_applies_to" value={exceptionAppliesTo} />
			<input type="hidden" name="exception_type" value={exceptionType} />
			<input type="hidden" name="exception_period_mode" value={exceptionPeriodMode} />
			<input type="hidden" name="exception_date" value={exceptionDate} />
			<input type="hidden" name="exception_date_from" value={exceptionDateFrom} />
			<input type="hidden" name="exception_date_to" value={exceptionDateTo} />
			<input type="hidden" name="exception_time_range" value={exceptionTimeRange} />
			<input type="hidden" name="exception_reason" value={exceptionReason} />

			{#if currentStep === 'email'}
				<label class="mt-5 block">
					<span class="ux-label">Email</span>
					<input
						type="email"
						autocomplete="email"
						placeholder="persona@consultorio.com"
						disabled={!canManage}
						class={`ux-input ${emailError ? 'border-red-400/60' : ''}`}
						bind:value={email}
					/>
				</label>
				<p class="mt-2 text-sm text-white/55">
					Con este email la persona crea su cuenta y entra automáticamente al consultorio con el rol asignado.
				</p>
				{#if emailError}
					<p class="ux-alert mt-3">{emailError}</p>
				{/if}
				<button type="button" disabled={!canManage} class="ux-btn-primary mt-4 w-full" onclick={nextStep}>
					Siguiente
				</button>
			{:else if currentStep === 'rol'}
				<div class="mt-5 grid gap-3 md:grid-cols-2">
					{#each roles as option}
						<button
							type="button"
							disabled={!canManage}
							class={`rounded-2xl border px-5 py-4 text-left transition ${
								role === option
									? 'border-[#7c3aed] bg-[#7c3aed]/20 text-white'
									: 'border-white/10 bg-white/[0.04] text-white/80 hover:border-white/25'
							}`}
							onclick={() => (role = option)}
						>
							<span class="block text-lg font-bold">{roleLabels[option]}</span>
							<span class="mt-1 block text-sm text-white/55">{roleDescriptions[option]}</span>
						</button>
					{/each}
				</div>
				{#if role === 'admin' || role === 'owner'}
					<label class="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-white">
						<input
							type="checkbox"
							bind:checked={professionalProfileRequested}
							disabled={!canManage}
							class="mt-1 accent-[#7c3aed]"
						/>
						<span>
							<span class="block font-bold">También atiende pacientes</span>
							<span class="mt-1 block text-sm text-white/55">
								Creá ahora su perfil profesional y dejá configurados sus servicios y horarios, aunque todavía no tenga cuenta.
							</span>
						</span>
					</label>
				{/if}
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else if currentStep === 'datos'}
				<div class="mt-5 grid gap-4 md:grid-cols-2">
					<label>
						<span class="ux-label">Nombre</span>
						<input
							placeholder="Nombre y apellido"
							disabled={!canManage}
							class={`ux-input ${nameError ? 'border-red-400/60' : ''}`}
							bind:value={professionalName}
						/>
					</label>
					<label>
						<span class="ux-label">Especialidad (opcional)</span>
						<input disabled={!canManage} class="ux-input" bind:value={professionalSpecialty} />
					</label>
				</div>
				{#if nameError}
					<p class="ux-alert mt-3">{nameError}</p>
				{/if}
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else if currentStep === 'servicios'}
				<div class="mt-5 grid gap-5 xl:grid-cols-[1fr_0.75fr]">
					<div class="ux-soft-card p-4 sm:p-5">
						<h3 class="ux-section-title">Servicios que ofrece</h3>
						<p class="mt-1 text-sm text-white/55">Estos servicios estarán disponibles para reservar con este profesional.</p>
						<div class="mt-5 grid gap-3">
							{#each defaultServiceRows as service}
								<div class="ux-choice ux-choice-active flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4">
									<input type="checkbox" checked disabled class="accent-[#7c3aed]" />
									<span class="min-w-0 flex-1">
										<span class="block break-words font-bold text-white">{service.name}</span>
										<span class="mt-1 block text-sm text-white/55">
											{formatDuration(service.duration_minutes)}{service.price_label ? ` ·\u00a0${service.price_label}` : ''}
										</span>
									</span>
								</div>
							{/each}
							{#each customServices as service}
								<label class={`ux-choice flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4 ${selectedServiceIds.includes(service.id) ? 'ux-choice-active' : ''}`}>
									<input
										type="checkbox"
										checked={selectedServiceIds.includes(service.id)}
										disabled={!canManage}
										class="accent-[#7c3aed]"
										onchange={() => toggleService(service.id)}
									/>
									<span class="min-w-0 flex-1">
										<span class="block break-words font-bold text-white">{service.name}</span>
										<span class="mt-1 block text-sm text-white/55">
											{formatDuration(service.duration_minutes)}{service.price_label ? ` ·\u00a0${service.price_label}` : ''}
										</span>
									</span>
								</label>
							{/each}
							{#each newServices as service, index}
								<div class="ux-choice ux-choice-active flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4">
									<input type="checkbox" checked disabled class="accent-[#7c3aed]" />
									<span class="min-w-0 flex-1">
										<span class="block break-words font-bold text-white">{service.name}</span>
										<span class="mt-1 block text-sm text-white/55">
											{formatDuration(service.duration_minutes)}{service.price_label ? ` ·\u00a0${service.price_label}` : ''}
										</span>
									</span>
									<span class="ux-badge shrink-0">Nuevo</span>
									<button type="button" class="text-xs font-bold text-red-200" onclick={() => removeNewService(index)}>
										Quitar
									</button>
								</div>
							{/each}
						</div>
					</div>

					<div class="ux-soft-card p-4 sm:p-5">
						<h3 class="ux-section-title">Agregar servicio</h3>
						<p class="mt-1 text-sm text-white/55">
							Crealo una vez y queda asignado a {professionalName.trim() || 'este profesional'}.
						</p>
						<div class="mt-5 grid gap-4">
							<label>
								<span class="ux-label">Nombre</span>
								<input disabled={!canManage} class="ux-input" bind:value={newServiceName} />
							</label>
							<label>
								<span class="ux-label">Duración en minutos</span>
								<input type="number" min="5" max="480" step="1" disabled={!canManage} class="ux-input" bind:value={newServiceDuration} />
							</label>
							<label>
								<span class="ux-label">Precio visible (opcional)</span>
								<input type="text" inputmode="numeric" disabled={!canManage} placeholder="$ 35.000" class="ux-input" value={newServicePrice} oninput={handlePriceInput} />
							</label>
							{#if newServiceError}
								<p class="ux-alert">{newServiceError}</p>
							{/if}
							<button type="button" class="ux-btn-secondary" disabled={!canManage} onclick={addNewService}>
								Crear y asignar
							</button>
							<p class="text-xs text-white/45">El servicio se guarda recién al confirmar con Guardar rol en el resumen.</p>
						</div>
					</div>
				</div>
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else if currentStep === 'horarios'}
				<div class="mt-5 grid gap-5 xl:grid-cols-[1fr_0.78fr]">
					<div class={`ux-soft-card p-4 sm:p-5 ${scheduleError ? 'border border-red-400/40' : ''}`}>
						<h3 class="ux-section-title">Horarios de atención</h3>
						<p class="mt-1 text-sm text-white/55">Cada bloque tiene sus propios días, horarios y descanso.</p>

						<div class="mt-5 grid gap-4">
							{#each scheduleBlocks as block, blockIndex (block.id)}
								{@const assignedByOtherBlock = usedWeekdays(block.id)}
								{@const preview = schedulePreview(block)}
								<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
									<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
										<h4 class="font-bold text-white">Bloque {blockIndex + 1}</h4>
										<button type="button" class="ux-btn-secondary shrink-0 text-sm" disabled={!canManage} onclick={() => removeScheduleBlock(block.id)}>
											Quitar bloque
										</button>
									</div>
									<div class="mt-4">
										<span class="ux-label">Días</span>
										<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2">
											{#each weekdayNames as day, index}
												<button
													type="button"
													disabled={!canManage}
													class={`min-h-14 min-w-0 rounded-2xl border px-3 py-3 text-center text-sm font-bold leading-tight whitespace-normal transition disabled:cursor-not-allowed disabled:opacity-50 ${
														block.weekdays.includes(index)
															? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
															: assignedByOtherBlock.has(index)
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
											<span class="ux-label">Horarios</span>
											<input
												type="text"
												placeholder="9 a 13, 15 a 19"
												value={block.timeRanges}
												disabled={!canManage}
												aria-invalid={Boolean(scheduleError)}
												class={`ux-input text-lg font-bold ${scheduleError ? 'border-red-400/60' : ''}`}
												oninput={(event) => updateScheduleBlock(block.id, { timeRanges: (event.currentTarget as HTMLInputElement).value })}
												onblur={() => commitScheduleBlockTimeRanges(block.id)}
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
											<span class="ux-label">Descanso entre consultas (minutos)</span>
											<input
												type="number"
												inputmode="numeric"
												min="0"
												step="1"
												disabled={!canManage}
												class={`ux-input text-lg font-bold ${scheduleError ? 'border-red-400/60' : ''}`}
												value={block.slotInterval}
												oninput={(event) => updateScheduleBlock(block.id, { slotInterval: (event.currentTarget as HTMLInputElement).value })}
											/>
											<span class="mt-2 block text-xs font-semibold leading-relaxed text-white/45">
												Usá 0 para permitir otro turno inmediatamente. También podés escribir cualquier entero, por ejemplo 2, 23 o 60.
											</span>
										</label>
									</div>
								</div>
							{/each}
						</div>
						{#if scheduleError}
							<p class="ux-alert mt-4">{scheduleError}</p>
						{/if}
						<button type="button" disabled={!canManage} class="ux-btn-secondary mt-4 w-full" onclick={addScheduleBlock}>
							Agregar otro bloque
						</button>
					</div>

					<div class="ux-soft-card p-4 sm:p-5">
						<h3 class="ux-section-title">Ausencia o cambio de horario (opcional)</h3>
						<p class="mt-1 text-sm text-white/55">Podés bloquear un horario puntual o varios días completos.</p>
						<div class="mt-5 grid gap-4">
							<div>
								<span class="ux-label">Afecta a</span>
								<div class="mt-3 grid gap-2 sm:grid-cols-2">
									<label class={`ux-choice px-4 py-3 text-sm font-bold ${exceptionAppliesTo === 'professional' ? 'ux-choice-active' : ''}`}>
										<input type="radio" value="professional" bind:group={exceptionAppliesTo} class="mr-2 accent-[#7c3aed]" />
										{professionalName.trim() || 'Profesional'}
									</label>
									<label class={`ux-choice px-4 py-3 text-sm font-bold ${exceptionAppliesTo === 'business' ? 'ux-choice-active' : ''}`}>
										<input type="radio" value="business" bind:group={exceptionAppliesTo} class="mr-2 accent-[#7c3aed]" />
										Todo el consultorio
									</label>
								</div>
							</div>
							<div>
								<span class="ux-label">Tipo</span>
								<div class="mt-3 grid gap-2 sm:grid-cols-2">
									<label class={`ux-choice px-4 py-3 text-sm font-bold ${exceptionType === 'blocked' ? 'ux-choice-active' : ''}`}>
										<input type="radio" value="blocked" bind:group={exceptionType} class="mr-2 accent-[#7c3aed]" />
										Bloquear
									</label>
									<label class={`ux-choice px-4 py-3 text-sm font-bold ${exceptionType === 'extra_available' ? 'ux-choice-active' : ''}`}>
										<input type="radio" value="extra_available" bind:group={exceptionType} class="mr-2 accent-[#7c3aed]" />
										Sumar horario
									</label>
								</div>
							</div>
							{#if exceptionType === 'blocked'}
								<div>
									<span class="ux-label">Duración del bloqueo</span>
									<div class="mt-3 grid gap-2 sm:grid-cols-2">
										<button
											type="button"
											disabled={!canManage}
											aria-pressed={exceptionPeriodMode === 'single'}
											class={`ux-choice p-4 text-left ${exceptionPeriodMode === 'single' ? 'ux-choice-active' : ''}`}
											onclick={() => (exceptionPeriodMode = 'single')}
										>
											<span class="block font-bold text-white">Un día</span>
											<span class="mt-1 block text-xs text-white/50">Elegís fecha y horario.</span>
										</button>
										<button
											type="button"
											disabled={!canManage}
											aria-pressed={exceptionPeriodMode === 'range'}
											class={`ux-choice p-4 text-left ${exceptionPeriodMode === 'range' ? 'ux-choice-active' : ''}`}
											onclick={() => (exceptionPeriodMode = 'range')}
										>
											<span class="block font-bold text-white">Rango de días</span>
											<span class="mt-1 block text-xs text-white/50">Desde y hasta, días completos.</span>
										</button>
									</div>
								</div>
							{/if}
							{#if exceptionPeriodMode === 'single'}
								<div class="grid gap-4 sm:grid-cols-2">
									<label>
										<span class="ux-label">Fecha</span>
										<input type="date" bind:value={exceptionDate} disabled={!canManage} class="ux-input" />
									</label>
									<label>
										<span class="ux-label">Horario</span>
										<input type="text" placeholder="10 a 12" bind:value={exceptionTimeRange} onblur={normalizeExceptionTime} disabled={!canManage} class="ux-input" />
									</label>
								</div>
							{:else}
								<div class="grid gap-4 sm:grid-cols-2">
									<label>
										<span class="ux-label">Desde</span>
										<input type="date" bind:value={exceptionDateFrom} disabled={!canManage} class="ux-input" />
									</label>
									<label>
										<span class="ux-label">Hasta</span>
										<input type="date" min={exceptionDateFrom} bind:value={exceptionDateTo} disabled={!canManage} class="ux-input" />
									</label>
								</div>
								<p class="rounded-2xl border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-sm font-bold text-violet-100">
									Incluye ambos días completos. Los turnos ya agendados no se cancelan.
								</p>
							{/if}
							<label>
								<span class="ux-label">Motivo (opcional)</span>
								<input placeholder="Vacaciones, feriado…" bind:value={exceptionReason} disabled={!canManage} class="ux-input" />
							</label>
							{#if exceptionError}
								<p class="ux-alert">{exceptionError}</p>
							{/if}
						</div>
					</div>
				</div>
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else}
				<div class="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
					<p class="text-sm font-bold text-white/45">Email</p>
					<p class="mt-1 text-xl font-bold text-white">{email.trim().toLowerCase()}</p>
					<p class="mt-4 text-sm font-bold text-white/45">Rol asignado</p>
					<p class="mt-1 text-xl font-bold text-white">{roleLabels[role]}</p>
					{#if hasProfessionalProfile}
						<p class="mt-4 text-sm font-bold text-white/45">Perfil profesional</p>
						<p class="mt-1 text-xl font-bold text-white">
							{role === 'professional' ? 'Incluido por el rol Profesional' : 'También atiende pacientes'}
						</p>
						<p class="mt-4 text-sm font-bold text-white/45">Nombre</p>
						<p class="mt-1 text-xl font-bold text-white">{professionalName}</p>
						{#if professionalSpecialty.trim()}
							<p class="mt-4 text-sm font-bold text-white/45">Especialidad</p>
							<p class="mt-1 text-xl font-bold text-white">{professionalSpecialty}</p>
						{/if}
						<p class="mt-4 text-sm font-bold text-white/45">Servicios incluidos</p>
						<p class="mt-1 text-xl font-bold text-white">{(defaultServiceNames as readonly string[]).join(', ')}</p>
						{#if summaryAdditionalServices.length > 0}
							<p class="mt-4 text-sm font-bold text-white/45">Servicios adicionales</p>
							<p class="mt-1 text-xl font-bold text-white">{summaryAdditionalServices.join(', ')}</p>
						{/if}
						<p class="mt-4 text-sm font-bold text-white/45">Horarios habituales</p>
						<div class="mt-2 grid gap-2">
							{#each summaryScheduleBlocks as block, index}
								<div class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
									<p class="text-sm font-bold text-white/45">Bloque {index + 1}</p>
									<p class="mt-1 text-lg font-bold text-white">{block.days || 'Sin días'}</p>
									<p class="mt-1 text-sm font-bold text-white/65">
										{block.ranges || 'Sin horario'} · descanso {block.slotInterval} minutos
									</p>
								</div>
							{/each}
						</div>
						{#if hasExceptionLoaded}
							<p class="mt-4 text-sm font-bold text-white/45">Ausencia o cambio de horario</p>
							<p class="mt-1 text-xl font-bold text-white">
								{#if exceptionPeriodMode === 'range'}
									Bloquear del {formatDateKey(exceptionDateFrom)} al {formatDateKey(exceptionDateTo)} · Días completos
								{:else}
									{exceptionType === 'blocked' ? 'Bloquear' : 'Sumar horario'} · {formatDateKey(exceptionDate)} · {exceptionTimeRange}
								{/if}
								{exceptionAppliesTo === 'business' ? ' · Todo el consultorio' : ''}
								{exceptionReason.trim() ? ` · ${exceptionReason}` : ''}
							</p>
						{/if}
					{/if}
				</div>
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="submit" disabled={!canManage || wizardSubmitting} class="ux-btn-primary flex-1">
						{wizardSubmitting ? 'Guardando...' : 'Guardar rol'}
					</button>
				</div>
			{/if}
            </fieldset>
		</form>
