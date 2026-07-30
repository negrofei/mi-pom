# SYNOP Argentina (OGIMET)

Visor web de mensajes **SYNOP** de estaciones argentinas, con ploteo tipo modelo de estación sobre un mapa. Los datos se consultan en vivo a [OGIMET](https://www.ogimet.com/) (no usa base de datos interna).

## Qué incluye

- Mapa interactivo (Leaflet) centrado en Argentina
- Ploteo SYNOP con PNGs (`img/barbs`, `img/simbolos`): barbas, N, T/Td, presión, tendencia, ww, Nh/CL/CM/CH
- **Dos grupos de nubosidad** cuando existen: sección 1 (`8NhCLCMCH`) y capas de sección 3 (`8NsChshs`)
- Hover sobre estaciones / tipos de nube / capas sec.3
- Panel con el mensaje crudo y campos decodificados
- **Serie temporal 24 h** por estación (botón en el detalle): T/Td, barbas, nubes bajas, visibilidad y ww, con tooltips al hover
- Selector de hora UTC
- Catálogo de 121 estaciones del SMN (coordenadas)

## Correr en local (con Docker)

No hace falta instalar Python ni nada más:

```bash
docker compose up --build
```

Abrí http://localhost:8080

## Desplegar online (lo más fácil: Render)

1. Subí este repo a GitHub.
2. Entrá a [https://render.com](https://render.com) → **New** → **Web Service**.
3. Conectá el repo.
4. Render detecta el `Dockerfile`. Dejá:
   - **Runtime:** Docker
   - **Instance:** Free (o el plan que quieras)
5. **Create Web Service** y esperá la URL pública.

Alternativas iguales de simples: [Railway](https://railway.app) o [Fly.io](https://fly.io) apuntando al mismo `Dockerfile`.

## Configuración (UI)

Panel **Configuración** en la barra superior:

- **Autorefresh**: actualiza cada 2 minutos
- **Timeline**
  - *Solo hora seleccionada*: solo estaciones con dato en esa hora UTC
  - *Último dato disponible*: último reporte de cada estación (ventana 24 h)
- **Separación de símbolos**: acerca/aleja los símbolos del punto de estación sin cambiar su tamaño

## API

- `GET /api/synops?hour=YYYYMMDDHH&nil=0&timeline=exact|latest&lookback=24`
- `GET /api/synops/<omm>?hours=24&hour=YYYYMMDDHH&nil=0` — serie horaria de una estación
- `GET /api/stations` — catálogo
- `GET /health` — healthcheck

## Notas

- OGIMET a veces tarda o limita; el backend tiene timeout y muestra el error en pantalla.
- Los iconos viven en `img/barbs` e `img/simbolos` (se sirven en `/img/...`).
- Si un SYNOP trae grupo 8 en sección 1 y uno o más `8NsChshs` en sección 3, el plot y el hover muestran **ambos**.
- Zona horaria de consulta: **UTC**.
- Nota: en `simbolos/` hay ww 56–99; si falta un código bajo, se muestra el número en texto.
