# Campaña de mantenibilidad — 2026-10-15

La fuente de verdad es el [plan aprobado íntegro](../plans/refactorizacion-cita-suite.md). Este documento inicial no lo reemplaza. El avance y las evidencias se mantienen exclusivamente en el [registro separado](../plans/registro-refactorizacion-cita-suite.md).

Estado vigente: campaña en ejecución en rama `refactor/maintainability-20261015`, con verificaciones pesadas descartables en GitHub Actions. Todavía no publicada. El 17 de octubre el usuario amplió expresamente la autorización a publicación, pruebas masivas y auditoría en producción; consultar la ampliación literal del [plan](../plans/refactorizacion-cita-suite.md). Siguen vigentes los pasos previos de ensayo aislado, respaldo/recuperación, staging y release, la preservación de datos reales, Workers Free, ninguna contratación y la restricción de RAM. Los registros de inicio siguientes conservan su carácter histórico.

## Base y preservación

HEAD de entrada: `c4a2417`; el árbol contiene reversiones de la ejecución anterior no autorizada. Se preservan esas diferencias y los archivos ajenos. No se considera aceptada aquella ejecución ni sus evidencias. La referencia publicada anterior registrada es `313355a`; no se confirmó ahora la versión servida.

## Contrato de cierre

1. Inventario y verificaciones secuenciales completas, sin éxito con suites omitidas.
2. Fábricas y consumidores activos tipados; autorización común y contratos JSON validados.
3. Capacidades coherentes y cuotas global/consultorio atómicas: 700 MB global, 100 MB predeterminados al habilitar documentos; máximos compartidos, no espacio garantizado.
4. Disponibilidad compartida en ventanas fijas de 15 días; precios enteros exactos y paridad SQL/TS; mismas garantías transaccionales.
5. Seis áreas: acceso/comercial, equipo, agenda/reservas, pacientes/clínica, integraciones/tareas y sitios/presentación. Interfaces públicas cruzadas permitidas, detalles privados y ciclos prohibidos. Sin capas vacías.
6. Interfaz y recorridos conservados; Natalia usa navegación nativa a Cita Suite. No tocar cursos/noticias ni activar WhatsApp.
7. Programador Cloudflare con tareas independientes, presupuestos completos y recuperación persistente. Push/calendario cada cinco minutos; inicio ordinario dentro de diez minutos.
8. Desde la decisión del 20 de octubre, la condición de lanzamiento es demostrar los criterios con **dos consultorios en Workers Free y Supabase Free**. Se conserva la evidencia de 5 y 25 en CI y del ensayo alojado de 5; esos tamaños ya no son condición de cierre. Entorno pesado externo; computadora local excluida. La ampliación del 17 permite producción con datos sintéticos identificables y límites de interrupción, después de los ensayos y puertas previas del plan.
9. Auditoría transversal, documentación, artefactos, reversión y limitaciones comprobadas. Ningún cierre parcial equivale a campaña terminada.

## Evidencia y límites

`verify:fast`, `verify:full` y `verify:release` registran resultados en `.verification/`. Las suites corren secuencialmente, con un trabajador. Una dependencia o suite ausente hace fallar el nivel correspondiente; no cuenta como omitida satisfactoriamente.

Los accesos Cloudflare/Actions y el staging Supabase quedaron resueltos después del inventario inicial; las cuentas/refs y las lecturas que lo comprueban están en el registro. Antes de cada intervención se vuelve a comprobar el destino y la revisión esperados. No cambiar el destino para eludir autenticación. El contenedor de CI no acredita capacidad del servicio alojado.

## Registro de avance

- Inicio: rama aislada creada con cambios anteriores preservados. Verificaciones antiguas no incluían Natalia ni todas las suites SQL. Se comienza cerrando esas brechas.
