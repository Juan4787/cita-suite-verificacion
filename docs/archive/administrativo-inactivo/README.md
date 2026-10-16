# Fuente histórica del módulo administrativo inactivo

El módulo ya estaba bloqueado por `hooks.server.ts` para GET y POST: las personas sin sesión iban a `/login` y las autenticadas a `/odonto/agenda`. Su layout agrega otra redirección. No hay migraciones de `cases`, `people` o `case_events` en la base activa de Cita Suite.

La etapa 2 conserva aquí sus siete archivos completos, con las huellas de sus bytes en `integridad.json`, antes de sacar los controladores y componentes sin uso del grafo compilado. Los puntos de entrada conservan las redirecciones y no construyen un cliente de datos. No se activó el módulo, se alteraron datos ni se inventó un esquema para hacer compilar sus consultas.

Una futura reactivación necesitaría un alcance propio, migraciones verificadas y permisos explícitos. Estos archivos sirven como referencia histórica; no son contratos de la base actual ni una implementación lista para habilitar.
