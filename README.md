# WhatsApp Taller Bot

Bot de WhatsApp para taller mecánico que conversa con clientes, clasifica la complejidad del trabajo y agenda turnos automáticamente en Google Calendar.

## Stack

- Node.js + Express
- Twilio WhatsApp API (capa adaptable para cambiar de proveedor)
- Google Calendar API (fuente de verdad para disponibilidad)
- Estado conversacional **en memoria** (Map) — preparado para migrar a MySQL

## Estructura

```
src/
  app.js
  server.js
  config/        env, google, whatsapp
  routes/        whatsapp, health
  controllers/   whatsapp.controller
  services/      conversation, calendar, appointment, duration, handoff, whatsapp
  utils/         date, text
  data/          conversation-store (Map en memoria)
  middlewares/   error
```

## Instalación

```bash
npm install
cp .env.example .env
# completar variables
npm run dev
```

Endpoints:

- `GET /health` → `{ "status": "ok" }`
- `POST /webhooks/whatsapp` → webhook de Twilio (form-urlencoded: `From`, `Body`)

## Flujo conversacional

`START → ASK_NAME → ASK_VEHICLE → ASK_PROBLEM → ASK_CAN_MOVE → [ASK_COMPLEXITY] → ASK_PREFERRED_DATE → OFFER_SLOTS → CONFIRM_SLOT → COMPLETED`

Estado paralelo: `HANDED_OFF_TO_HUMAN`. Si en cualquier momento el usuario pide hablar con una persona, el bot envía:

> Perfecto, te comparto el número del encargado para que puedas hablar directamente con una persona: 3412606800.

y deja de procesar el flujo.

## Cálculo de duración

`src/services/duration.service.js` clasifica por palabras clave:

- **2h (simple):** aceite, filtros, revisión, luces, batería, escaneo, alineación, balanceo
- **4h (medio):** frenos, suspensión, tren delantero, embrague simple, service completo, aire, pérdida de aceite, eléctrico moderado
- **8h (complejo):** motor, caja, embrague complejo, no arranca, sobrecalentamiento, distribución, vehículo parado

Si no se detecta, el bot pregunta: *"¿dirías que es una revisión simple, una reparación intermedia o un problema complejo?"*

Si el cliente indica que el vehículo no se puede mover, se asigna automáticamente turno de 8h.

## Reglas de calendario

- Lunes a viernes (configurable: `WORK_DAYS=1,2,3,4,5`)
- `WORK_START_HOUR=08:00`, `WORK_END_HOUR=18:00`
- No se pisan eventos existentes (validación con `freebusy.query` antes de crear)
- Validación final justo antes de crear el evento (si se ocupó, ofrece otros)
- Google Calendar es la fuente única de verdad

## Variables de entorno

Ver `.env.example`. Mínimo necesario para producción:

```
WHATSAPP_ACCOUNT_SID=
WHATSAPP_AUTH_TOKEN=
WHATSAPP_FROM_NUMBER=whatsapp:+14155238886
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_CALENDAR_ID=
OPENAI_KEY=
HUMAN_MANAGER_PHONE=3412606800
```

---

## Configuración de Twilio WhatsApp

1. **Crear cuenta** en [twilio.com](https://www.twilio.com/) (incluye crédito gratis).
2. En la consola: **Messaging → Try it out → Send a WhatsApp message** para activar el **Sandbox** (rápido, ideal para testing).
   - Seguí las instrucciones para "unir" tu número personal al sandbox enviando el código (`join <codigo>`) al `+1 415 523 8886`.
3. Para producción real: solicitar número propio de WhatsApp Business (proceso de aprobación de Meta vía Twilio).
4. **Account SID** y **Auth Token**: visibles en el dashboard principal → copiarlos al `.env` como `WHATSAPP_ACCOUNT_SID` y `WHATSAPP_AUTH_TOKEN`.
5. **Número emisor** (`WHATSAPP_FROM_NUMBER`): para sandbox es `whatsapp:+14155238886`. En producción, el número aprobado, también con prefijo `whatsapp:`.
6. **Configurar webhook**:
   - En Sandbox: **Sandbox settings → "When a message comes in"** → URL pública del servidor: `https://TU_DOMINIO/webhooks/whatsapp`, método `POST`.
   - En desarrollo local, exponer el server con [ngrok](https://ngrok.com/): `ngrok http 3000` y usar la URL HTTPS que devuelve.
7. **Probar**: enviar un mensaje al número del sandbox desde tu WhatsApp. El bot debería responder con el saludo inicial.
8. **Logs**: Twilio Console → Monitor → Logs → Messaging para depurar.

### Cambiar de proveedor

`src/services/whatsapp.service.js` aísla envío y parseo de mensajes. Para usar otro (Meta Cloud API, 360dialog, etc.) basta con extender ese módulo y conmutar por `WHATSAPP_PROVIDER`.

---

## Configuración de Google Calendar

1. **Crear proyecto** en [console.cloud.google.com](https://console.cloud.google.com/).
2. **Habilitar Google Calendar API** desde "APIs & Services → Library".
3. **Credenciales → Create credentials → Service account**:
   - Nombre cualquiera, no se necesitan roles especiales.
4. En la service account creada → pestaña **Keys → Add key → JSON**. Descargar el archivo.
5. Del JSON descargado:
   - `client_email` → `GOOGLE_CLIENT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY` (envolver entre comillas dobles, mantener los `\n` literales)
6. **Compartir el calendario** del taller con el `client_email` de la service account:
   - Abrir Google Calendar → calendario del taller → **Settings and sharing → Share with specific people** → agregar el email con permiso **"Make changes to events"**.
7. **Calendar ID**: en la misma pantalla, sección **Integrate calendar → Calendar ID**. Pegarlo en `GOOGLE_CALENDAR_ID`.
8. **Probar**: levantar el server y mantener una conversación completa hasta crear un evento. Verificar que aparece en el calendario.

---

## Pasar a producción

1. Desplegar en servidor con HTTPS (Render, Railway, Fly.io, VPS con Nginx + certbot).
2. Apuntar el webhook de Twilio a `https://tu-dominio/webhooks/whatsapp`.
3. Cargar `.env` en el host (no commitear secretos).
4. Process manager: `pm2`, `systemd` o el integrado del PaaS.
5. Validar firma de Twilio (recomendado): usar `twilio.validateRequest` en un middleware.

## Próximos pasos recomendados

- **Persistencia en MySQL**: reemplazar `src/data/conversation-store.js` por una capa con la misma interfaz contra MySQL (tablas `conversations`, `messages`, `appointments`).
- **Panel administrativo en React**: ver/cancelar/reprogramar turnos, métricas, listado de conversaciones.
- **IA para interpretar mensajes**: integrar Claude/OpenAI en `conversation.service.js` para entender respuestas naturales y mejorar la clasificación de complejidad.
- **Recordatorios automáticos**: cron job que el día antes envíe recordatorio al cliente.
- **Cancelación y reprogramación de turnos** desde WhatsApp.
- **Listado de servicios configurables** y **reglas de duración configurables** por tipo de trabajo (mover `RULES` a base de datos editable).
- **Validación de firma del webhook** Twilio para seguridad.
- **Tests** unitarios e integración.
