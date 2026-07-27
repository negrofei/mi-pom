# SYNOP Argentina (OGIMET)

Visor web de mensajes **SYNOP** de estaciones argentinas, con ploteo tipo modelo de estación sobre un mapa. Los datos se consultan en vivo a [OGIMET](https://www.ogimet.com/) (no usa base de datos interna).

## Qué incluye

- Mapa interactivo (Leaflet) centrado en Argentina
- Ploteo SYNOP: barbas de viento, cobertura nubosa, temperatura, rocío, presión, tendencia, ww, Nh/CL/CM/CH
- Hover sobre estaciones (y tip de tipos de nube)
- Panel con el mensaje crudo y campos decodificados
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

## API

- `GET /api/synops?hour=YYYYMMDDHH&nil=0` — SYNOPs decodificados
- `GET /api/stations` — catálogo
- `GET /health` — healthcheck

## Notas

- OGIMET a veces tarda o limita; el backend tiene timeout y muestra el error en pantalla.
- Los símbolos se dibujan en **SVG** (no dependen de PNGs del sistema original). Si más adelante subís `img/barbs` e `img/simbolos`, se pueden enchufar como íconos alternativos.
- Zona horaria de consulta: **UTC**.
