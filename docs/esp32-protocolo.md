# Protocolo App ↔ ESP32 (Wi-Fi · HTTP/JSON)

Sistema físico: **4 parcelas** (1 sensor de humedad del suelo + 1 electroválvula cada una), **2 puntos ambientales** (temperatura + humedad del aire) y **1 ESP32** conectado por Wi-Fi.

> Este documento no define hardware: pines GPIO, modelo de sensores, modelo de ESP32, relés, voltaje de las electroválvulas ni IP definitiva quedan pendientes. La app los tolera: la IP, el puerto y las rutas se configuran en **Configuración → Conexión con el ESP32**.

## Arquitectura

```
Sensores ─► ESP32 ─(Wi-Fi, HTTP/JSON)─► App (celular / PC)
                ▲                           │
                └── órdenes y configuración ┘
```

- **El ESP32 ejecuta los modos automáticos** (recomendado; opción por defecto «En el ESP32»). La app le envía la configuración de las 4 parcelas y el riego sigue funcionando aunque el celular esté apagado.
- **Opción alternativa «En la aplicación»:** la app evalúa las reglas y envía órdenes de abrir o cerrar. Solo funciona mientras la app está abierta.
- **El modo manual** siempre se ejecuta mediante órdenes de la app, previa confirmación del usuario.

## Endpoints (rutas configurables)

| Ruta por defecto | Método | Uso |
|---|---|---|
| `/datos` | GET | Lecturas actuales (la app consulta cada *N* s; por defecto 10 s) |
| `/valvula` | POST | Abrir o cerrar una electroválvula |
| `/config` | POST | Configuración de modos y umbrales de las 4 parcelas |
| `/estado` | GET | Prueba de conexión (si no existe, se usa `/datos`) |

El ESP32 debe responder con `Content-Type: application/json`. Si se usa la versión web (PWA) desde un navegador, además debe enviar `Access-Control-Allow-Origin: *` (el APK no lo necesita, porque hace las peticiones de forma nativa).

### GET `/datos` — respuesta

```json
{
  "temperatura_ambiente_1": 24.3,
  "humedad_ambiente_1": 71,
  "temperatura_ambiente_2": 25.1,
  "humedad_ambiente_2": 68,
  "humedad_suelo_1": 27,
  "humedad_suelo_2": 41,
  "humedad_suelo_3": 38,
  "humedad_suelo_4": 45,
  "valvula_1": 0,
  "valvula_2": 1,
  "valvula_3": 0,
  "valvula_4": 0,

  "motivo_2": "Humedad del suelo 29 % < mínima 30 %",
  "modo_1": "automatico",
  "ip": "192.168.1.50",
  "firmware": "0.1.0",
  "timestamp": 1790000000
}
```

- **Obligatorios:** los 12 primeros campos. Los demás son opcionales.
- **Humedad del suelo:** porcentaje (0–100) ya calibrado en el ESP32.
- **Válvulas:** acepta `1`/`0`, `true`/`false`, `"abierta"`/`"cerrada"` o `"on"`/`"off"`.
- **Valores imposibles** (por ejemplo −127 °C o −1 % de un sensor desconectado) se descartan, y la app alerta que el sensor dejó de enviar datos.
- **`timestamp`:** se usa solo si el reloj del ESP32 está sincronizado (±1 día); si no, se toma la hora del teléfono.
- **Formatos alternativos:** también se aceptan objetos anidados, alias cortos (`t1`, `h1`, `s1`, `v1`) y texto `clave=valor;clave=valor`.

### POST `/valvula` — orden

```json
{ "valvula": 2, "estado": "abrir", "abierta": true }
```

- **Respuesta:** `{ "ok": true }`.
- **Confirmación:** la app da la orden por cumplida cuando `valvula_2` cambia en `/datos`. Si no cambia en el tiempo configurado (por defecto 15 s), muestra **«La electroválvula 2 no responde»**.

### POST `/config` — configuración de parcelas

```json
{
  "parcelas": [
    { "parcela": 1, "modo": "automatico", "humedad_minima": 30, "humedad_objetivo": 45,
      "temperatura_minima": 12, "temperatura_maxima": 30, "duracion_maxima_min": 40,
      "fuente_temperatura": "promedio" }
  ]
}
```

- **`modo`:** `automatico` | `humedad` | `temperatura` | `manual`.
- **`fuente_temperatura`:** `promedio` | `punto1` | `punto2`.
- **Umbrales sin configurar:** se envían como `null`. En ese caso el ESP32 **no debe activar** la válvula en ese modo.
- **Almacenamiento:** el ESP32 debe guardar esta configuración en memoria no volátil (NVS/Preferences) para conservarla tras un corte de energía.

## Reglas de los modos (deben implementarse igual en el firmware)

Referencia en la app: `src/lib/irrigation.ts → decide()`.

| Modo | Abrir cuando | Cerrar cuando |
|---|---|---|
| Solo humedad | suelo < humedad mínima | suelo ≥ humedad objetivo |
| Solo temperatura | T ambiental > temperatura máxima | T ≤ temperatura mínima (o ≤ máxima si no hay mínima) |
| Automático | suelo < mínima (salvo que T < temperatura mínima), o T > máxima y suelo < objetivo | suelo ≥ objetivo |
| Manual | orden del usuario | orden del usuario |

En todos los modos automáticos, si `duracion_maxima_min` tiene valor, la válvula se cierra al cumplirse ese tiempo (límite de seguridad).

## Seguridad: clave secreta (obligatoria)

Las electroválvulas son equipos físicos: el ESP32 **no debe obedecer a cualquier equipo de la red Wi-Fi**. Por eso la app envía en **todas** las peticiones la cabecera:

```
X-Clave: <clave secreta>
```

La clave se escribe (o se genera) en la app en **Configuración → Conexión con el ESP32 → Clave secreta** y debe ser **idéntica** a la programada en el firmware.

Reglas para el firmware:

1. Si la cabecera `X-Clave` falta o no coincide, responder **401** y no hacer nada (no leer, no abrir válvulas, no cambiar la configuración).
2. Responder a las peticiones `OPTIONS` (CORS) con `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type, X-Clave` y `Access-Control-Allow-Methods: GET, POST, OPTIONS`. Lo necesita la versión web (PWA); el APK no.
3. Guardar la clave en NVS o en una constante del firmware, nunca en un repositorio público.
4. El Wi-Fi del invernadero debe tener contraseña WPA2/WPA3 fuerte y no compartirse con visitantes.

Ejemplo (Arduino `WebServer`):

```cpp
const char* CLAVE = "la-misma-clave-de-la-app";

bool autorizado() {
  if (server.method() == HTTP_OPTIONS) return true;
  return server.header("X-Clave") == CLAVE;
}

void responderOpciones() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-Clave");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.send(204);
}

void manejarValvula() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if (!autorizado()) { server.send(401, "application/json", "{\"error\":\"clave\"}"); return; }
  // ... leer el JSON y mover la válvula ...
}

void setup() {
  const char* cabeceras[] = {"X-Clave"};
  server.collectHeaders(cabeceras, 1);           // sin esto, server.header() devuelve vacío
  server.on("/valvula", HTTP_OPTIONS, responderOpciones);
  server.on("/valvula", HTTP_POST, manejarValvula);
  // ... igual para /datos, /config y /estado ...
}
```

La app muestra «El ESP32 rechazó la clave secreta» cuando recibe 401 o 403.

## Pendiente para la conexión física

1. **Hardware:** modelo de ESP32, sensores ambientales y de suelo (y su calibración a %), relés o MOSFET, electroválvulas (voltaje y consumo), fuente de alimentación y pines GPIO.
2. **Firmware:** conexión Wi-Fi, servidor HTTP con las 4 rutas anteriores protegidas con la clave secreta (ver «Seguridad»), lectura de sensores, control de relés, reglas de los 4 modos y guardado de la configuración en NVS.
3. **Red:** IP fija del ESP32 (reserva DHCP en el router o IP estática), mismo Wi-Fi que el celular. Luego se configura en la app: IP → Guardar → Probar conexión.
4. **Seguridad eléctrica:** en el arranque y ante pérdida de Wi-Fi, estado seguro de las válvulas (normalmente cerradas).
5. **Calibración:** definir con el docente los umbrales de cada parcela en **Riego y parcelas → Configuración de umbrales**.

## Datos del hardware que se necesitarán

- Dirección IP (o nombre mDNS) y puerto del ESP32.
- Rutas, si el firmware usa otras distintas a `/datos`, `/valvula`, `/config` y `/estado`.
- Formato real de la respuesta, si difiere de los nombres de este documento (la app acepta alias y se puede ampliar en `src/lib/esp32/protocol.ts`).
- Intervalo de lectura de los sensores y tiempo que tarda una válvula en abrir o cerrar (para ajustar la espera de confirmación).
- Rango y calibración de los sensores de humedad del suelo.
- Si el ESP32 ejecutará los modos automáticos (recomendado) o solo obedecerá órdenes.
