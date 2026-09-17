# Integración de datos de sensores

La aplicación recibe lecturas de sensores sin cambios de diseño por tres vías. Las tres pasan por la misma validación: fecha y hora, rangos físicos, duplicados, datos faltantes y marcado de lecturas sospechosas.

## 1. Archivos del datalogger (disponible)

**Importar datos de sensores** acepta `.xlsx`, `.xls`, `.csv`, `.txt` y `.json`.

Estructura mínima recomendada:

| Fecha | Hora | Temperatura | Humedad relativa | Sensor | Cultivo |
|---|---|---|---|---|---|
| 14/09/2026 | 08:00 | 22,5 | 78 | SHT31-01 | Tomate |

- **Fecha:** `dd/mm/aaaa`, `aaaa-mm-dd`, fecha de Excel, fecha y hora en una celda (`2026-09-14T08:00`) o marca de tiempo Unix en milisegundos.
- **Hora:** `08:00`, `08h00`, `8:00 p. m.` u hora de Excel.
- **Decimales y separadores:** coma o punto decimal; separador `;`, `,` o tabulación.
- **Columnas opcionales reconocidas:** temperatura del suelo, humedad del suelo, luminosidad, radiación solar, viento, precipitación, temperatura exterior, HR exterior, etapa fenológica y observaciones.
- **Origen:** se elige al importar (**Sensor** o **Importado**).
- **Sensor por defecto:** si el archivo no trae la columna Sensor, se indica un identificador que se aplica a todo el archivo.
- **Etapa fenológica:** si falta, se asigna según la cronología del cultivo.

## 2. JSON (formato para una API futura)

```json
{
  "readings": [
    { "timestamp": "2026-09-14T08:00", "temperature": 22.5, "rh": 78, "sensor": "SHT31-01" },
    { "timestamp": 1789390800000, "temperature": 22.9, "rh": 77, "sensor": "SHT31-01" }
  ]
}
```

También se acepta un arreglo en la raíz o bajo la clave `data`. Las claves se mapean igual que las columnas de un archivo: `timestamp`/`fecha`, `temperature`/`temperatura`, `rh`/`humedad`, `sensor`, etc.

## 3. Conexión directa (preparada)

Para una pasarela IoT (ESP32, LoRa, gateway del datalogger), cada lectura debe convertirse en un `ClimateRecord` (`src/db/types.ts`) con:

- `source: 'sensor'`
- `sensorId`: identificador del equipo
- `validation`: resultado de `assessRecord()` y `flagSensorJumps()` (`src/lib/validation.ts`)
- `greenhouseId`, `cropId` y `phenologicalStage` (con `stageForDate()` de `src/lib/agro.ts`)

`buildImportRows()` (`src/lib/importer.ts`) ya implementa esa conversión y puede reutilizarse sobre las filas recibidas de una API. Si se usa un servidor central, el modelo equivalente está en `docs/base-de-datos.sql`.

## Recomendaciones de medición

- Ubicar el sensor a la altura del dosel y dentro de un abrigo o caseta que lo proteja de la radiación solar directa.
- Usar un intervalo de registro constante (5–30 min) para que las horas estimadas sean precisas.
- Anotar en la aplicación las labores de manejo (apertura de cortinas, riego) para interpretar cambios bruscos.
- Descargar los datos antes de que se llene la memoria del datalogger y revisar los vacíos en **Problemas climáticos → Calidad de datos**.
