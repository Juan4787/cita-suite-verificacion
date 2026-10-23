# Mercado Pago — Suscripciones de Cita Suite

Runbook operativo: cómo funciona, cómo probarlo en sandbox, cómo salir a
producción y cómo diagnosticar problemas. Escrito tras la implementación y
auditoría de las fases 1–4 (2026-07-05).

## Modelo (por qué "pagó pero está bloqueado" es estructuralmente imposible)

- **La base (Supabase) es la única fuente de verdad del acceso**: el estado
  comercial sale de `business_subscriptions` (`paid_until` → `grace_until` →
  `restricted_until`), nunca de preguntarle a MP en tiempo real.
- **MP solo emite eventos de cobro.** Cada pago aprobado se acredita por TRES
  caminos independientes e idempotentes (clave `mp:payment:{payment_id}` en el
  ledger `access_grants`):
  1. **Webhook** `POST /api/mercadopago/webhook` (firma HMAC + frescura de ts).
  2. **Retorno del checkout** (`?mp=retorno` en la página de suscripción):
     confirmación activa contra la API de MP; el redirect jamás acredita solo.
  3. **Conciliación** `POST /internal/jobs/reconcile-mercadopago` (cron ~6 h):
     cura cualquier cobro que los otros dos hayan perdido, incluso el cobro
     final de una suscripción recién cancelada.
- **Lo manual siempre gana**: un pago automático (sin `p_admin_id`) acredita
  tiempo pero NO re-habilita un negocio deshabilitado, NO desarchiva y NO pisa
  la nota del admin. Si un pago queda acreditado con el negocio bloqueado, el
  evento se marca `requires_attention` y aparece en el panel maestro.
- **Reembolsos/contracargos**: solo asiento en el ledger (`payment_cancelled`)
  + alerta; el acceso no se toca automáticamente (decisión de producto).

Piezas: `apps/web/src/lib/server/mercadopago.ts` (toda la lógica),
`apps/web/src/lib/server/hmac.ts` (núcleo HMAC compartido con WhatsApp),
webhook en `apps/web/src/routes/api/mercadopago/webhook/`, página en
`/odonto/configuracion/suscripcion`, job en
`/internal/jobs/reconcile-mercadopago`, panel maestro (badge MP, cancelar,
conciliar ahora, eventos con atención). Migraciones: `20260704120000` y
`20260704130000` (aplicadas al remoto).

## Variables de entorno

| Variable | Dónde | Nota |
|---|---|---|
| `MP_ACCESS_TOKEN` | Secreto del Worker `app` de Cloudflare (prod) y `.env` (test local) | Access Token de la app **Cita Suite** (ID `6430070537499696`). El de prueba y el de producción son distintos. |
| `MP_WEBHOOK_SECRET` | Secreto del Worker `app` (prod) y `.env` (test) | Clave secreta del panel de Webhooks. **La de la config de prueba y la de producción son DISTINTAS** — causa clásica de "firma inválida solo en prod". |
| `MP_SUBSCRIPTION_AMOUNT_ARS` | Variable del Worker `app` | Precio mensual. Si falta o es inválida, el código usa 50000. |
| `MP_ENVIRONMENT` | Worker `app` y `.env` | `test` o `production`. Debe declararse: un token `APP_USR-` puede pertenecer a cualquiera de los dos entornos. |

El preflight (`node scripts/staging-preflight.mjs`) falla si faltan las dos
primeras. Sin `MP_WEBHOOK_SECRET` el webhook rechaza TODO con 401
(falla-cerrado); sin `MP_ACCESS_TOKEN` el checkout y la conciliación fallan con
error visible.

## Prueba de integración (antes del go-live)

1. En el [panel de la app Cita Suite](https://www.mercadopago.com.ar/developers/panel/app),
	 copiar las **credenciales de prueba** → `MP_ACCESS_TOKEN` y configurar
	 `MP_ENVIRONMENT=test`. En Suscripciones todavía pueden existir tokens
	 históricos `TEST-`; los actuales también pueden comenzar con `APP_USR-`.
2. Configurar el **webhook de prueba** (misma URL de producción o un túnel) y
   copiar su clave secreta → `MP_WEBHOOK_SECRET`.
3. Usar el comprador de prueba guardado sólo en el `.env` local como
   `MP_TEST_BUYER_USERNAME` / `MP_TEST_BUYER_PASSWORD`. Tarjetas de prueba: las
   lista `/mp-test-cards` del plugin o la documentación oficial.
4. Flujo completo: entrar como owner de un negocio de prueba →
	 Configuración → Suscripción → "Suscribirme con Mercado Pago" → abrir el
	 checkout en una ventana privada y autorizar **logueado como comprador de
	 prueba de Argentina, nunca con una cuenta personal** → verificar al
   volver: banner "¡Pago acreditado!", vencimiento +30 días, grant
   `payment_registered` con source `mercado_pago` en el historial.
5. Verificar el webhook con el **simulador de notificaciones** del panel de MP
   (Webhooks → Simular): debe responder 200 y dejar fila en
   `mp_webhook_events` con `signature_valid = true`.
6. Probar el kill-switch: deshabilitar el negocio desde el maestro → simular
   otro cobro → el negocio debe seguir `restricted` y el evento quedar con
   `requires_attention = true` visible en el maestro.

## Checklist de salida a producción

1. ☐ Credenciales de **producción** de la app Cita Suite → `MP_ACCESS_TOKEN`
   como secreto del Worker `app` de Cloudflare. `MP_SUBSCRIPTION_AMOUNT_ARS=50000`.
2. ☐ Webhook de **producción** registrado:
   URL `https://app.cita-suite.workers.dev/api/mercadopago/webhook`, topics
   `payment` + `subscription_preapproval` + `subscription_authorized_payment`
   (en el panel figuran como "Pagos" y "Planes y suscripciones"). Copiar la
   clave secreta de PRODUCCIÓN → secreto `MP_WEBHOOK_SECRET` del Worker. La
   copia anterior en Netlify fue retirada el 19 de octubre de 2026: no usar
   ese host.
3. ☐ Conciliación programada: la ejecuta el mantenimiento del programador
   `cita-suite-scheduler` cada 6 h (00:17, 06:17, 12:17 y 18:17 UTC), con su
   presupuesto por ejecución; ver `docs/architecture/tareas-automaticas.md`.
   No crear un cron externo: la entrada anterior
   `/internal/jobs/reconcile-mercadopago` queda sólo para la transición y
   responde 410 cuando se apagan las entradas antiguas.
4. ☐ `node scripts/staging-preflight.mjs` en verde (sin FAIL).
5. ☐ Deploy. La migración ya está aplicada (regla general: migrar SIEMPRE
   antes de deployar código que la usa).
6. ☐ Un pago real chico de punta a punta (se puede bajar
   `MP_SUBSCRIPTION_AMOUNT_ARS` temporalmente, suscribirse, verificar
   acreditación por los tres caminos, cancelar la suscripción y restaurar el
   precio).
7. ☐ Primera semana: mirar la tarjeta "Mercado Pago" del maestro (eventos con
   atención) y el panel de notificaciones de MP (permite **reenviar** eventos
   fallidos manualmente).

## Diagnóstico rápido

| Síntoma | Causa probable | Dónde mirar |
|---|---|---|
| Todos los webhooks 401 | `MP_WEBHOOK_SECRET` ausente o del entorno equivocado (test vs prod) | `mp_webhook_events.processing_status='rejected'`; recalcular firma a mano con el secret correcto |
| Webhook 200 pero `skipped` + atención | Pago de otro entorno (credenciales cruzadas) o `external_reference` no mapeable | `processing_detail` del evento |
| Pago aprobado y acceso sigue bloqueado | Kill-switch manual o alta sin configurar (comportamiento DISEÑADO) | Evento `requires_attention`; habilitar desde el maestro |
| Cliente pagó y no se acreditó nada | Webhook caído + retorno fallido | Correr "Conciliar ahora" en el maestro; la clave idempotente evita duplicar |
| MP deshabilitó la URL del webhook | Muchos errores seguidos (¿503 por env faltante?) | Panel MP → Webhooks; re-activar tras corregir |
| "Firma válida en test, inválida en prod" | Secrets distintos por entorno (caso conocido) | Regenerar/copiar el secret del entorno correcto |

## Decisiones de producto registradas

- $50.000 ARS/mes, cobro recurrente automático (preapproval sin plan).
- Redirect a MP (`init_point`), sin pago embebido.
- Sin `excluded_payment_methods` / `excluded_payment_types`: MP muestra los
  medios habilitados para esa operación/cuenta/usuario.
- Sin prueba gratuita (los períodos de cortesía se dan a mano desde el panel
  maestro, que sigue funcionando exactamente igual que antes).
- Gracia de 5 días solo para cobros automáticos de MP (los grants manuales
  conservan sus reglas de siempre).
