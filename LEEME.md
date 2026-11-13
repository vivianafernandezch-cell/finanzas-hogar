# 🐚 Finanzas Hogar — manual

App propia para registrar gastos en segundos, con dos carteras: **Mis gastos** (solo tuya) y **Hogar** (compartida con Andrés). Funciona en iPhone y Mac, sin internet, sin anuncios y sin suscripción.

---

## 0. Qué hay en esta carpeta

| Archivo / carpeta | Qué es |
|---|---|
| `index.html`, `styles.css`, `src/` | La app |
| `config.js` | **El único archivo que editas**: datos de conexión a Supabase |
| `vendor/` | Librerías incluidas (Preact, Supabase, SheetJS) — sin depender de internet |
| `sw.js`, `manifest.webmanifest`, `icons/` | Lo que la hace instalable y funcionar sin internet |
| `supabase/schema.sql` | Base de datos + permisos (se pega una vez en Supabase) |
| `supabase/prueba_seguridad.sql` | Prueba de que Andrés no ve tus gastos (no guarda nada) |
| `tests/index.html` | 69 pruebas automáticas |

**Modos de la app**
- `config.js` vacío → **modo local**: todo funciona, pero solo en ese dispositivo. Sirve para probar.
- `config.js` con los datos de Supabase → **modo nube**: inicias sesión, sincroniza entre iPhone y Mac, y Hogar se comparte con Andrés.

---

## 1. Conectar la nube (una sola vez, ~15 min)

Supabase es gratis para este uso: 500 MB alcanzan para más de un millón de movimientos.

1. Entra a <https://supabase.com> → **New project**. Nombre: `finanzas-hogar`. Región: la más cercana (por ejemplo `East US`). Guarda la contraseña de la base de datos en tu gestor de contraseñas.
   > Usa un proyecto **nuevo**, no el del ERP, para que tus finanzas personales queden separadas del negocio.
2. **SQL Editor** → **New query** → pega todo `supabase/schema.sql` → **Run**. Debe decir *Success*.
3. (Recomendado) Nueva query → pega `supabase/prueba_seguridad.sql` → **Run**. Debe decir **✅ SEGURIDAD OK**. Si sale ❌, no la uses y pásame el mensaje.
4. **Authentication → Users → Add user → Create new user**:
   - Tu correo y contraseña. Marca **Auto Confirm User**.
   - Repite con el correo y la contraseña de Andrés. Cada quien puede cambiar la suya después en *Ajustes*.
5. **Authentication → Sign In / Providers → Email** → desactiva **Allow new users to sign up**. Así nadie más puede crearse una cuenta.
6. **Project Settings → API**: copia **Project URL** y la llave **anon public**, y pégalas en `config.js`:
   ```js
   window.FH_CONFIG = {
     supabaseUrl: 'https://xxxx.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi...',
   };
   ```
   ⛔ **Nunca** pegues la llave `service_role`. La `anon` es pública por diseño: lo que protege tus datos son los permisos de la base de datos (paso 2).
7. Primer ingreso:
   - **Tú:** entras → **Crear Hogar**. En *Más → Ajustes* aparece el **código de invitación**.
   - **Andrés:** entra → escribe el código → **Unirme**. Desde ese momento los dos ven las mismas carteras: **Mis gastos** y **Hogar**.

## 2. Publicarla (para abrirla desde el iPhone)

Como haces con el ERP, usa **GitHub Pages**:

1. En GitHub, crea un repositorio nuevo, por ejemplo `finanzas-hogar`.
2. Sube **todo el contenido** de esta carpeta (no subas respaldos `.json` con tus datos).
3. **Settings → Pages** → *Deploy from branch* → `main` / `root`. Te da una URL como `https://tuusuario.github.io/finanzas-hogar/`.
4. En Supabase → **Authentication → URL Configuration** → *Site URL* = esa URL (sirve para el correo de "olvidé mi contraseña").

> El código es público, pero tus datos no: viven en Supabase, protegidos por usuario. `config.js` solo tiene la llave pública.

## 3. Instalar en iPhone 📱

1. Abre la URL en **Safari** (en iPhone tiene que ser Safari).
2. Botón **Compartir** (□↑) → **Agregar a pantalla de inicio** → *Agregar*.
3. Se abre como app, a pantalla completa y sin la barra de Safari. Haz lo mismo en el iPhone de Andrés.

**Atajo para registrar más rápido (opcional):** en la app *Atajos* crea un atajo "Abrir URL" con `https://…/finanzas-hogar/?add=1`. Así abre directo el teclado de gasto, y puedes ponerlo en el botón de acción del iPhone o en un widget.

## 4. Usarla en la Mac 💻

- Abre la URL en Safari o Chrome.
- Para tenerla como app: en **Safari** usa *Archivo → Agregar al Dock*; en **Chrome** usa el ícono de instalar en la barra de direcciones.
- Puedes escribir la cantidad con el teclado. **Enter** guarda y **Esc** cierra.

## 5. Registrar un gasto en 5 segundos ⚡

**＋** → teclea `20` → toca la categoría → **Guardar**. Listo.

- La app recuerda la última cartera que usaste (Mis gastos u Hogar) y la cuenta de cada una.
- Primero salen las categorías que más usas. Las ⭐ favoritas siempre van arriba.
- **＋otro**: guarda y deja el teclado listo para el siguiente gasto.
- **Deshacer** aparece unos segundos después de guardar.
- El teclado suma: `120+35` = 155.
- **Detalles ▾** abre lo opcional: fecha, cuenta, moneda, etiquetas (por ejemplo *Madrid 2026*), notas, foto del ticket y quién pagó (en Hogar).
- **Sin internet:** registra normal. Un puntito naranja en el ícono significa "pendiente de subir". Se sube solo al volver la conexión, aunque hayas cerrado la app.

## 6. Importar tus 6 años de Spendee 📥

1. En Spendee: **Ajustes → Exportar** → CSV o Excel. Puedes exportar todas las carteras juntas.
2. En la app: **Más → Importar historial** → elige el archivo.
3. Revisa lo que detectó la app:
   - **Columnas:** las detecta solas.
   - **Carteras:** decide a dónde va cada cartera de Spendee (Mis gastos, Hogar o No importar).
   - **Categorías:** ya vienen relacionadas (*Food & Drink* → *Alimentos y bebidas*, etc.). Lo que no reconoce se crea con su nombre original.
   - **Monedas:** los gastos en USD o EUR usan el tipo de cambio **histórico de su fecha** (Banco Central Europeo). También puedes poner un tipo de cambio fijo.
4. Revisa la vista previa, los duplicados y los errores → **Importar**.
5. Si algo no te gusta: en la misma pantalla, **Revertir** borra esa importación completa.

> 💡 Prueba primero con un archivo de un solo mes. Cuando te convenza, importa todo.

## 7. Respaldo y recuperación 🛟

- **Mensual (recomendado):** *Más → Exportar y respaldar → Descargar respaldo* → guarda el `.json` en iCloud Drive. Incluye todo lo tuyo y Hogar.
- **Excel/CSV:** desde la misma pantalla, con filtros por fechas, cartera y categoría.
- **Restaurar:** *Restaurar desde un respaldo* agrega o actualiza registros. Nunca borra.
- **Privacidad:** Andrés no puede exportar tus gastos personales, ni tú los suyos. Lo bloquea la base de datos, no solo la app.
- **Borrados:** nada se borra físicamente. "Eliminar" marca el movimiento como borrado, así que se puede recuperar.
- **Supabase gratis:** el plan gratuito no incluye copias automáticas del servidor. Por eso tu respaldo mensual es importante. Además, Supabase **pausa** los proyectos con 7 días sin uso; si pasa (por ejemplo, en vacaciones), entras a supabase.com y das *Restore*. Mientras tanto, la app sigue guardando en el teléfono.

## 8. Mantenimiento 🔧

- **No requiere nada** día a día.
- **Publicar una mejora:** sube los archivos cambiados a GitHub y aumenta la versión en `sw.js` (`const VERSION = 'fh-v1.0.1'`) para que los teléfonos tomen la nueva versión. Al abrir la app, se actualiza sola.
- **Cambiar contraseña:** *Más → Ajustes → Mi cuenta*.
- **Si un teléfono se pierde:** en Supabase → *Authentication → Users* → cambia la contraseña de esa persona.
- **Pruebas:** con la app abierta en un servidor, entra a `/tests/index.html`. Deben salir 69 de 69 en ✅.

## 9. Seguridad: cómo está hecha

- Contraseñas guardadas con cifrado (bcrypt) por Supabase. La app nunca las ve ni las guarda.
- **Permisos en la base de datos (RLS):** cada consulta valida si eres integrante de la cartera. *Mis gastos* tiene un solo integrante; *Hogar* tiene dos. Cambiar URLs o hacer peticiones a mano no sirve: la base de datos simplemente no devuelve lo ajeno. `prueba_seguridad.sql` lo comprueba.
- Cada movimiento guarda **quién lo registró** (nadie lo puede cambiar) y **quién pagó**.
- Validaciones en la base de datos: importes mayores a 0, monedas válidas, y la categoría debe ser de la misma cartera.
- Sin duplicados: cada movimiento nace con un identificador único en el teléfono, así que reintentar la sincronización nunca lo duplica.
- La app no envía tus datos a terceros. La única consulta externa es el tipo de cambio, y solo manda el par de monedas (por ejemplo `USD→MXN`).
- Política de seguridad de contenido (CSP): la app solo puede conectarse a Supabase y al servicio de tipo de cambio.

## 10. Reglas de cálculo (para que los números cuadren)

| Tipo | ¿Cuenta como gasto? |
|---|---|
| Gasto | ✅ suma |
| Reembolso | ↩️ resta de su categoría |
| Ingreso | va a Ingresos |
| Transferencia entre cuentas | ❌ no cuenta (solo mueve dinero) |
| Pago de tarjeta de crédito | ❌ no cuenta (el gasto ya se registró cuando compraste) |

- Moneda extranjera: se guarda el importe original, la moneda, el tipo de cambio y el importe en MXN **de ese día**. Nunca se recalcula.
- "Este mes vs mes anterior" compara contra **el mismo día** del mes anterior. Por ejemplo, del 1 al 12 de noviembre contra del 1 al 12 de octubre.
- **Pagos programados:** no cuentan como gasto hasta que tocas **Pagado**, salvo que actives *registrar automáticamente*.

## 11. Seguir desarrollando conmigo

Abre una sesión en esta carpeta y pídelo en una frase. Por ejemplo:

- "Agrega registro por voz".
- "Lee la foto del ticket y llena el monto".
- "Importa mi estado de cuenta de BBVA".
- "Avísame si un gasto es inusual".
- "Conecta el análisis con IA, mandando solo totales".

La arquitectura ya está preparada para eso:

- La lógica vive aparte en `src/logic/`.
- La IA tiene su gancho en `insights.js → aiProvider`, apagado por ahora.
- La foto del ticket ya se guarda.
- El atajo `?add=1` ya existe.

Antes de publicar cualquier cambio, corro las pruebas.

---

### Estado de esta versión (v1.0 · 2026-11-12)

**Probado en navegador**, en modo local con datos ficticios:
- Registro rápido.
- Edición, borrado y deshacer.
- USD con tipo de cambio sugerido.
- Etiquetas.
- Programados.
- Presupuestos.
- Estadísticas.
- Análisis.
- Importación con duplicados, errores, tipo de cambio histórico y reversión.
- Exportación.
- Funcionamiento **con el servidor apagado** (la app abre desde caché y guarda).

Además pasan 69 pruebas automáticas. Incluyen el escenario sin internet: guardar, cerrar la app, reabrir y sincronizar sin duplicados contra un servidor simulado.

**Falta probar con tu Supabase real:**
- `schema.sql` y `prueba_seguridad.sql` se escribieron con cuidado, pero no los pude ejecutar aquí porque no hay base de datos de PostgreSQL en esta Mac.
- El inicio de sesión y la sincronización real entre los dos teléfonos.

Cuando hagas el paso 1, lo probamos juntos.
