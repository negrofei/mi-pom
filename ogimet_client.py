"""Cliente OGIMET getsynop para estaciones de Argentina."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import requests

from synop_parser import SynopDecoded, parse_synop

log = logging.getLogger(__name__)

OGIMET_URL = "https://www.ogimet.com/cgi-bin/getsynop"
DEFAULT_TIMEOUT = 45

TimelineMode = Literal["exact", "latest"]


def _floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def resolve_synop_hour(hour: Optional[str] = None) -> datetime:
    """
    hour: 'YYYYMMDDHH' en UTC, o None → hora llena UTC más reciente.
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
    timeline: TimelineMode = "exact",
    lookback_hours: int = 24,
) -> list[SynopDecoded]:
    """
    Trae SYNOPs de Argentina.

    timeline=exact  → solo reportes de la hora `when` (estaciones sin esa hora no aparecen).
    timeline=latest → último reporte de cada estación en [when-lookback, when].
    """
    end = when.replace(minute=59, second=0, microsecond=0)
    if timeline == "exact":
        begin = when.replace(minute=0, second=0, microsecond=0)
    else:
        begin = (when - timedelta(hours=max(1, lookback_hours))).replace(
            minute=0, second=0, microsecond=0
        )

    params = {
        "begin": begin.strftime("%Y%m%d%H%M"),
        "end": end.strftime("%Y%m%d%H%M"),
        "state": "Argent",
        "header": "yes",
        "lang": "eng",
    }

    log.info("OGIMET request timeline=%s %s", timeline, params)
    resp = requests.get(OGIMET_URL, params=params, timeout=DEFAULT_TIMEOUT)
    resp.raise_for_status()
    text = resp.text

    if "<html" in text.lower():
        raise RuntimeError("OGIMET devolvió HTML en lugar de CSV. Reintentar más tarde.")

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []

    start = 1 if rows[0] and rows[0][0].upper().startswith("WMO") else 0
    best: dict[str, tuple[datetime, SynopDecoded]] = {}

    for row in rows[start:]:
        if len(row) < 7:
            continue
        omm, y, m, d, h, mi, report = (
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
            row[5],
            row[6],
        )
        try:
            obs_dt = datetime(
                int(y), int(m), int(d), int(h), int(mi), tzinfo=timezone.utc
            )
        except ValueError:
            continue

        if timeline == "exact":
            if obs_dt.replace(minute=0, second=0, microsecond=0) != when.replace(
                minute=0, second=0, microsecond=0
            ):
                continue
        else:
            if obs_dt > end:
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
        if not meta:
            continue
        decoded.lat = meta.get("lat")
        decoded.lng = meta.get("lng")
        decoded.nombre = meta.get("nombre")

        prev = best.get(omm)
        if timeline == "exact":
            # Preferir el más reciente dentro de esa hora
            if prev is None or obs_dt >= prev[0]:
                best[omm] = (obs_dt, decoded)
        else:
            # Último disponible (<= when)
            if prev is None or obs_dt > prev[0]:
                best[omm] = (obs_dt, decoded)

    return [v[1] for v in best.values()]
