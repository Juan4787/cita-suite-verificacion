<script lang="ts">
 import {formatQuotedPrice} from '$lib/booking/pricing';
    import BookingAppearance from '$lib/booking/BookingAppearance.svelte';
    import BookingFrameBridge from '$lib/booking/BookingFrameBridge.svelte';
    import { formatInTimeZone } from '$lib/utils/format';
    import { BOOKING_MODALITY_LABELS } from '@turnos-saas/shared/booking-integration';
    let { data } = $props();
    const appointment = $derived(data.appointment);
</script>

<svelte:head><title>Tu turno · {appointment.business.name}</title></svelte:head>
<BookingAppearance theme={data.theme}>
    {#if data.embed}<BookingFrameBridge context={data.embed} completed={true} />{/if}
    <main class="min-h-screen bg-[#06111f] px-4 py-5 text-white sm:py-8">{#if data.appointment.price_quote_snapshot}<section class="ux-card mb-5"><h2 class="ux-section-title">Arancel registrado al reservar</h2><p class="mt-2 font-bold">{formatQuotedPrice(data.appointment.price_quote_snapshot)}</p></section>{/if}{#if data.appointment.patient_instructions_snapshot}<section class="ux-card mb-5"><h2 class="ux-section-title">Indicaciones para tu turno</h2><p class="mt-2 whitespace-pre-wrap break-words">{data.appointment.patient_instructions_snapshot}</p></section>{/if}
        <div class="mx-auto flex max-w-3xl flex-col gap-4">
            <section class="ux-card">
                <p class="ux-badge">{appointment.public_status_label}</p>
                <h1 class="ux-title mt-4">{appointment.status === 'cancelled' ? 'Este turno está cancelado' : appointment.is_past ? 'Tu turno' : data.recovered ? 'Recuperamos tu reserva' : 'Tu turno quedó reservado'}</h1>
                <p class="ux-subtitle mt-3">{formatInTimeZone(appointment.starts_at, appointment.business.timezone).full} h</p>
                <p class="mt-2">Horario local del consultorio.</p>
                {#if appointment.patient_name}<p class="mt-2">Reserva para {appointment.patient_name}.</p>{/if}
                <p class="mt-4">{appointment.service_name_snapshot} · {appointment.professional_name_snapshot}</p>
                {#if appointment.booking_context}<p class="mt-2">{BOOKING_MODALITY_LABELS[appointment.booking_context.modality]}</p>{/if}
                {#if appointment.business.address}<p class="mt-4">{appointment.business.address}</p>{/if}
                {#if appointment.business.address_instructions}<p class="mt-2">{appointment.business.address_instructions}</p>{/if}
                <a class="ux-btn-primary mt-5 inline-flex w-full justify-center" href={'/turno/' + appointment.token} target="_blank" rel="noopener noreferrer">Ver y gestionar mi turno</a>
                <p class="mt-3 text-sm text-white/55">Abrí tu turno para ver las opciones de calendario, recordatorios, cancelación y solicitud de reprogramación.</p>
            <a class="ux-btn-secondary mt-4 inline-flex" href={data.bookingStartUrl}>Reservar otra consulta</a>
            </section>
        </div>
    </main>
</BookingAppearance>
