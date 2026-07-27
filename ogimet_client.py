"""Cliente OGIMET getsynop para estaciones de Argentina."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

from synop_parser import SynopDecoded, parse_synop

log = logging.getLogger(__name__)

OGIMET_URL = "https://www.ogimet.com/cgi-bin/getsynop"
DEFAULT_TIMEOUT = 45


def _floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def resolve_synop_hour(hour: Optional[str] = None) -> datetime:
    """
    hour: 'YYYYMMDDHH' en UTC, o None → hora sinóptica más reciente
    (0, 3, 6, 9, 12, 15, 18, 21) con fallback a la hora llena actual.
    Preferimos la hora llena más reciente (OGIMET suele tener horarias).
    """
    now = datetime.now(timezone.utc)
    if hour:
        try:
            return datetime.strptime(hour, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        except ValueError as exc:
            raise ValueError("Formato de hora inválido. Usar YYYYMMDDHH (UTC).") from exc
    return _floor_hour(now)


def fetch_argentina_synops(
    when: datetime,
    *,
    stations: dict[str, dict],
    lookback_hours: int = 0,
) -> list[SynopDecoded]:
    """
    Trae SYNOPs de Argentina para la hora indicada (UTC).
    Si lookback_hours > 0, busca también horas anteriores y se queda
    con el último reporte por estación dentro de la ventana.
    """
    end = when.replace(minute=59, second=0, microsecond=0)
    begin = (when - timedelta(hours=lookback_hours)).replace(
        minute=0, second=0, microsecond=0
    )

    params = {
        "begin": begin.strftime("%Y%m%d%H%M"),
        "end": end.strftime("%Y%m%d%H%M"),
        "state": "Argent",
        "header": "yes",
        "lang": "eng",
    }

    log.info("OGIMET request %s", params)
    resp = requests.get(OGIMET_URL, params=params, timeout=DEFAULT_TIMEOUT)
    resp.raise_for_status()
    text = resp.text

    # A veces OGIMET responde HTML de error/rate-limit
    if "<html" in text.lower():
        raise RuntimeError("OGIMET devolvió HTML en lugar de CSV. Reintentar más tarde.")

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []

    # Saltar header si está
    start = 1 if rows[0] and rows[0][0].upper().startswith("WMO") else 0

    # Quedarse con el reporte más cercano a `when` por estación
    best: dict[str, tuple[datetime, SynopDecoded]] = {}

    for row in rows[start:]:
        if len(row) < 7:
            continue
        omm, y, m, d, h, mi, report = row[0], row[1], row[2], row[3], row[4], row[5], row[6]
        try:
            obs_dt = datetime(
                int(y), int(m), int(d), int(h), int(mi), tzinfo=timezone.utc
            )
        except ValueError:
            continue

        decoded = parse_synop(
            report,
            omm,
            year=int(y),
            month=int(m),
            day=int(d),
            hour=int(h),
            minute=int(mi),
        )
        meta = stations.get(str(omm))
        if meta:
            decoded.lat = meta.get("lat")
            decoded.lng = meta.get("lng")
            decoded.nombre = meta.get("nombre")
        else:
            continue  # solo estaciones del catálogo AR

        prev = best.get(omm)
        if prev is None or abs((obs_dt - when).total_seconds()) <= abs(
            (prev[0] - when).total_seconds()
        ):
            # Preferir el más reciente si empatan
            if prev is None or obs_dt >= prev[0]:
                best[omm] = (obs_dt, decoded)

    return [v[1] for v in best.values()]
