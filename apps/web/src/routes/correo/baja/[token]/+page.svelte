<script lang="ts">
 import { enhance } from '$app/forms';
 import { onMount } from 'svelte';
 import { classifyUserAgent, refineDeviceClass, whatsappHrefFor, type DeviceClass } from '$lib/device';
 import type { ActionData, PageData } from './$types';
 let { data, form }: { data: PageData; form?: ActionData } = $props();
 let saving = $state(false);
 let device = $state<DeviceClass>('desktop');
 onMount(() => {
  device = refineDeviceClass(classifyUserAgent(navigator.userAgent), navigator);
 });
 const finished = $derived(form?.done === true || (data.available && data.unsubscribed));
 const businessName = $derived(form?.businessName ?? (data.available ? data.businessName : data.businessName ?? ''));
 const contact = $derived(data.contact);
 const whatsappHref = $derived(
  contact?.whatsappUrl && contact?.whatsappWebUrl
   ? whatsappHrefFor(device, contact.whatsappUrl, contact.whatsappWebUrl)
   : contact?.whatsappUrl ?? null
 );
 const telHref = $derived(contact?.phone ? `tel:${contact.phone.replace(/[^\d+]/g, '')}` : null);
 const hasPublicContact = $derived(Boolean(whatsappHref || (contact?.phone && telHref)));
</script>

<svelte:head><title>Correos del consultorio</title></svelte:head>
<main class="min-h-screen bg-canvas px-4 py-10 text-copy">
 <section class="ux-card mx-auto w-full max-w-xl">
  {#if !data.available}
   {#if data.unavailableReason === 'error'}
    <h1 class="ux-section-title">Este enlace no está disponible</h1>
    <p class="mt-3 text-fg-70">No pudimos abrirlo en este momento. Volvé a intentar en unos minutos.</p>
   {:else if data.unavailableReason === 'expired' && businessName}
    <h1 class="ux-section-title">Este enlace venció</h1>
    <p class="mt-3 text-fg-70">Para dejar de recibir correos de {businessName}, pedile la baja al consultorio por WhatsApp o por teléfono.</p>
    {#if hasPublicContact}
     <div class="mt-5 flex flex-col gap-3 border-t border-line pt-4">
      <p class="text-sm font-bold text-fg">Contacto de {businessName}</p>
      {#if whatsappHref}
       <a href={whatsappHref} target="_blank" rel="noopener noreferrer" class="ux-btn-primary w-full justify-center">
        Pedir la baja por WhatsApp
       </a>
      {/if}
      {#if contact?.phone && telHref}
       <p class="text-sm text-fg-70">
        Teléfono: <a href={telHref} class="ux-link inline-block whitespace-nowrap py-1 font-semibold underline">{contact.phone}</a>
       </p>
      {/if}
     </div>
    {/if}
   {:else}
    <h1 class="ux-section-title">Este enlace no está disponible</h1>
    <p class="mt-3 text-fg-70">Este enlace no es válido o ya venció. Para dejar de recibir correos, pedile la baja al consultorio por WhatsApp o por teléfono.</p>
   {/if}
  {:else if finished}
   <h1 class="ux-section-title">Listo</h1>
   <p class="mt-3 text-fg-70" role="status">No vas a recibir más correos de {businessName} en esta dirección. Tus turnos no cambian.</p>
   <p class="mt-3 text-sm text-fg-65">Si querés volver a recibirlos, pedíselo al consultorio.</p>
  {:else}
   <h1 class="ux-section-title">¿Dejar de recibir estos correos?</h1>
   <p class="mt-3 text-fg-70">No vas a recibir comprobantes ni recordatorios por correo de {businessName} en esta dirección. Tus turnos no cambian.</p>
   {#if form?.message}<p class="ux-alert mt-4" role="alert">{form.message}</p>{/if}
   <form method="POST" class="mt-5" use:enhance={() => { saving = true; return async ({ update }) => { try { await update({ reset: false }); } finally { saving = false; } }; }}>
    <button class="ux-btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Sí, dejar de recibirlos'}</button>
   </form>
  {/if}
 </section>
</main>
