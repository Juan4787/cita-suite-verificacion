<script lang="ts">
  import { page } from "$app/stores";
  import BackLink from "$lib/components/BackLink.svelte";
  let { data }: {
    data: { demo: boolean; isMaster?: boolean; canExportPatientData?: boolean };
  } = $props();
  const returnTarget = $derived.by(() => {
    const raw = $page.url.searchParams.get("return") ?? "";
    try {
      const decoded = decodeURIComponent(raw);
      return decoded.startsWith("/odonto/") ? decoded : "";
    } catch {
      return "";
    }
  });
  const practice = [
    {
      href: "negocio",
      title: "Datos del consultorio",
      description: "Nombre, dirección y contacto",
    },
    {
      href: "usuarios",
      title: "Equipo",
      description: "Profesionales, servicios, aranceles, horarios y preguntas",
    },
    {
      href: "reserva-online",
      title: "Reserva online",
      description: "Compartir la agenda y definir cómo pueden reservar",
    },
    {
      href: "documentos",
      title: "Archivos de pacientes",
      description: "Permisos de carga y espacio para archivos",
    },
    {
      href: "resena-google",
      title: "Reseña de Google",
      description: "Enlace para recibir opiniones",
    },
  ];
</script>

<svelte:head><title>Configuración · Cita Suite</title></svelte:head>
<section class="ux-page settings-page">
  <header>
    <BackLink
      href={returnTarget || "/odonto/pacientes"}
      label="Volver"
      class="mb-5"
    />
    <h1 class="ux-title">Configuración</h1>
  </header>
  <div class="settings-columns">
    <section aria-labelledby="practice-settings">
      <h2 id="practice-settings" class="ux-section-title mb-4">Consultorio</h2>
      <nav class="settings-list" aria-label="Configuración del consultorio">
        {#each practice as item}<a href={`/odonto/configuracion/${item.href}`}
            ><strong>{item.title}</strong><span>{item.description}</span></a
          >{/each}
      </nav>
    </section>
    <section aria-labelledby="account-settings">
      <h2 id="account-settings" class="ux-section-title mb-4">Cuenta</h2>
      <nav class="settings-list" aria-label="Configuración de la cuenta">
        <a href="/odonto/configuracion/suscripcion"
          ><strong>Suscripción</strong><span
            >Acceso y pagos del consultorio</span
          ></a
        >{#if data.canExportPatientData}<a href="/odonto/exportar-datos"
            ><strong>Exportar datos</strong><span
              >Pacientes, historial, turnos y seguimientos</span
            ></a
          >{/if}{#if !data.isMaster}<a href="/odonto/configuracion/ayuda"
            ><strong>Ayuda para configurar</strong><span
              >Solicitar asistencia</span
            ></a
          >{/if}
      </nav>
    </section>
  </div>
</section>

<style>
  .settings-page {
    max-width: 72rem;
    margin-inline: auto;
  }
  .settings-columns {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 3rem;
  }
  .settings-list {
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .settings-list a {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 1.25rem 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    min-height: 5.5rem;
  }
  .settings-list strong {
    font-size: 1.0625rem;
  }
  .settings-list span {
    font-size: 0.9375rem;
    color: var(--text-muted);
  }
  .settings-list a:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .settings-list a:hover strong {
    color: var(--accent);
  }
  @media (max-width: 720px) {
    .settings-columns {
      grid-template-columns: 1fr;
      gap: 2.5rem;
    }
  }
</style>
