# InverClima – Monitoreo climático de invernaderos

Aplicación para **monitorear, analizar, visualizar e interpretar** el microclima de un invernadero con datos reales de sensores, con énfasis en el **cultivo de tomate**, y controlar el riego de 4 parcelas con un ESP32.

© 2026 Edison Xavier Guzmán Montesdeoca. Todos los derechos reservados (ver `LICENSE`). Originada como proyecto académico de Climatología Aplicada.

```
DATOS REALES DE SENSORES → ALMACENAMIENTO → VALIDACIÓN → CÁLCULOS → GRÁFICOS
→ IDENTIFICACIÓN DE CONDICIONES CLIMÁTICAS → INTERPRETACIÓN AGRONÓMICA
→ RESOLUCIÓN DE PROBLEMAS PRÁCTICOS → REPORTE ACADÉMICO
```

> **No diagnostica enfermedades**: identifica condiciones climáticas y recomienda su verificación en campo.

## Sistema de riego (v3): 4 parcelas + 2 puntos ambientales + ESP32

```
MONITOREAR → ALMACENAR → GRAFICAR → EXPORTAR → CONFIGURAR → CONTROLAR
```

- **4 parcelas**, cada una con 1 sensor de humedad del suelo y 1 electroválvula. Cada parcela tiene su propio modo (Automático, Solo humedad, Solo temperatura o Manual) y sus propios umbrales configurables. Al instalar, todas quedan en **Manual y sin umbrales**, así que nada se activa solo.
- **2 puntos ambientales** (temperatura y humedad del aire). Su promedio alimenta los análisis climáticos existentes.
- **ESP32 por Wi-Fi (HTTP/JSON):** indicador de conexión, última comunicación, IP y botón «Probar conexión». El transporte es modular (`src/lib/esp32/transport.ts`) y el contrato de datos está en [`docs/esp32-protocolo.md`](docs/esp32-protocolo.md).
- **Historial de activaciones:** parcela, electroválvula, fecha, inicio, fin, duración, modo y motivo.
- **Alertas:** suelo bajo el umbral, temperatura sobre el umbral, sensor sin datos, ESP32 desconectado y electroválvula que no responde.
- **Excel del sistema** (Historial): permite elegir fecha inicial, fecha final, parcela y variables, o descargar todo el histórico.
- **Simulador del ESP32** para probar sin hardware; disponible solo en modo demostración.

## Ejecutar

```bash
npm install
npm run dev        # desarrollo
npm run build      # versión instalable (PWA) en dist/
npm run preview    # probar la versión de producción
```

**Celular (PWA):** publica `dist/` en un hosting con HTTPS (Netlify, Vercel, GitHub Pages o un servidor de la universidad) y en Chrome para Android elige *Menú → Instalar aplicación*. Funciona sin internet.

**APK (Capacitor):** requiere Android Studio y JDK 17.

El APK se compila solo en GitHub Actions (pestaña **Actions → Compilar APK**) y queda en **Releases**. Si existen los secretos de firma (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) se genera un APK *release* firmado; si no, uno de depuración.

Para compilar en la PC: `npm run android:sync` y luego `npx cap open android`.

## Módulos

| Módulo | Función |
|---|---|
| Dashboard | Indicadores climáticos del periodo e indicadores agronómicos del tomate (horas con calor, frío o HR elevada, horas dentro del rango, mayor variación térmica y periodo de mayor humedad) |
| Registrar datos | Registro manual o lectura de un sensor, con origen, identificador del sensor y estado de validación |
| Gráficos | 1 Temperatura · 2 Humedad relativa · 3 T vs HR · 4 Evolución diaria/semanal · 5 Comparaciones (día vs día, semana vs semana, mañana vs tarde, etapas, interior vs exterior) · 6 Distribución y horas críticas · 7 Correlación (n ≥ 10) |
| Problemas climáticos | Exceso de temperatura, temperatura baja, HR elevada o baja, variaciones bruscas, falta de datos y datos sospechosos. Cada problema separa **hechos**, **interpretación** y **recomendaciones** |
| Análisis climático | Respuestas a las 10 preguntas prácticas, conclusiones basadas en datos, comparación por franja horaria y por etapa fenológica |
| Historial | Filtros por origen y validación; marcar datos como válidos, sospechosos o descartados |
| Cultivo de tomate | Cronología de etapas: semillero, crecimiento vegetativo, floración, fructificación y maduración |
| Reportes académicos | PDF de 16 puntos, Excel con hojas de problemas, preguntas e interpretación, y CSV |
| Importar | Excel, CSV y JSON de sensores o dataloggers, con vista previa, validación, duplicados, datos faltantes y marcado de sospechosos |
| Configuración | Referencias del tomate por etapa, estudio (título y problema), fuentes incluidas, variables, respaldo |

## Origen y validación de los datos

Cada registro guarda su **origen** (`sensor`, `manual`, `importado` o `demo`), el **identificador del sensor** y su **estado de validación**:

- **Válido:** se usa en el análisis.
- **Sospechoso:** se usa y queda marcado para revisión. Se asigna automáticamente con HR de 100 %, valores atípicos o saltos de 8 °C o más en 30 minutos o menos.
- **Descartado:** se conserva en el historial, pero se excluye de cálculos, gráficos y reportes.

Los **datos de demostración** (45 días simulados de un datalogger cada 30 min) se guardan aparte y nunca se mezclan con los reales.

## Referencias climáticas del tomate

Son **rangos referenciales configurables según la variedad, la etapa fenológica y la bibliografía utilizada**. No son mediciones. Valores de partida:

| Aplica a | Temperatura (°C) | HR (%) |
|---|---|---|
| General | 15 – 30 | 60 – 85 |
| Semillero | 20 – 30 | 70 – 90 |
| Crecimiento vegetativo | 18 – 30 | 60 – 80 |
| Floración | 15 – 30 | 60 – 80 |
| Fructificación | 15 – 30 | 60 – 85 |
| Maduración | 18 – 30 | 60 – 85 |

Cada registro se evalúa con el rango más específico disponible: cultivo y etapa, luego etapa del tomate, luego cultivo y por último el rango general.

## Cálculos principales

- Promedio = Σ valores / n · Amplitud = máximo − mínimo · desviación estándar · r de Pearson.
- **Horas estimadas:** cada lectura representa el intervalo hasta la siguiente, con un tope de 1,5 × el intervalo típico. Así no se cuentan como horas registradas los vacíos de datos.
- **Periodos continuos** fuera de la referencia: se interrumpen cuando hay vacíos de datos.
- **Suficiencia:** con menos de 12 registros, o con un intervalo típico mayor a 3 h, la app avisa que los datos son limitados.

## Documentación

- `docs/integracion-sensores.md`: formatos de archivo y contrato para una API de sensores.
- `docs/base-de-datos.sql`: modelo relacional equivalente (PostgreSQL).

## Arquitectura

React 18 + TypeScript + Vite · IndexedDB (Dexie, esquema v2 con migración automática) · Apache ECharts · SheetJS · jsPDF · vite-plugin-pwa.

```
src/db/        modelo, migración, referencias del tomate, datos de demostración
src/lib/       stats · agro (horas, periodos, comparaciones, calidad) · problems · applied (preguntas y conclusiones) · analysis · importer · validation
src/charts/    options.ts (gráficos generales) · tomato.ts (gráficos del tomate)
src/pages/     Dashboard · RecordForm · Charts · Problems · Analysis · History · Crops · Reports · ImportData · Settings
src/reports/   pdf.ts (reporte académico) · spreadsheet.ts · tables.ts
```
