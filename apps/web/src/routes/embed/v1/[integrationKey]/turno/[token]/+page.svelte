<script lang="ts">
	import type { PageProps } from './$types';

 import {formatQuotedPrice, quotedPriceEstimateNotice} from '$lib/booking/pricing';
    import { describeDepositDeadline } from '$lib/scheduling/deposits';
    import { buildSelfManagementCutoffNotice } from '$lib/scheduling/email-policy';
    import { splitTextWithHttpsLinks } from '$lib/utils/safe-links';
    import BookingAppearance from '$lib/booking/BookingAppearance.svelte';
    import BookingFrameBridge from '$lib/booking/BookingFrameBridge.svelte';
    import { formatInTimeZone } from '$lib/utils/format';
    import { BOOKING_MODALITY_LABELS } from '@cita-suite/shared/booking-integration';
    let { data }: PageProps = $props();
    const appointment = $derived(data.appointment);
</script>

<svelte:head><title>Tu turno · {appointment.business.name}</title></svelte:head>
<BookingAppearance theme={data.theme}>
    {#if data.embed}<BookingFrameBridge context={data.embed} completed={true} />{/if}
    <main class="min-h-screen bg-fill-06111f px-4 py-5 text-fg sm:py-8 bk-text">
        <div class="mx-auto flex max-w-3xl flex-col gap-4">
            <section class="ux-card">
                <h1 class="ux-title">{appointment.status === 'cancelled' ? 'Este turno está cancelado' : appointment.is_past ? 'Tu turno' : data.recovered ? 'Recuperamos tu reserva' : appointment.status === 'confirmed' ? 'Tu turno está confirmado' : appointment.status === 'reschedule_requested' ? 'Tu turno tiene un pedido de cambio pendiente' : 'Tu turno quedó reservado'}</h1>
                <p class="ux-badge mt-3">{appointment.public_status_label}</p>
                <p class="ux-subtitle mt-3">{formatInTimeZone(appointment.starts_at, appointment.business.timezone).full} h</p>
                <p class="mt-2">Horario local del consultorio.</p>
                {#if appointment.patient_name}<p class="mt-2">Reserva para {appointment.patient_name}.</p>{/if}
                <p class="mt-4">{appointment.service_name_snapshot} · {appointment.professional_name_snapshot}</p>
                {#if appointment.booking_context}<p class="mt-2">{BOOKING_MODALITY_LABELS[appointment.booking_context.modality]}</p>{/if}
                {#if appointment.business.address}<p class="mt-4">{appointment.business.address}</p>{/if}
                {#if appointment.business.address_instructions}
                    {#if appointment.booking_context?.modality === 'video'}
                        <p class="mt-2 whitespace-pre-wrap break-words">{#each splitTextWithHttpsLinks(appointment.business.address_instructions) as part}{#if part.type === 'link'}<a href={part.href} target="_blank" rel="noopener noreferrer" class="ux-link break-all bk-accent-text">{part.label}</a>{:else}{part.value}{/if}{/each}</p>
                    {:else}
                        <p class="mt-2">{appointment.business.address_instructions}</p>
                    {/if}
                {/if}
                <a class="ux-btn-primary mt-5 inline-flex w-full justify-center" href={'/turno/' + appointment.token} target="_blank" rel="noopener noreferrer">Ver y gestionar mi turno</a>
                <p class="mt-3 text-sm text-fg-55 bk-muted">Abrí tu turno para consultar su estado y las opciones disponibles.</p>
            {#if data.newBookingAllowed}<a class="ux-btn-secondary mt-4 inline-flex" href={data.bookingStartUrl}>Reservar otra consulta</a>{/if}
            </section>
            {#if appointment.status !== 'cancelled' && !appointment.is_past && appointment.deposit?.status === 'pending'}
                {@const deadline = describeDepositDeadline(
                    {
                        amount: appointment.deposit.amount,
                        dueAt: appointment.deposit.due_at,
                        autoCancel: appointment.deposit.auto_cancel,
                        paymentNoticeAt: appointment.deposit.patient_payment_notice_at
                    },
                    appointment.business.timezone,
                    new Date(data.now ?? Date.now())
                )}
                <section class="ux-card" data-embed-deposit-card>
                    <h2 class="ux-section-title">Seña del turno</h2>
                    <p class="mt-2">{deadline.turnPageLine}</p>
                    {#if appointment.deposit.patient_payment_notice_at}
                        <p class="mt-2 text-sm text-fg-70 bk-muted">Avisaste que transferiste la seña. El consultorio va a verificar tu pago y confirmar el turno.</p>
                    {:else if deadline.autoCancelSentence}
                        <p class="mt-2 text-sm text-fg-70 bk-muted">{deadline.autoCancelSentence}</p>
                    {/if}
                    {#if appointment.deposit_transfer_details}
                        <p class="mt-3 text-sm font-bold text-fg-55 bk-muted">Datos para transferir</p>
                        <p class="mt-1 whitespace-pre-wrap break-words font-bold">{appointment.deposit_transfer_details}</p>
                    {/if}
                </section>
            {/if}
            {#if appointment.status !== 'cancelled' && !appointment.is_past && data.selfManagementCutoffHours}
                {@const cutoffSummary = buildSelfManagementCutoffNotice({
                    startsAt: appointment.starts_at,
                    cutoffHours: data.selfManagementCutoffHours,
                    timezone: appointment.business.timezone,
                    now: new Date(data.now ?? Date.now()),
                    context: 'confirmed'
                })}
                {#if cutoffSummary}
                    <section class="ux-card" data-embed-self-management-card>
                        <p class="text-sm text-fg-70 bk-muted">{cutoffSummary}</p>
                    </section>
                {/if}
            {/if}
            {#if data.appointment.price_quote_snapshot}
                {@const registeredPriceNotice = quotedPriceEstimateNotice(data.appointment.price_quote_snapshot, 'registered')}
                <section class="ux-card">
                    <h2 class="ux-section-title">Arancel registrado al reservar</h2>
                    <p class="mt-2 font-bold">{formatQuotedPrice(data.appointment.price_quote_snapshot)}</p>
                    {#if registeredPriceNotice}<p class="mt-2 text-sm text-fg-70 bk-muted">{registeredPriceNotice}</p>{/if}
                </section>
            {/if}
            {#if data.appointment.patient_instructions_snapshot}<section class="ux-card"><h2 class="ux-section-title">Indicaciones para tu turno</h2><p class="mt-2 whitespace-pre-wrap break-words">{data.appointment.patient_instructions_snapshot}</p></section>{/if}
        </div>
    </main>
</BookingAppearance>
