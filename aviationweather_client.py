"""Cliente AviationWeather Center para METAR/TAF de aeródromos argentinos."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

import requests

log = logging.getLogger(__name__)

AW_METAR_URL = "https://aviationweather.gov/api/data/metar"
DEFAULT_TIMEOUT = 45
USER_AGENT = "mi-pom/1.0 (argentina-metar-viewer; https://github.com/negrofei/mi-pom)"

# Colores estándar de categoría de vuelo
FLT_CAT_COLORS = {
    "VFR": "#00aa00",
    "MVFR": "#0066ff",
    "IFR": "#ff0000",
    "LIFR": "#ff00ff",
}


def _ceil_ft_from_clouds(clouds: list[dict] | None) -> Optional[int]:
    """Techo = base más baja de BKN/OVC/VV (pies AGL)."""
    if not clouds:
        return None
    bases: list[int] = []
    for c in clouds:
        cover = str(c.get("cover") or "").upper()
        if cover not in ("BKN", "OVC", "VV", "OVX"):
            continue
        base = c.get("base")
        if base is None:
            continue
        try:
            bases.append(int(base))
        except (TypeError, ValueError):
            continue
    return min(bases) if bases else None


def _vis_m_from_aw(visib: Any, raw: str | None = None) -> Optional[int]:
    """
    AviationWeather decodifica visibilidad en millas estatuto (SM).
    Convierte a metros. También intenta leer metros del METAR crudo (grupo VV).
    """
    # Preferir metros del texto crudo (METARs AR suelen usar metros)
    if raw:
        import re

        m = re.search(r"\b(\d{4})\b", raw)
        # Evitar confundir con QNH/hora: el grupo de vis suele estar antes de tiempo presente
        # Heurística: 4 dígitos entre viento y nubes / CAVOK
        m2 = re.search(
            r"\b(?:\d{3}|VRB)\d{2}(?:G\d{2})?KT\s+(?:(\d{4})\s+|(CAVOK)\b)",
            raw,
        )
        if m2:
            if m2.group(2) == "CAVOK":
                return 10000
            try:
                return int(m2.group(1))
            except (TypeError, ValueError):
                pass
        if "CAVOK" in (raw or ""):
            return 10000

    if visib is None:
        return None
    if isinstance(visib, str):
        s = visib.strip().upper()
        if s in ("CAVOK", "P6SM", "6+", "6SM+"):
            return 10000
        if s.endswith("+"):
            s = s[:-1]
        if s.endswith("SM"):
            s = s[:-2]
        try:
            sm = float(s)
        except ValueError:
            return None
        return int(round(sm * 1609.34))
    try:
        sm = float(visib)
    except (TypeError, ValueError):
        return None
    return int(round(sm * 1609.34))


def flight_category(ceiling_ft: Optional[int], vis_m: Optional[int]) -> Optional[str]:
    """
    Categoría operativa (la más restrictiva entre techo y visibilidad):
      VFR  — techo > 3000 ft  y  vis > 8000 m
      MVFR — techo 1000–3000  o  vis 5000–8000
      IFR  — techo 500–999    o  vis 1500–4999
      LIFR — techo < 500      o  vis < 1500
    """
    cats: list[str] = []

    if ceiling_ft is not None:
        if ceiling_ft < 500:
            cats.append("LIFR")
        elif ceiling_ft < 1000:
            cats.append("IFR")
        elif ceiling_ft <= 3000:
            cats.append("MVFR")
        else:
            cats.append("VFR")

    if vis_m is not None:
        if vis_m < 1500:
            cats.append("LIFR")
        elif vis_m < 5000:
            cats.append("IFR")
        elif vis_m <= 8000:
            cats.append("MVFR")
        else:
            cats.append("VFR")

    if not cats:
        return None
    rank = {"LIFR": 0, "IFR": 1, "MVFR": 2, "VFR": 3}
    return min(cats, key=lambda c: rank[c])


def _normalize_metar(row: dict, airports: dict[str, dict]) -> dict[str, Any]:
    icao = str(row.get("icaoId") or "").upper()
    meta = airports.get(icao) or {}
    clouds = row.get("clouds") or []
    ceiling = _ceil_ft_from_clouds(clouds)
    raw = row.get("rawOb") or row.get("rawObText") or ""
    vis_m = _vis_m_from_aw(row.get("visib"), raw)
    # Preferir cálculo local; si falta dato, usar fltCat de AW
    flt = flight_category(ceiling, vis_m) or (row.get("fltCat") or None)
    if isinstance(flt, str):
        flt = flt.upper()

    report_time = row.get("reportTime")
    obs_iso = None
    hour_key = None
    if report_time:
        try:
            dt = datetime.fromisoformat(str(report_time).replace("Z", "+00:00"))
            obs_iso = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            hour_key = dt.astimezone(timezone.utc).strftime("%Y%m%d%H")
        except ValueError:
            pass

    metar_type = str(row.get("metarType") or "").upper() or None
    is_speci = metar_type == "SPECI" or raw.strip().upper().startswith("SPECI")

    return {
        "icao": icao,
        "nombre": meta.get("nombre") or row.get("name") or icao,
        "lat": meta.get("lat", row.get("lat")),
        "lng": meta.get("lng", row.get("lon")),
        "elev": meta.get("elev", row.get("elev")),
        "fir": meta.get("fir"),
        "iata": meta.get("iata"),
        "obs_iso": obs_iso,
        "hour_key": hour_key,
        "temp_c": row.get("temp"),
        "dewpoint_c": row.get("dewp"),
        "wind_dir": row.get("wdir"),
        "wind_speed_kt": row.get("wspd"),
        "wind_gust_kt": row.get("wgst"),
        "visibility_m": vis_m,
        "visib_raw": row.get("visib"),
        "altim_hpa": row.get("altim"),
        "wx_string": row.get("wxString"),
        "cover": row.get("cover"),
        "clouds": clouds,
        "ceiling_ft": ceiling,
        "flt_cat": flt,
        "flt_cat_color": FLT_CAT_COLORS.get(flt or "", "#888888"),
        "raw": raw,
        "raw_taf": row.get("rawTaf") or None,
        "metar_type": metar_type or ("SPECI" if is_speci else "METAR"),
        "is_speci": is_speci,
        "source": "AviationWeather",
    }


def _fetch_metar_rows(ids: list[str], hours: int, include_taf: bool) -> list[dict]:
    hours = max(1, min(int(hours), 48))
    chunk_size = 80
    rows: list[dict] = []
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i : i + chunk_size]
        params = {
            "ids": ",".join(chunk),
            "format": "json",
            "hours": str(hours),
            "taf": "true" if include_taf else "false",
        }
        log.info("AviationWeather METAR chunk %s-%s hours=%s", i, i + len(chunk), hours)
        resp = requests.get(
            AW_METAR_URL,
            params=params,
            timeout=DEFAULT_TIMEOUT,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        if resp.status_code == 204:
            continue
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            rows.extend(data)
    return rows


def fetch_argentina_metars(
    *,
    airports: dict[str, dict],
    hours: int = 1,
    include_taf: bool = True,
    timeline: str = "latest",
    when: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """
    Trae METARs (y TAF opcional) para el catálogo de aeródromos.
    timeline=latest → último METAR por ICAO dentro de la ventana.
    timeline=exact  → METAR de la hora `when` (si existe).
    """
    hours = max(1, min(int(hours), 24))
    ids = sorted(airports.keys())
    if not ids:
        return []

    rows = _fetch_metar_rows(ids, hours, include_taf)
    normalized = [_normalize_metar(r, airports) for r in rows if r.get("icaoId")]
    normalized = [n for n in normalized if n["icao"] in airports]

    if timeline == "exact" and when is not None:
        target = when.astimezone(timezone.utc).strftime("%Y%m%d%H")
        by_icao: dict[str, dict] = {}
        for n in normalized:
            if n.get("hour_key") != target:
                continue
            prev = by_icao.get(n["icao"])
            if prev is None or (n.get("obs_iso") or "") >= (prev.get("obs_iso") or ""):
                by_icao[n["icao"]] = n
        return sorted(by_icao.values(), key=lambda x: x["icao"])

    # latest por ICAO
    by_icao = {}
    for n in normalized:
        prev = by_icao.get(n["icao"])
        if prev is None or (n.get("obs_iso") or "") >= (prev.get("obs_iso") or ""):
            by_icao[n["icao"]] = n
    return sorted(by_icao.values(), key=lambda x: x["icao"])


def fetch_station_metars(
    icao: str,
    *,
    airports: dict[str, dict],
    hours: int = 24,
    include_taf: bool = True,
) -> list[dict[str, Any]]:
    """Serie de METARs de un aeródromo (más reciente primero)."""
    icao = str(icao).upper().strip()
    if icao not in airports:
        raise KeyError(f"Aeródromo {icao} no está en el catálogo")
    hours = max(1, min(int(hours), 48))
    rows = _fetch_metar_rows([icao], hours, include_taf)
    normalized = [_normalize_metar(r, airports) for r in rows if r.get("icaoId")]
    normalized = [n for n in normalized if n["icao"] == icao]
    normalized.sort(key=lambda n: n.get("obs_iso") or "", reverse=True)
    return normalized
