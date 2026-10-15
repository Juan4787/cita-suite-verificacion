<script lang="ts">
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { navigating } from '$app/stores';
	import { onDestroy, onMount } from 'svelte';
	import DismissibleNotice from '$lib/components/notices/DismissibleNotice.svelte';
	import OdontoRouteSkeleton from '$lib/components/skeleton/OdontoRouteSkeleton.svelte';
	import FollowUpsNotice from '$lib/components/seguimientos/FollowUpsNotice.svelte';
	import { createStalledNavigationRecovery } from '$lib/client/stalled-navigation-recovery';
	import { formatAccessRemaining, formatDateTime } from '$lib/utils/format';
	import { allowsRestrictedClinicalRead } from '$lib/utils/restricted-clinical-read';

	let { data, children } = $props();
	let mobileMenuOpen = $state(false);
	let showReportHelp = $state(false);
	let configMenuOpen = $state(false);
	let userMenuOpen = $state(false);
	let showSkeleton = $state(false);
	let mpSubmitting = $state(false);
	let shownAt = $state<number | null>(null);
	type SkeletonKind =
		| 'agenda'
		| 'agendaWeek'
		| 'appointments'
		| 'appointmentDetail'
		| 'availability'
		| 'config'
		| 'master'
		| 'patientDetail'
		| 'patients'
		| 'professionalDetail'
		| 'professionals'
		| 'services';
	let skeletonKind = $state<SkeletonKind>('patients');

	const SKELETON_DELAY_MS = 120;
	const SKELETON_MIN_VISIBLE_MS = 220;

	let showDelayTimer: ReturnType<typeof setTimeout> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let stalledNavigationRecovery: ReturnType<typeof createStalledNavigationRecovery> | null = null;

	type NavItem = {
		label: string;
		shortLabel?: string;
		href: string;
		activePrefixes?: string[];
		excludePrefixes?: string[];
	};

	const dailyNav: NavItem[] = [
		{ label: 'Agenda', href: '/odonto/agenda', activePrefixes: ['/odonto/agenda', '/odonto/turnos'] },
		{
			label: 'Turnos para recordar',
			shortLabel: 'Recordar',
			href: '/odonto/recordatorios',
			activePrefixes: ['/odonto/recordatorios']
		},
		{
			label: 'Seguimientos',
			shortLabel: 'Seguir',
			href: '/odonto/seguimientos',
			activePrefixes: ['/odonto/seguimientos']
		},
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] },
		{
			label: 'Configuración',
			href: '/odonto/configuracion',
			activePrefixes: ['/odonto/configuracion', '/odonto/profesionales', '/odonto/exportar-datos']
		}
	];

	const professionalNav: NavItem[] = [
        { label: 'Mis preguntas', href: '/odonto/mis-preguntas' },
		{ label: 'Mis turnos', href: '/odonto/mis-turnos', activePrefixes: ['/odonto/mis-turnos'] },
		{
			label: 'Seguimientos',
			shortLabel: 'Seguir',
			href: '/odonto/seguimientos',
			activePrefixes: ['/odonto/seguimientos']
		},
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] }
	];

	const readonlyNav: NavItem[] = [
		{ label: 'Agenda', href: '/odonto/agenda', activePrefixes: ['/odonto/agenda', '/odonto/turnos'] },
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] }
	];

	const baseConfigNav: NavItem[] = [
		{ label: 'Datos del consultorio', href: '/odonto/configuracion/negocio' },
		{ label: 'Equipo', href: '/odonto/configuracion/usuarios' },
		{ label: 'Suscripción', href: '/odonto/configuracion/suscripcion' },
		{ label: 'Reserva online', href: '/odonto/configuracion/reserva-online' },
		{ label: 'Reseña de Google', href: '/odonto/configuracion/resena-google' },
		{ label: 'Exportar datos', href: '/odonto/exportar-datos' },
		{ label: 'Ayuda', href: '/odonto/configuracion/ayuda' }
	];

	const activeBusiness = $derived(data?.activeBusiness);
	const isMasterPage = $derived($page.url.pathname.startsWith('/odonto/maestro'));
	const patientRevisionBusinessId = $derived(
		String(activeBusiness?.business?.id ?? '').trim()
	);
	const patientRevisionSyncEnabled = $derived(
		Boolean(
			patientRevisionBusinessId &&
				patientRevisionBusinessId !== 'demo-business' &&
				activeBusiness?.access?.canUseBusiness &&
				!isMasterPage
		)
	);
	const accountAssistance = $derived(data?.accountAssistance);
	const masterAssistanceRequests = $derived(data?.masterAssistanceRequests ?? []);
	const accountPendingManualSetup = $derived(Boolean(data?.pendingManualSetup && !activeBusiness));
	const isAssistingAccount = $derived(Boolean(activeBusiness?.assistance));
	const assistanceReturnTo = $derived(`${$page.url.pathname}${$page.url.search}`);
	const noticeViewerKey = $derived(
		encodeURIComponent(String(data?.email ?? 'usuario').trim().toLowerCase())
	);
	const businessNoticeStoragePrefix = $derived(
		`cita-suite:notice:v1:${noticeViewerKey}:${activeBusiness?.business?.id ?? 'sin-consultorio'}`
	);
	const masterAssistanceNoticeKey = $derived.by(() => {
		const grantIds = masterAssistanceRequests.map((request: any) => String(request.id)).sort();
		return `cita-suite:notice:v1:${noticeViewerKey}:master-assistance:${grantIds.join('.')}`;
	});
	const missingAddressNoticeKey = $derived(`${businessNoticeStoragePrefix}:missing-address`);
	const accountAssistanceNoticeKey = $derived.by(() => {
		const identity =
			accountAssistance?.status === 'active' && accountAssistance.grantId
				? `active-${accountAssistance.grantId}`
				: 'available';
		return `${businessNoticeStoragePrefix}:account-assistance:${identity}`;
	});
	const accountAssistanceTitle = $derived.by(() => {
		if (isAssistingAccount) return `Configurando ${activeBusiness?.business?.name ?? 'esta cuenta'}`;
		if (accountAssistance?.status === 'active') return 'Ayuda de Cita Suite activa';
		return '¿Querés que te ayudemos a configurar tu cuenta?';
	});
	const accountAssistanceMessage = $derived.by(() => {
		if (isAssistingAccount) {
			return `La autorización termina a las ${accountAssistance?.endsAtLabel ?? 'hora indicada'}. Al vencer, volverás automáticamente al panel maestro.`;
		}
		if (accountAssistance?.status === 'active') {
			return `Podemos configurar esta cuenta hasta las ${accountAssistance.endsAtLabel ?? 'hora indicada'}.`;
		}
		return 'Podemos ayudarte a cargar profesionales, servicios y horarios iniciales durante una hora.';
	});
	const canExportPatientDataNow = $derived(Boolean(data?.canExportPatientData));
	const configNav = $derived.by(() =>
		baseConfigNav.filter((item) => {
			if (data?.isMaster && item.href === '/odonto/configuracion/ayuda') return false;
			if (isAssistingAccount && item.href === '/odonto/configuracion/suscripcion') return false;
			if (item.href === '/odonto/exportar-datos' && !canExportPatientDataNow) return false;
			return true;
		})
	);
	const money = (value?: number | string | null) => {
		if (value === null || value === undefined || value === '') return 'ARS 0';
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return String(value);
		return parsed.toLocaleString('es-AR', {
			style: 'currency',
			currency: 'ARS',
			maximumFractionDigits: 0
		});
	};
	const commercialAccessRestricted = $derived.by(() => {
		const access = activeBusiness?.access;
		if (!access) return false;
		if ($page.url.pathname.startsWith('/odonto/maestro')) return false;
		return (
			!access.commercialAccessEnabled ||
			access.commercialStatus === 'restricted' ||
			access.commercialStatus === 'archived'
		);
	});
	const restrictedClinicalReadContext = $derived({
		role: activeBusiness?.role,
		commercialStatus: activeBusiness?.access?.commercialStatus,
		commercialAccessEnabled: activeBusiness?.access?.commercialAccessEnabled,
		canEnterApp: activeBusiness?.access?.canEnterApp
	});
	const restrictedClinicalReadAvailable = $derived.by(() =>
		allowsRestrictedClinicalRead('/odonto/pacientes', restrictedClinicalReadContext)
	);
	const restrictedClinicalReadRouteAllowed = $derived.by(() =>
		allowsRestrictedClinicalRead($page.url.pathname, {
			...restrictedClinicalReadContext
		})
	);
	const shouldShowMissingAddress = $derived.by(() => {
		if (isMasterPage || commercialAccessRestricted || !activeBusiness?.access?.canUseBusiness) return false;
		if (activeBusiness.role !== 'owner' && activeBusiness.role !== 'admin') return false;
		return !String(activeBusiness.business.address ?? '').trim();
	});
	const shouldShowAccountAssistanceNotice = $derived.by(() => {
		if (
			isMasterPage ||
			(data?.isMaster && !isAssistingAccount) ||
			commercialAccessRestricted ||
			accountPendingManualSetup ||
			!accountAssistance
		) {
			return false;
		}
		if (isAssistingAccount || accountAssistance.status === 'active') return true;
		const configuring = $page.url.pathname.startsWith('/odonto/configuracion') || $page.url.pathname.startsWith('/odonto/profesionales') || $page.url.pathname.startsWith('/odonto/mis-preguntas');
		return !configuring && Boolean(accountAssistance.canActivate);
	});
	const routeAllowsCommercialBypass = $derived.by(() => {
		if ($page.url.pathname.startsWith('/odonto/maestro')) return true;
		if ($page.url.pathname.startsWith('/odonto/pendiente')) return true;
		// La página de suscripción queda fuera del bloqueo: es el camino de
		// autoservicio para activar o volver a pagar con Mercado Pago.
		if ($page.url.pathname.startsWith('/odonto/configuracion/suscripcion')) return true;
		if ($page.url.pathname.startsWith('/odonto/pago/procesando')) return true;
		if (restrictedClinicalReadRouteAllowed) return true;
		return false;
	});
	const commercialLockActive = $derived(commercialAccessRestricted && !routeAllowsCommercialBypass);
	const canSelfServiceActivation = $derived.by(() => {
		const access = activeBusiness?.access;
		const role = activeBusiness?.role;
		return Boolean(
			access &&
				(role === 'owner' || role === 'admin') &&
				!access.isPermanent &&
				access.commercialAccessEnabled &&
				!access.archivedAt
		);
	});
	const isInitialActivation = $derived.by(() => {
		const access = activeBusiness?.access;
		const subscription = access?.subscription;
		return Boolean(
			access &&
				!access.isPermanent &&
				!access.paidUntil &&
				!subscription?.last_payment_at &&
				(access.commercialStatus === 'restricted' || access.commercialStatus === 'archived')
		);
	});
	const visibleNav = $derived.by(() => {
		if (isMasterPage) return [];
		if (!activeBusiness || accountPendingManualSetup) return [];
		if (commercialAccessRestricted) {
			if (!restrictedClinicalReadAvailable) return [];
			return [
				...dailyNav.filter((item) => item.label === 'Pacientes'),
				...(canExportPatientDataNow
					? [{ label: 'Exportar datos', href: '/odonto/exportar-datos' }]
					: [])
			];
		}
		if (activeBusiness?.role === 'professional') {
			return professionalNav;
		}
		if (activeBusiness?.role === 'readonly') {
			return readonlyNav;
		}
		if (activeBusiness?.role === 'reception') {
			return dailyNav.filter((item) => item.label !== 'Configuración');
		}
		return dailyNav;
	});

	const canShowConfigMenu = $derived(
		!isMasterPage &&
		!commercialAccessRestricted &&
			(activeBusiness?.role === 'owner' || activeBusiness?.role === 'admin')
	);
	const primaryMobileNav = $derived.by(() =>
		visibleNav.filter((item) => item.label !== 'Configuración')
	);

	const roleLabel = $derived.by(() => {
		const role = activeBusiness?.role;
		if (role === 'owner') return 'Dueño';
		if (role === 'admin') return 'Administrador';
		if (role === 'reception') return 'Recepción';
		if (role === 'professional') return 'Profesional';
		if (role === 'readonly') return 'Lectura';
		return 'Usuario';
	});

	const accessLabel = $derived.by(() => {
		const access = activeBusiness?.access;
		if (!access) return null;
		if (!access.commercialAccessEnabled) return 'Acceso pausado';
		if (access.visualStatus === 'permanent') return 'Permanente';
		if (access.visualStatus === 'expiring') {
			return formatAccessRemaining(access.paidUntil) ?? 'Vence pronto';
		}
		if (access.commercialStatus === 'grace') return 'Vencido';
		if (access.commercialStatus === 'restricted') return 'Activar';
		if (access.commercialStatus === 'archived') return 'Archivado';
		return null;
	});

	const accessTone = $derived.by(() => {
		const access = activeBusiness?.access;
		if (access?.commercialStatus === 'archived') {
			return 'danger';
		}
		if (!access?.commercialAccessEnabled || access?.commercialStatus === 'restricted') return 'warning';
		if (access?.commercialStatus === 'grace' || access?.visualStatus === 'expiring') return 'warning';
		return 'neutral';
	});

	const canSeeCommercialNotice = $derived.by(() => {
		const role = activeBusiness?.role;
		const access = activeBusiness?.access;
		if (!access) return false;
		if (access.commercialStatus === 'restricted' || access.commercialStatus === 'archived') return true;
		return role === 'owner' || role === 'admin';
	});

	const commercialNotice = $derived.by(() => {
		const access = activeBusiness?.access;
		if (isMasterPage || !access || !canSeeCommercialNotice) return null;
		if (!access.commercialAccessEnabled) return 'La cuenta no está disponible. Contactá soporte.';
		if (access.commercialStatus === 'archived') {
			return access.archivedAt
				? 'La cuenta está archivada. Contactá soporte para solicitar la reactivación.'
				: 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
		}
		if (access.commercialStatus === 'restricted') {
			return isInitialActivation
				? 'Tu cuenta ya está creada. Activá tu suscripción para comenzar a usar Cita Suite.'
				: 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
		}
		if (access.commercialStatus === 'grace') {
			return access.graceUntil
				? `La suscripción está vencida. Regularizá el pago antes del ${new Date(access.graceUntil).toLocaleString('es-AR')} para evitar restricciones operativas.`
				: 'La suscripción está vencida. Regularizá el pago para evitar restricciones operativas.';
		}
		if (access.visualStatus === 'expiring') {
			const deadline = formatDateTime(access.paidUntil, activeBusiness?.business?.timezone);
			const remaining = formatAccessRemaining(access.paidUntil);
			return deadline
				? `La suscripción vence el ${deadline}${remaining ? ` (${remaining.toLowerCase()})` : ''}. Regularizá el pago para evitar restricciones operativas.`
				: 'La suscripción vence pronto. Regularizá el pago para evitar restricciones operativas.';
		}
		return null;
	});

	const shouldShowAccessChip = $derived.by(() => {
		if (isMasterPage || !accessLabel || !canSeeCommercialNotice) return false;
		return activeBusiness?.access?.visualStatus !== 'active';
	});

	const isActive = (href: string) => $page.url.pathname.startsWith(href);
	const isNavItemActive = (item: NavItem) =>
		(item.activePrefixes ?? [item.href]).some((prefix) => $page.url.pathname.startsWith(prefix)) &&
		!(item.excludePrefixes ?? []).some((prefix) => $page.url.pathname.startsWith(prefix));

	const closeMenus = () => {
		configMenuOpen = false;
		userMenuOpen = false;
	};

	onMount(() => {
		const handleOutsideClick = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest('[data-menu-root]')) return;
			closeMenus();
		};

		document.addEventListener('pointerdown', handleOutsideClick, true);
		stalledNavigationRecovery = createStalledNavigationRecovery({
			isPending: (targetHref) => $navigating?.to?.url?.href === targetHref,
			recover: (targetHref) => {
				const target = new URL(targetHref);
				if (target.href === window.location.href) {
					window.location.reload();
					return;
				}
				window.location.assign(target.href);
			}
		});
		return () => {
			document.removeEventListener('pointerdown', handleOutsideClick, true);
			stalledNavigationRecovery?.clear();
			stalledNavigationRecovery = null;
		};
	});

	$effect(() => {
		const businessId = patientRevisionBusinessId;
		if (!patientRevisionSyncEnabled) return;

		let disposed = false;
		let stopSync: (() => void) | null = null;
		void import('$lib/client/patient-revision-sync')
			.then(({ startPatientRevisionSync }) => {
				if (disposed) return;
				stopSync = startPatientRevisionSync({
					businessId,
					onRevisionChanged: () => {
						// El sincronizador ya invalida la caché privada y la lista activa
						// observa ese estado. Reiniciar el router desde acá puede cancelar
						// la navegación que sigue a una escritura clínica.
					}
				});
			})
			.catch(() => {
				// La página conserva la verificación HTTP estricta aunque Realtime no cargue.
			});

		return () => {
			disposed = true;
			stopSync?.();
		};
	});

	$effect(() => {
		const key = missingAddressNoticeKey;
		const hasAddress = Boolean(String(activeBusiness?.business?.address ?? '').trim());
		if (!activeBusiness?.business?.id || !hasAddress) return;
		try {
			window.localStorage.removeItem(key);
		} catch {
			// Si storage está bloqueado, el estado visible de esta sesión igualmente es correcto.
		}
	});

	$effect(() => {
		const expiresAt =
			accountAssistance?.status === 'active' ? Date.parse(accountAssistance.expiresAt ?? '') : Number.NaN;
		if (!Number.isFinite(expiresAt)) return;
		const handleExpiration = () => {
			if (isAssistingAccount) {
				void goto('/odonto/maestro', { replaceState: true, invalidateAll: true });
				return;
			}
			void invalidate('app:odonto-shell');
		};
		const delay = expiresAt - Date.now();
		if (delay <= 0) {
			queueMicrotask(handleExpiration);
			return;
		}
		const timer = window.setTimeout(handleExpiration, delay + 50);
		return () => window.clearTimeout(timer);
	});

	$effect(() => {
		const expirations = masterAssistanceRequests
			.map((request: any) => Date.parse(String(request.expiresAt ?? '')))
			.filter((value: number) => Number.isFinite(value) && value > Date.now());
		if (expirations.length === 0) return;
		const timer = window.setTimeout(
			() => void invalidate('app:odonto-shell'),
			Math.max(0, Math.min(...expirations) - Date.now()) + 50
		);
		return () => window.clearTimeout(timer);
	});

	const mobileTitle = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/odonto/pacientes/') && $page.data?.patient?.full_name) {
			return $page.data.patient.full_name;
		}
		if (path.startsWith('/odonto/agenda')) return 'Agenda';
		if (path.startsWith('/odonto/pacientes')) return 'Pacientes';
		if (path.startsWith('/odonto/exportar-datos')) return 'Exportar datos';
		if (path.startsWith('/odonto/configuracion/usuarios')) return 'Equipo';
		if (path.startsWith('/odonto/configuracion/ayuda')) return 'Ayuda';
		if (path.startsWith('/odonto/profesionales')) return 'Equipo';
		if (path.startsWith('/odonto/servicios')) return 'Equipo';
		if (path.startsWith('/odonto/disponibilidad')) return 'Equipo';
		if (path.startsWith('/odonto/seguimientos')) return 'Seguimientos';
		if (path.startsWith('/odonto/recordatorios')) return 'Turnos para recordar';
		if (path.startsWith('/odonto/mensajes')) return 'Comunicación';
		if (path.startsWith('/odonto/mis-turnos')) return 'Mis turnos';
		if (path.startsWith('/odonto/configuracion')) return 'Configuración';
		if (path.startsWith('/odonto/maestro')) return 'Panel maestro';
		return 'Odontología';
	});

	const showBack = $derived.by(() => {
		const path = $page.url.pathname;
		return path !== '/odonto/pacientes' && path.startsWith('/odonto');
	});
	const mobileBackHref = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/odonto/turnos/')) return '/odonto/agenda';
		if (path.startsWith('/odonto/agenda/semana')) return '/odonto/agenda';
		if (path.startsWith('/odonto/pacientes/')) return '/odonto/pacientes';
		if (path.startsWith('/odonto/exportar-datos')) return '/odonto/pacientes';
		if (path.startsWith('/odonto/seguimientos/importantes')) return '/odonto/seguimientos';
		if (path.startsWith('/odonto/profesionales/')) return '/odonto/configuracion/usuarios';
		if (path.startsWith('/odonto/configuracion/usuarios')) return '/odonto/agenda';
		if (path.startsWith('/odonto/configuracion/')) return '/odonto/configuracion';
		if (path.startsWith('/odonto/maestro')) return '/odonto/agenda';
		if (path.startsWith('/odonto/mis-turnos')) return '/odonto/agenda';
		return '/odonto/agenda';
	});

	const resolveSkeletonKind = (routeId: string | null | undefined, path: string) => {
		if (routeId === '/odonto/agenda/semana') return 'agendaWeek';
		if (routeId === '/odonto/agenda') return 'agenda';
		if (routeId === '/odonto/turnos/[appointmentId]') return 'appointmentDetail';
		if (routeId === '/odonto/mis-turnos') return 'appointments';
		if (routeId === '/odonto/seguimientos') return 'config';
		if (routeId === '/odonto/seguimientos/importantes') return 'config';
		if (routeId === '/odonto/recordatorios') return 'config';
		if (routeId === '/odonto/mensajes') return 'config';
		if (routeId === '/odonto/disponibilidad') return 'availability';
		if (routeId === '/odonto/servicios') return 'services';
		if (routeId === '/odonto/profesionales/[professionalId]') return 'professionalDetail';
		if (routeId === '/odonto/profesionales') return 'professionals';
		if (routeId === '/odonto/pacientes/[id]') return 'patientDetail';
		if (routeId === '/odonto/configuracion') return 'config';
		if (routeId === '/odonto/exportar-datos') return 'config';
		if (routeId === '/odonto/maestro') return 'master';
		if (routeId === '/odonto/pacientes') return 'patients';
		if (path.startsWith('/odonto/agenda/semana')) return 'agendaWeek';
		if (path.startsWith('/odonto/agenda')) return 'agenda';
		if (path.startsWith('/odonto/turnos/')) return 'appointmentDetail';
		if (path.startsWith('/odonto/mis-turnos')) return 'appointments';
		if (path.startsWith('/odonto/seguimientos')) return 'config';
		if (path.startsWith('/odonto/recordatorios')) return 'config';
		if (path.startsWith('/odonto/mensajes')) return 'config';
		if (path.startsWith('/odonto/disponibilidad')) return 'availability';
		if (path.startsWith('/odonto/servicios')) return 'services';
		if (path.startsWith('/odonto/profesionales/')) return 'professionalDetail';
		if (path.startsWith('/odonto/profesionales')) return 'professionals';
		if (path.startsWith('/odonto/pacientes/')) return 'patientDetail';
		if (path.startsWith('/odonto/configuracion')) return 'config';
		if (path.startsWith('/odonto/exportar-datos')) return 'config';
		if (path.startsWith('/odonto/maestro')) return 'master';
		return 'patients';
	};

	const clearShowDelay = () => {
		if (!showDelayTimer) return;
		clearTimeout(showDelayTimer);
		showDelayTimer = null;
	};

	const clearHideDelay = () => {
		if (!hideTimer) return;
		clearTimeout(hideTimer);
		hideTimer = null;
	};

	const scheduleShowSkeleton = (kind: SkeletonKind) => {
		skeletonKind = kind;
		clearHideDelay();
		if (showSkeleton) return;
		clearShowDelay();
		showDelayTimer = setTimeout(() => {
			showSkeleton = true;
			shownAt = Date.now();
			showDelayTimer = null;
		}, SKELETON_DELAY_MS);
	};

	const scheduleHideSkeleton = () => {
		clearShowDelay();
		if (!showSkeleton) return;
		const elapsed = shownAt ? Date.now() - shownAt : 0;
		const wait = Math.max(SKELETON_MIN_VISIBLE_MS - elapsed, 0);
		clearHideDelay();
		hideTimer = setTimeout(() => {
			showSkeleton = false;
			shownAt = null;
			hideTimer = null;
		}, wait);
	};

	$effect(() => {
		const navState = $navigating;
		const targetPath = navState?.to?.url?.pathname ?? '';
		const targetHref = navState?.to?.url?.href ?? '';
		if (targetPath.startsWith('/odonto') && targetHref) {
			const kind = resolveSkeletonKind(navState?.to?.route?.id, targetPath);
			scheduleShowSkeleton(kind);
			stalledNavigationRecovery?.schedule(targetHref);
		} else {
			scheduleHideSkeleton();
			stalledNavigationRecovery?.clear();
		}
	});

	onDestroy(() => {
		clearShowDelay();
		clearHideDelay();
		stalledNavigationRecovery?.clear();
	});
</script>

<div class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-[#eaf1ff]">
	<header class="sticky top-0 z-40 border-b border-neutral-100 bg-white/95 dark:border-[#1f2b45] dark:bg-[#0f1f36]/95">
		<div class="flex h-14 items-center gap-2 px-3 md:hidden">
			{#if showBack}
				<a
					href={mobileBackHref}
					class="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#13243d]"
					aria-label="Volver"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
					</svg>
				</a>
			{:else}
				<button
					type="button"
					class="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#13243d]"
					aria-label="Abrir menú"
					onclick={() => (mobileMenuOpen = true)}
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16" />
					</svg>
				</button>
			{/if}
			<h1 class="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900 dark:text-white">
				{mobileTitle}
			</h1>
			{#if showBack}
				<button
					type="button"
					class="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#13243d]"
					aria-label="Abrir menú"
					onclick={() => (mobileMenuOpen = true)}
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16" />
					</svg>
				</button>
			{:else}
				<span class="h-11 w-11 shrink-0" aria-hidden="true"></span>
			{/if}
		</div>
		{#if mobileMenuOpen}
			<div class="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 px-3 py-3 md:hidden">
				<div
					class="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-neutral-100 bg-white text-neutral-900 shadow-2xl dark:border-white/10 dark:bg-[#0f1f36] dark:text-white"
					role="dialog"
					aria-modal="true"
					aria-label="Menú de navegación"
				>
					<div class="flex items-center justify-between px-4 pt-4">
						<p class="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Menú</p>
						<button
							type="button"
							class="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10"
							onclick={() => {
								mobileMenuOpen = false;
								showReportHelp = false;
							}}
							aria-label="Cerrar menú"
						>
							<span aria-hidden="true">×</span>
						</button>
					</div>
					{#if isMasterPage}
						<div class="mx-4 mt-4 rounded-xl border border-violet-300/25 bg-violet-500/10 px-4 py-3 text-sm">
							<p class="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-200/70">Modo actual</p>
							<p class="mt-1 font-semibold text-neutral-900 dark:text-white">Administración Cita Suite</p>
						</div>
					{:else if activeBusiness?.business}
						<div class="mx-4 mt-4 rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-white/10">
							<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
								Consultorio activo
							</p>
							<p class="mt-1 font-semibold text-neutral-900 dark:text-white">
								{activeBusiness.business.name}
							</p>
						</div>
					{/if}
					<nav class="mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-3">
						<div class="flex flex-col gap-2">
							{#if primaryMobileNav.length > 0}
								<p class="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
									Trabajo diario
								</p>
								{#each primaryMobileNav as item}
									<a
										href={item.href}
										class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
											isNavItemActive(item)
												? 'bg-[#7c3aed] text-white'
												: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
										}`}
										onclick={() => {
											mobileMenuOpen = false;
											closeMenus();
										}}
									>
										{item.label}
									</a>
								{/each}
							{/if}
						{#if canShowConfigMenu}
							<p class="mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
								Configuración
							</p>
							{#each configNav as item}
								<a
									href={item.href}
									class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
										isNavItemActive(item)
											? 'bg-[#7c3aed] text-white'
											: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
									}`}
									onclick={() => {
										mobileMenuOpen = false;
										closeMenus();
									}}
								>
									{item.label}
								</a>
							{/each}
						{/if}
						<p class="mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
							Cuenta
						</p>
						{#if activeBusiness?.role !== 'professional'}
							<a
								href="/odonto/mis-turnos"
								class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/mis-turnos')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
								}`}
								onclick={() => {
									mobileMenuOpen = false;
									closeMenus();
								}}
							>
								Mis turnos
							</a>
						{/if}
						{#if data?.isMaster}
							<a
								href="/odonto/maestro"
								class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/maestro')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
								}`}
								onclick={() => {
									mobileMenuOpen = false;
									closeMenus();
								}}
							>
								Panel maestro
							</a>
						{/if}
						</div>
					</nav>
					<div class="border-t border-neutral-200 p-4 dark:border-white/10">
						<button
							type="button"
							class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10"
							onclick={() => (showReportHelp = !showReportHelp)}
						>
							Reportar problema
						</button>
						{#if showReportHelp}
							<div class="mt-3 rounded-xl border border-red-400/30 bg-[#430a0a] p-3 text-xs text-white">
								<p class="font-semibold">Soporte</p>
								<p>
									Para reportar errores, escribí a
									<span class="font-semibold">juanpabloaltamira@protonmail.com</span>.
								</p>
							</div>
						{/if}
						<form method="POST" action="/logout" class="mt-3">
							<button
								type="submit"
								class="block w-full rounded-xl bg-neutral-900 px-4 py-3 text-center text-sm font-semibold text-white dark:bg-white dark:text-neutral-900"
							>
								Salir
							</button>
						</form>
					</div>
				</div>
				<button
					type="button"
					class="absolute inset-0 z-0"
					aria-label="Cerrar menú"
					onclick={() => {
						mobileMenuOpen = false;
						showReportHelp = false;
					}}
				></button>
			</div>
		{/if}
		<div class="mx-auto hidden max-w-7xl items-center justify-between gap-6 px-6 py-4 md:flex">
			<div class="flex min-w-0 items-center gap-3">
				<picture>
					<img
						src="/logo-cita-suite.png"
						alt="Cita Suite"
						class="h-14 w-14 shrink-0 rounded-2xl"
						width="56"
						height="56"
						loading="eager"
						decoding="async"
					/>
				</picture>
				{#if isMasterPage}
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-neutral-900 dark:text-white">Administración Cita Suite</p>
					</div>
				{:else if activeBusiness?.business}
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-neutral-900 dark:text-white">
							{activeBusiness.business.name}
						</p>
					</div>
				{/if}
			</div>
			<nav
				class="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm font-semibold"
				data-sveltekit-preload-code="viewport"
			>
				{#each visibleNav as item}
					{#if item.label === 'Configuración' && canShowConfigMenu}
							<div class="relative" data-menu-root>
							<button
								type="button"
								class={`group rounded-2xl px-4 py-3 transition-all duration-200 ${
									isNavItemActive(item)
										? 'bg-[#7c3aed]/90 text-white shadow-sm shadow-[#7c3aed]/20'
										: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
								}`}
								aria-haspopup="menu"
								aria-expanded={configMenuOpen}
								onclick={() => {
									configMenuOpen = !configMenuOpen;
									userMenuOpen = false;
								}}
							>
								<span
									class={`inline-block transition-colors duration-200 ${
										isNavItemActive(item)
											? 'text-white'
											: 'group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]'
									}`}
								>
									{item.label}
								</span>
							</button>
							{#if configMenuOpen}
								<div
									class="absolute left-1/2 top-full z-30 mt-3 w-64 -translate-x-1/2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#101f35] dark:shadow-black/40"
									role="menu"
								>
									{#each configNav as configItem}
										<a
											href={configItem.href}
											data-sveltekit-preload-data="hover"
											class={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${
												isNavItemActive(configItem)
													? 'bg-[#7c3aed] text-white'
													: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
											}`}
											role="menuitem"
											onclick={closeMenus}
										>
											{configItem.label}
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<a
							href={item.href}
							data-sveltekit-preload-data="hover"
							class={`group rounded-2xl px-4 py-3 transition-all duration-200 ${
								isNavItemActive(item)
									? 'bg-[#7c3aed]/90 text-white shadow-sm shadow-[#7c3aed]/20'
									: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
							}`}
						>
							<span
								class={`inline-block transition-colors duration-200 ${
									isNavItemActive(item)
										? 'text-white'
										: 'group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]'
								}`}
							>
								{item.label}
							</span>
						</a>
					{/if}
				{/each}
			</nav>
				<div class="relative flex min-w-0 justify-end" data-menu-root>
				<button
					type="button"
					class="flex max-w-64 items-center gap-3 rounded-2xl border border-neutral-200 bg-white/70 px-3 py-2 text-left shadow-sm transition hover:border-[#7c3aed]/40 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
					aria-haspopup="menu"
					aria-expanded={userMenuOpen}
					onclick={() => {
						userMenuOpen = !userMenuOpen;
						configMenuOpen = false;
					}}
				>
					<picture>
						<img
							src="/logo-cita-suite.png"
							alt=""
							class="h-10 w-10 shrink-0 rounded-xl"
							width="40"
							height="40"
							loading="eager"
							decoding="async"
						/>
					</picture>
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold text-neutral-900 dark:text-white">
								{isMasterPage ? 'Panel maestro' : (activeBusiness?.business?.name ?? 'Cuenta')}
							</span>
						<span class="flex items-center gap-2 truncate text-xs text-neutral-500 dark:text-neutral-300">
							<span>{isMasterPage ? 'Administrador del sistema' : roleLabel}</span>
							{#if shouldShowAccessChip}
								<span
									class={`rounded-full px-2 py-0.5 text-[10px] font-black ${
										accessTone === 'danger'
											? 'bg-red-500/15 text-red-200'
											: accessTone === 'warning'
												? 'bg-amber-400/15 text-amber-100'
												: 'bg-white/10 text-white/70'
									}`}
								>
									{accessLabel}
								</span>
							{/if}
						</span>
						</span>
					<svg class="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
					</svg>
				</button>
				{#if userMenuOpen}
					<div
						class="absolute right-0 top-full z-30 mt-3 w-64 rounded-2xl border border-neutral-200 bg-white p-2 shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#101f35] dark:shadow-black/40"
						role="menu"
					>
						{#if activeBusiness?.role !== 'professional'}
							<a
								href="/odonto/mis-turnos"
								class={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/mis-turnos')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
								}`}
								role="menuitem"
								onclick={closeMenus}
							>
								Mis turnos
							</a>
						{/if}
						{#if data?.isMaster}
							<a
								href="/odonto/maestro"
								class={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/maestro')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
								}`}
								role="menuitem"
								onclick={closeMenus}
							>
								Panel maestro
							</a>
						{/if}
						<div class="my-2 border-t border-neutral-200 dark:border-white/10"></div>
						<form method="POST" action="/logout">
							<button
								type="submit"
								class="block w-full rounded-xl px-4 py-3 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 dark:text-red-200 dark:hover:bg-red-500/10"
								role="menuitem"
							>
								Salir
							</button>
						</form>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 pt-6 pb-28 md:pb-6" aria-busy={showSkeleton}>
		{#if data?.businessError}
			<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100">
				{data.businessError}
			</div>
		{/if}
		{#if (commercialNotice && !commercialAccessRestricted) || masterAssistanceRequests.length > 0 || shouldShowMissingAddress || shouldShowAccountAssistanceNotice || (!commercialAccessRestricted && data?.followUps?.count > 0)}
			<div class="mb-6 grid gap-3" aria-label="Avisos importantes">
				{#if commercialNotice && !commercialAccessRestricted}
					<div
						class={`rounded-2xl border px-4 py-3 text-sm font-bold ${
							accessTone === 'danger'
								? 'border-red-300 bg-red-50 text-red-900 dark:border-red-300/60 dark:bg-red-200 dark:text-red-950'
								: 'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-200/70 dark:bg-amber-200 dark:text-amber-950'
						}`}
					>
						{commercialNotice}
					</div>
				{/if}

				{#if masterAssistanceRequests.length > 0}
					<DismissibleNotice
						storageKey={masterAssistanceNoticeKey}
						eyebrow="Panel maestro"
						title={masterAssistanceRequests.length === 1
							? '1 consultorio pidió ayuda para configurar'
							: `${masterAssistanceRequests.length} consultorios pidieron ayuda para configurar`}
						message="Sólo aparecen las solicitudes cuya autorización de una hora sigue vigente."
						tone="info"
					>
						<div class="mt-3 grid gap-2 lg:grid-cols-2">
							{#each masterAssistanceRequests as request (request.id)}
								<div class="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
									<div class="min-w-0">
										<p class="truncate font-black text-white">{request.businessName}</p>
										<p class="mt-1 text-xs font-bold text-emerald-200">
											{formatAccessRemaining(request.expiresAt) ?? 'La autorización vence pronto'}
										</p>
									</div>
									<form method="post" action="/odonto/maestro?/enter_assisted_business" class="shrink-0">
										<input type="hidden" name="grant_id" value={request.id} />
										<input type="hidden" name="business_id" value={request.businessId} />
										<button class="ux-btn-primary w-full px-4 py-2 text-sm sm:w-auto">Abrir</button>
									</form>
								</div>
							{/each}
						</div>
						<a href="/odonto/maestro#solicitudes-ayuda" class="mt-3 inline-flex text-sm font-black text-violet-200 hover:text-white">
							Ver en el panel maestro
						</a>
					</DismissibleNotice>
				{/if}

				{#if shouldShowMissingAddress}
					<DismissibleNotice
						storageKey={missingAddressNoticeKey}
						eyebrow="Datos visibles"
						title="Falta la dirección del consultorio."
						message={'Los pacientes no van a saber dónde asistir al turno. Cargala en "Datos visibles" y guardá.'}
						tone="warning"
					>
						<a href="/odonto/configuracion/negocio#datos-visibles" class="ux-btn-secondary mt-3 inline-flex px-4 py-2 text-sm">
							Cargar dirección
						</a>
					</DismissibleNotice>
				{/if}

				{#if shouldShowAccountAssistanceNotice}
					<DismissibleNotice
						storageKey={accountAssistanceNoticeKey}
						eyebrow={isAssistingAccount ? 'Asistencia temporal' : 'Ayuda para configurar'}
						title={accountAssistanceTitle}
						message={accountAssistanceMessage}
						tone={accountAssistance?.status === 'active' ? 'success' : 'neutral'}
					>
						<div class="mt-3 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
							{#if isAssistingAccount}
								<a href="/odonto/maestro" class="ux-btn-secondary w-full px-4 py-2 text-center text-sm sm:w-auto">Volver al panel maestro</a>
							{:else if accountAssistance?.status === 'active'}
								<form method="post" action="/odonto/configuracion/ayuda?/revoke" class="w-full sm:w-auto">
									<input type="hidden" name="return_to" value={assistanceReturnTo} />
									<button class="ux-btn-secondary w-full px-4 py-2 text-sm sm:w-auto">Detener ayuda</button>
								</form>
							{:else}
								<form method="post" action="/odonto/configuracion/ayuda?/activate" class="w-full sm:w-auto">
									<input type="hidden" name="return_to" value={assistanceReturnTo} />
									<button class="ux-btn-primary w-full px-4 py-2 text-sm sm:w-auto">Quiero ayuda por 1 hora</button>
								</form>
							{/if}
							{#if !isAssistingAccount}
								<a href="/odonto/configuracion/ayuda" class="ux-btn-secondary w-full px-4 py-2 text-center text-sm sm:w-auto">Ver detalle</a>
							{/if}
						</div>
					</DismissibleNotice>
				{/if}

				{#if !commercialAccessRestricted && data?.followUps?.count > 0}
					<FollowUpsNotice
						notice={data.followUps}
						todayISO={data.followUpsTodayISO}
						storageKeyPrefix={businessNoticeStoragePrefix}
					/>
				{/if}
			</div>
		{/if}
		{#if commercialLockActive}
			<section class="mx-auto mt-8 max-w-2xl rounded-3xl border border-amber-300/40 bg-amber-400/12 p-8 text-center shadow-2xl shadow-amber-950/10 dark:border-amber-400/25 dark:bg-amber-400/10">
				<p class="mx-auto inline-flex rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-900 dark:text-amber-100">
					Cita Suite
				</p>
				<h1 class="mt-5 text-3xl font-black text-neutral-950 dark:text-white">
					{isInitialActivation ? 'Activá tu suscripción' : 'Tu acceso a Cita Suite venció'}
				</h1>
				<p class="mx-auto mt-3 max-w-lg text-base font-semibold text-neutral-700 dark:text-amber-50/80">
					{#if isInitialActivation}
						Tu cuenta ya está creada. Activá tu suscripción para comenzar a gestionar turnos, pacientes y tu agenda.
					{:else}
						Tu agenda, pacientes y configuración siguen guardados. Activá tu suscripción para volver a usar Cita Suite.
					{/if}
				</p>
				{#if canExportPatientDataNow}
					<div class="mx-auto mt-6 max-w-lg rounded-2xl border border-teal-300/45 bg-teal-50/80 p-4 text-left dark:border-teal-300/25 dark:bg-teal-400/10">
						<p class="text-sm font-bold text-teal-950 dark:text-teal-100">Tus datos siguen disponibles</p>
						<p class="mt-1 text-sm font-medium text-teal-900/80 dark:text-teal-50/75">
							Podés llevarte pacientes, historial clínico, turnos y seguimientos en un archivo Excel.
						</p>
						<a
							href="/odonto/exportar-datos"
							class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-center text-sm font-bold text-white shadow-sm transition hover:bg-teal-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 sm:w-auto"
						>
							Exportar mis datos en Excel
						</a>
					</div>
				{/if}
				{#if canSelfServiceActivation}
					<div class="mx-auto mt-6 max-w-sm rounded-2xl border border-amber-300/30 bg-white/70 p-4 text-left shadow-sm dark:bg-[#13243d]/70">
						<p class="text-sm font-black text-amber-950 dark:text-amber-100">Cita Suite</p>
						<p class="mt-1 text-2xl font-black text-neutral-950 dark:text-white">{money(data?.mpAmount)} por mes</p>
						<p class="mt-2 text-sm font-semibold text-neutral-700 dark:text-amber-50/75">
							Serás redirigido a Mercado Pago para completar el pago de forma segura.
						</p>
					</div>
					<!-- Vencimiento o activación inicial pagable: el CTA inicia Mercado Pago, no una página intermedia. -->
					<form
						method="POST"
						action="/odonto/configuracion/suscripcion?/subscribe"
						class="mt-6"
						onsubmit={() => (mpSubmitting = true)}
						aria-busy={mpSubmitting}
					>
						<button
							type="submit"
							disabled={mpSubmitting}
							class="inline-flex items-center justify-center rounded-2xl bg-amber-400 px-6 py-3 text-sm font-black text-amber-950 shadow-lg transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
						>
							{mpSubmitting ? 'Creando enlace seguro en Mercado Pago…' : 'Activar suscripción con Mercado Pago'}
						</button>
						{#if mpSubmitting}
							<p class="mt-3 text-sm font-semibold text-neutral-700 dark:text-amber-50/80">
								Esto puede tardar unos segundos. No cierres esta ventana ni vuelvas a tocar el botón.
							</p>
						{/if}
					</form>
				{:else if activeBusiness?.role === 'owner' || activeBusiness?.role === 'admin'}
					<!-- Kill-switch del administrador: un pago NO reactiva (lo manual
					     gana); prometer autoservicio acá sería cobrar sin servicio. -->
					<p class="mt-6 rounded-2xl border border-amber-300/35 bg-white/70 px-4 py-3 text-sm font-bold text-amber-950 dark:bg-[#13243d]/70 dark:text-amber-100">
						El acceso fue suspendido por el administrador del sistema. Contactá a soporte
						para regularizar; un pago no lo reactiva automáticamente.
					</p>
				{:else}
					<p class="mt-6 rounded-2xl border border-amber-300/35 bg-white/70 px-4 py-3 text-sm font-bold text-amber-950 dark:bg-[#13243d]/70 dark:text-amber-100">
						Contactá al responsable del consultorio.
					</p>
				{/if}
				<p class="mt-5 text-sm font-semibold text-neutral-600 dark:text-amber-50/70">
					¿Necesitás ayuda? Contactar soporte
				</p>
			</section>
		{:else if accountPendingManualSetup}
			<section class="mx-auto mt-8 max-w-2xl rounded-3xl border border-sky-300/35 bg-sky-400/10 p-8 text-center shadow-2xl shadow-sky-950/10 dark:border-sky-300/25">
				<p class="mx-auto inline-flex rounded-full bg-sky-300/15 px-3 py-1 text-xs font-black uppercase tracking-wide text-sky-900 dark:text-sky-100">
					Cita Suite
				</p>
				<h1 class="mt-5 text-3xl font-black text-neutral-950 dark:text-white">
					Estamos configurando tu consultorio
				</h1>
				<p class="mx-auto mt-3 max-w-lg text-base font-semibold text-neutral-700 dark:text-sky-50/80">
					Tu cuenta ya está creada y tu email está habilitado. Falta que soporte cree o vincule
					el consultorio que vas a usar.
				</p>
				<div class="mx-auto mt-6 max-w-sm rounded-2xl border border-sky-300/30 bg-white/70 p-4 text-left shadow-sm dark:bg-[#13243d]/70">
					<p class="text-sm font-black text-sky-950 dark:text-sky-100">Sin pago pendiente</p>
					<p class="mt-2 text-sm font-semibold text-neutral-700 dark:text-sky-50/75">
						Esta alta está en modo manual. No te vamos a enviar a Mercado Pago hasta que el
						consultorio exista y el flujo comercial corresponda.
					</p>
				</div>
				<p class="mt-5 text-sm font-semibold text-neutral-600 dark:text-sky-50/70">
					¿Necesitás ayuda? Contactar soporte
				</p>
			</section>
		{:else if showSkeleton}
			<OdontoRouteSkeleton kind={skeletonKind} />
		{:else}
			{@render children()}
		{/if}
	</main>

	{#snippet navIcon(label: string)}
		<svg class="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
			{#if label === 'Agenda'}
				<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
				<path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
			{:else if label === 'Pacientes'}
				<circle cx="9" cy="8" r="3.1" />
				<path d="M3.8 19v-1.3A3.7 3.7 0 0 1 7.5 14h3a3.7 3.7 0 0 1 3.7 3.7V19" />
				<path d="M16 5.3a3 3 0 0 1 0 5.8M20.2 19v-1.3a3.5 3.5 0 0 0-2.6-3.3" />
			{:else if label === 'Equipo'}
				<rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
				<circle cx="12" cy="9.8" r="2.4" />
				<path d="M8.2 16.6a3.8 3.8 0 0 1 7.6 0" />
			{:else if label === 'Mis turnos'}
				<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
				<path d="M3.5 9.5h17M8 3.5v3M16 3.5v3M9 14.7l2 2 4-4" />
			{:else if label === 'Turnos para recordar'}
				<path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 8-2.5 8h17s-2.5-2-2.5-8" />
				<path d="M13.7 20.5a2 2 0 0 1-3.4 0" />
			{:else if label === 'Seguimientos'}
				<rect x="4.5" y="4.5" width="15" height="16" rx="2.5" />
				<path d="M9 4.5h6v2.5H9z" />
				<path d="M8.5 12.5l2.2 2.2 4.8-4.8" />
			{:else}
				<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
				<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
				<circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
			{/if}
		</svg>
	{/snippet}

	{#if !commercialAccessRestricted && primaryMobileNav.length > 0}
		<nav
			class="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b1d32]/95 backdrop-blur md:hidden"
			style="padding-bottom: env(safe-area-inset-bottom);"
			aria-label="Navegación principal"
			data-sveltekit-preload-code="viewport"
		>
			<div class="mx-auto flex max-w-md items-stretch">
				{#each primaryMobileNav as item}
					<a
						href={item.href}
						aria-current={isNavItemActive(item) ? 'page' : undefined}
						aria-label={item.label}
						class={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-bold transition ${
							isNavItemActive(item) ? 'text-white' : 'text-white/70'
						}`}
					>
						<span
							class={`flex h-8 w-14 items-center justify-center rounded-full transition ${
								isNavItemActive(item) ? 'bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30' : 'bg-white/5'
							}`}
						>
							{@render navIcon(item.label)}
						</span>
						<span class="max-w-full truncate">{item.shortLabel ?? item.label}</span>
					</a>
				{/each}
				<button
					type="button"
					onclick={() => (mobileMenuOpen = true)}
					class="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-bold text-white/70 transition"
					aria-label="Abrir menú"
				>
					<span class="flex h-8 w-14 items-center justify-center rounded-full bg-white/5">
						{@render navIcon('mas')}
					</span>
					<span>Más</span>
				</button>
			</div>
		</nav>
	{/if}
</div>
