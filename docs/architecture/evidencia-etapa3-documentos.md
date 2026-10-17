# Etapa 3: matriz de cierre de documentos

Fuente de verdad: [plan original](../plans/refactorizacion-cita-suite.md), etapa 3. Esta matriz enlaza condiciones con mecanismos y evidencia. No modifica el plan ni certifica capacidad alojada, staging o producción. Estado: **cerrada en entorno descartable**, con verificación integral, dictamen sobre las tres correcciones y documentación comprobada. El [registro](../plans/registro-refactorizacion-cita-suite.md) conserva los SHAs/recibos completos y los fallos previos.

La referencia integral de cierre es CI [39048463987](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/39048463987), revisión `50f0b58d3583402b82bd09678e779c267689b293`, recibo `f0f7c135-b39d-4907-9c87-a33339bb2c04`, aprobado. Incluye las tres correcciones visuales. Paquete SHA-256 `a5aede9107431eca48e9f68d643933580a39896a52d10eb121f11a519470a884`. [Revisión documentada](revision-ui-documentos.md): ship limitado a 3/3 fixes, sin convertirlo en auditoría completa.

| Condición del plan | Implementación / comprobación real |
|---|---|
| Alta nueva con 100 MB sin configuración manual | Trigger transaccional de alta y aserción pgTAP de cuota automática. No preasigna espacio. |
| Maestro modifica predeterminado y excepciones | RPC explícitas service_role, identidad maestro verificada en servidor, CAS y E2E con lectura real de base. |
| Reactivar conserva una cuota válida | Secuencia SQL activar/desactivar/activar con máximo individual distinto de la base. |
| No activar con cuota ausente/cero/pausada | Cuenta/FK/CHECK y trigger de activación; prueba negativa de pausa + atomicidad y predeterminado cero rechazado. |
| Consultorios anteriores conservan capacidad y pendientes | Ensayo de migración antes/después (6 aserciones), 3,5 MB de objeto, 5 MB de reserva, máximo previo 700 MB preservado. |
| Rechazar límite inferior al compromiso, sin borrar | Pruebas SQL de reducción global/individual, preservación del objeto y aumento sin cambiar identidad/slots. |
| Presupuesto global 700 MB y cuota individual | Contadores protegidos por bloqueo global → consultorio → documento; cuotas no garantizan capacidad compartida. |
| 5 MB por archivo, 10 MB y tres por reserva | Contratos SQL existentes y negativos de tamaño real posterior, sin usar la reserva pesimista para el tope del turno. |
| Dos de 3,5 MB y tercero de 200 KB | `booking_extension_contracts.sql` exige que entre; intento real de superar 10 MB y actualización con lease vencido se rechazan. |
| URL vigente respalda máximo, expiración real y margen | SQL con plazo observado de cuatro horas + quince minutos; adaptador sólo entrega URLs después de proteger el mayor vencimiento. Unidades de respuestas inválidas. |
| No doble cargo ni acortar una renovación | Aserciones de repetición, objeto existente y conservación del plazo mayor. |
| Orden de locks y carreras global/individual | `run_clinical_budget_concurrency.sh`: dos conexiones y espera observada mediante bloqueador real; no sólo retrasos temporales. |
| Sin Storage dentro de una transacción abierta | Emisión y validación HTTP desde servidor entre RPC completas; trigger contable sólo usa el catálogo SQL. |
| Reconciliar pendientes, abandonados, fallidos, derivados y papelera | Suite específica (14), cuatro estados, otros buckets, namespaces sin fila, tamaño desconocido y drift. |
| Otras cargas propias participan globalmente | Trigger de todos los objetos Storage; prueba de otro bucket. Tamaños no atribuibles se informan. |
| Cambios externos se detectan, sin borrar documentos | Drift deliberado, exceso explícito y contador reparado sin aumentar máximos ni borrar filas/objetos. Es inventario del catálogo, no prueba física de S3. |
| Expiración repetible y limpieza respetan protección | Liberación doble sin cargo negativo; claim vigente excluye slots aún válidos. La etapa 6 verificará además la ejecución del programador. |
| PDF básico síncrono y acotado | Metadatos reales, prefijo/cierre y Range exactos; unidades rechazan Range ignorado/malformado y cancelan cuerpo acotado. Sin parser estructural/cola. |
| Descarga correcta con identidad del paciente | PDF profesional y paciente subidos por UI/Storage real, filas ready con procedencia/turno/paciente y bytes descargados idénticos, nombre seguro. |
| Permisos/capacidades e histórico | SQL negativo entre consultorios/ACL; UI/API rechazan pausa y usuario ordinario no entra a maestro. Lectura histórica conserva reglas de etapa 2. |
| Tipos reproducibles | Dos exportaciones oficiales iguales y `--check` integral con todas las migraciones; sin edición manual de tipos. |
| UI coherente | Dictamen independiente inicial: tres fixes concretos. Recapturas válidas y dictamen del mismo revisor: 3/3 resolved. Documentación contrastada; no equivale a matriz total de etapa 5. |

## Límites de esta evidencia

PostgreSQL/Auth/Storage/HTTP/navegador corren realmente sobre la plataforma descartable de CI. Los claims de pgTAP son simulación de contexto SQL y se distinguen de Auth HTTP real. No se aplicaron aún estas migraciones a Supabase alojado. Realtime, OAuth externo, respaldo/recuperación, capacidades a escala, release y auditoría transversal conservan las puertas posteriores del plan. El resultado del catálogo no demuestra objetos físicos ajenos al catálogo de Storage.
