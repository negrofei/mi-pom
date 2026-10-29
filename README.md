# SYNOP / METAR Argentina — vigilancia-dma

Visor web de **SYNOP** y **METAR** sobre un mapa de Argentina.
Fuente primaria: MySQL DMA (`10.10.100.121`); fallback AviationWeather / OGIMET.

## Qué incluye

- Mapa interactivo (Leaflet) centrado en Argentina, base **Argenmap IGN**
- **Modo SYNOP**: ploteo de estación; hover/plot desde columna **AEROMET** de `synop_obs` (si falta, se decodifica el SYNOP)
- **Modo METAR**: vigilancia con cascade DMA SPECI → METAR → SYNOP → AW → OGIMET
- Contornos **FIR** y filtro por región
- Serie temporal 24 h por estación SYNOP (OGIMET)
- Selector de hora UTC
- Alertas SPECI y posibles enmiendas TAF

## Correr en local (con Docker)

```bash
cp .env.example .env   # completar DMA_MYSQL_USER / PASSWORD
# Conectá la VPN primero, después:
docker compose up --build
```

Abrí http://localhost:8080 → redirige a `/synop`.

El compose usa `network_mode: host` para que el contenedor use las **mismas rutas que la VPN** del host. Sin eso, DBeaver (host) puede llegar a `10.10.100.121` y el contenedor no (`No route to host`), sobre todo después de apagar/prender la VPN. Si reconectás la VPN, reiniciá el contenedor:

```bash
docker compose restart
```

La imagen incluye el cliente `mysql` (no hace falta instalarlo en el host).
El servidor DMA **no soporta TLS**: hay que desactivar SSL en el cliente.

```bash
# En el host (o DBeaver):
mysql -h 10.10.100.121 -u consulta -p --ssl=0 mensajes

# Desde el contenedor (con network_mode: host):
docker compose exec synop sh -c 'mysql -h "$DMA_MYSQL_HOST" -u "$DMA_MYSQL_USER" -p"$DMA_MYSQL_PASSWORD" --ssl=0 "$DMA_MYSQL_DATABASE" \
  -e "SHOW TABLES LIKE \"%_obs\"; DESCRIBE synop_obs;"'
```

## Variables DMA

| Variable | Default | Descripción |
|---|---|---|
| `DMA_MYSQL_HOST` | `10.10.100.121` | Host MySQL |
| `DMA_MYSQL_PORT` | `3306` | Puerto |
| `DMA_MYSQL_USER` | _(vacío)_ | Usuario (obligatorio) |
| `DMA_MYSQL_PASSWORD` | _(vacío)_ | Password |
| `DMA_MYSQL_DATABASE` | `mensajes` | Base |
| `DMA_TABLE_METAR` | `metar_obs` | METARs |
| `DMA_TABLE_SPECI` | `speci_obs` | SPECIs |
| `DMA_TABLE_SYNOP` | `synop_obs` | SYNOPs (+ `AEROMET`) |
| `DMA_TABLE_TAF` | `taf_obs` | TAFs |

El cliente detecta columnas de estación/fecha/mensaje/`AEROMET` por nombre (p.ej. `CodEstacion`, `FechaHora`, `Mensaje`).

## API

- `GET /api/synops?hour=YYYYMMDDHH&nil=0&timeline=exact|latest&lookback=24` — DMA→OGIMET
- `GET /api/synops/<omm>?hours=24` — serie horaria (OGIMET)
- `GET /api/surveillance` — vigilancia METAR (DMA → AW/OGIMET)
- `GET /api/specis` — SPECI vigentes
- `GET /api/taf-amends` — posibles enmiendas TAF
- `GET /api/dma/status` — sondeo MySQL DMA
- `GET /health` — healthcheck (+ estado DMA)

## Cascade vigilancia METAR

1. DMA `speci_obs`
2. DMA `metar_obs`
3. DMA `synop_obs` (AEROMET)
4. AviationWeather SPECI/METAR
5. OGIMET SYNOP

TAF para enmiendas: DMA `taf_obs` → AviationWeather.
Series temporales (`/api/metars/<icao>`, `/api/synops/<omm>`): DMA → AW / OGIMET.

Si DMA no responde → contingencia AW/OGIMET (`contingency_only`).

## Notas

- Zona horaria de consulta: **UTC**.
- SYNOP **NIL** no se muestran en la pestaña METAR.
- Iconos en `img/barbs` e `img/simbolos` (`/img/...`).
