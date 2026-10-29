"""Parsea la columna AEROMET de synop_obs hacia campos de plot/hover SYNOP."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from metar_parser import parse_metar_raw, parse_metar_time
from synop_parser import CLOUD_GENUS, barb_key

# Boletín tipo METAR/AEROMET (con o sin prefijo AEROMET)
_RE_AERO_HEADER = re.compile(
    r"\b(?:AEROMET|METAR|SPECI)?\s*(?P<id>[A-Z]{4}|\d{5})\s+(?P<ddhhmm>\d{6})Z\b",
    re.I,
)
_RE_WIND = re.compile(
    r"\b(?P<dir>\d{3}|VRB)(?P<spd>\d{2,3})(?:G(?P<gust>\d{2,3}))?KT\b", re.I
)
_RE_VIS = re.compile(r"\b(?P<vis>\d{4})\b")
_RE_CAVOK = re.compile(r"\bCAVOK\b", re.I)
_RE_CLOUD = re.compile(
    r"\b(?P<cover>FEW|SCT|BKN|OVC|VV)(?P<base>\d{3})?(?P<conv>CB|TCU)?\b", re.I
)
_RE_TEMP = re.compile(r"\b(?P<t>M?\d{2})/(?P<td>M?\d{2})\b")
_RE_QNH = re.compile(r"\bQ(?P<qnh>\d{4})\b")
_RE_WX = re.compile(
    r"\b(?:\+|-|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?"
    r"(?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+\b"
)

# Texto etiquetado (español / clave=valor)
_RE_WIND_LABELED = re.compile(
    r"(?i)\b(?:viento|wind)\s*[:=]?\s*(?P<dir>\d{1,3})\s*[°/]\s*(?P<spd>\d{1,3})"
)
_LABEL_SPECS: list[tuple[str, re.Pattern[str]]] = [
    ("temp_c", re.compile(r"(?i)\b(?:temp(?:eratura)?|tt?)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*C?\b")),
    ("dewpoint_c", re.compile(r"(?i)\b(?:roc[ií]o|td|dew(?:point)?)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*C?\b")),
    ("msl_pressure", re.compile(r"(?i)\b(?:presi[oó]n|qnh|msl|slp)\s*[:=]?\s*(\d{3,4}(?:[.,]\d+)?)\s*(?:hpa|mb)?\b")),
    ("visibility_m", re.compile(r"(?i)\b(?:vis(?:ibilidad)?)\s*[:=]?\s*(\d+)\s*(?:m|metros)?\b")),
    ("total_cloud", re.compile(r"(?i)\b(?:nubes|cobertura|N)\s*[:=]?\s*([0-9/])\b")),
]


_COVER_TO_OKTAS = {"FEW": "2", "SCT": "4", "BKN": "6", "OVC": "8", "VV": "9"}


def _temp_token(tok: str) -> float:
    if tok.upper().startswith("M"):
        return -float(tok[1:])
    return float(tok)


def _as_float(raw: str) -> Optional[float]:
    try:
        return float(str(raw).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _cloud_layers_from_metar(clouds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    layers: list[dict[str, Any]] = []
    for c in clouds:
        cover = str(c.get("cover") or "").upper()
        base_ft = c.get("base")
        genus = None
        conv = c.get("type") or c.get("convective")
        if conv:
            genus = "9" if str(conv).upper() == "CB" else "8"
        layers.append(
            {
                "ns": _COVER_TO_OKTAS.get(cover),
                "genus": genus,
                "genus_name": CLOUD_GENUS.get(genus) if genus else cover,
                "hs": None,
                "height_m": int(round(base_ft / 3.28084)) if isinstance(base_ft, (int, float)) else None,
                "height_ft": int(base_ft) if isinstance(base_ft, (int, float)) else None,
                "raw": f"{cover}{int(base_ft / 100):03d}" if isinstance(base_ft, (int, float)) else cover,
            }
        )
    return layers


def _parse_bulletin(text: str, *, omm: str, now: Optional[datetime] = None) -> Optional[dict[str, Any]]:
    """Intenta interpretar AEROMET como boletín METAR-like."""
    compact = " ".join(str(text).replace("=", " ").split())
    if not compact:
        return None

    # Reusar parser METAR si trae METAR/SPECI + ICAO
    metarish = parse_metar_raw(
        compact if re.match(r"(?i)^(METAR|SPECI)\b", compact) else f"METAR {compact}",
        now=now,
        source="DMA",
        wmo=omm,
    )
    header = _RE_AERO_HEADER.search(compact)
    if not metarish and not header:
        # Prefijo AEROMET sin ICAO de 4 letras: forzar parse manual
        if not re.search(r"\b\d{5}\b", compact) and "KT" not in compact.upper():
            return None

    out: dict[str, Any] = {
        "omm": str(omm),
        "raw_aeromet": compact,
        "source": "DMA",
        "nil": False,
        "notes": ["from_aeromet"],
        "cloud_layers": [],
    }

    if metarish and (
        metarish.get("temp_c") is not None
        or metarish.get("wind_speed_kt") is not None
        or metarish.get("visibility_m") is not None
    ):
        qnh = metarish.get("altim_hpa")
        vis_m = metarish.get("visibility_m")
        clouds = metarish.get("clouds") or []
        out.update(
            {
                "icao": metarish.get("icao"),
                "obs_iso": metarish.get("obs_iso"),
                "hour_key": metarish.get("hour_key"),
                "utc": None,
                "temp_c": metarish.get("temp_c"),
                "dewpoint_c": metarish.get("dewpoint_c"),
                "wind_dir": metarish.get("wind_dir"),
                "wind_speed_kt": metarish.get("wind_speed_kt"),
                "wind_gust_kt": metarish.get("wind_gust_kt"),
                "wind_barb": metarish.get("wind_barb")
                or barb_key(metarish.get("wind_speed_kt"), metarish.get("wind_dir")),
                "visibility_m": vis_m,
                "visibility": (
                    f"{vis_m:04d}"
                    if isinstance(vis_m, int) and vis_m < 10000
                    else ("9999" if vis_m else None)
                ),
                "msl_pressure": float(qnh) if isinstance(qnh, (int, float)) else None,
                "pressure_plot": (
                    f"{int(round(float(qnh) * 10)) % 1000:03d}"
                    if isinstance(qnh, (int, float))
                    else None
                ),
                "present_weather": metarish.get("wx_string"),
                "total_cloud": (
                    _COVER_TO_OKTAS.get(str(clouds[-1].get("cover") or "").upper())
                    if clouds
                    else None
                ),
                "cloud_layers": _cloud_layers_from_metar(clouds),
            }
        )
        if out.get("obs_iso"):
            try:
                dt = datetime.fromisoformat(out["obs_iso"].replace("Z", "+00:00"))
                out["utc"] = dt.strftime("%d/%m/%Y %H:%M")
            except ValueError:
                pass
        return out

    # Parse manual AEROMET id ddhhmmZ …
    if not header:
        return None
    sid = header.group("id")
    dt = parse_metar_time(header.group("ddhhmm"), now=now or datetime.now(timezone.utc))
    body = compact[header.end() :]
    wind = _RE_WIND.search(body)
    wind_dir = None
    wind_speed = None
    wind_gust = None
    if wind:
        d = wind.group("dir").upper()
        wind_dir = None if d == "VRB" else int(d)
        wind_speed = int(wind.group("spd"))
        if wind.group("gust"):
            wind_gust = int(wind.group("gust"))

    if _RE_CAVOK.search(body):
        vis_m = 10000
    else:
        vis_m = None
        after = body[wind.end() :] if wind else body
        vm = _RE_VIS.search(after)
        if vm:
            vis_m = int(vm.group("vis"))

    clouds: list[dict[str, Any]] = []
    for cm in _RE_CLOUD.finditer(body):
        cover = cm.group("cover").upper()
        base = int(cm.group("base")) * 100 if cm.group("base") else None
        conv = cm.group("conv").upper() if cm.group("conv") else None
        item: dict[str, Any] = {"cover": cover, "base": base}
        if conv:
            item["type"] = conv
        clouds.append(item)

    tm = _RE_TEMP.search(body)
    temp_c = _temp_token(tm.group("t")) if tm else None
    dew_c = _temp_token(tm.group("td")) if tm else None
    qm = _RE_QNH.search(body)
    qnh = float(qm.group("qnh")) if qm else None
    wx = [m.group(0).upper() for m in _RE_WX.finditer(body)]

    out.update(
        {
            "icao": sid if len(sid) == 4 and sid.isalpha() else None,
            "obs_iso": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "hour_key": dt.strftime("%Y%m%d%H"),
            "utc": dt.strftime("%d/%m/%Y %H:%M"),
            "temp_c": temp_c,
            "dewpoint_c": dew_c,
            "wind_dir": wind_dir,
            "wind_speed_kt": float(wind_speed) if wind_speed is not None else None,
            "wind_gust_kt": float(wind_gust) if wind_gust is not None else None,
            "wind_barb": barb_key(
                float(wind_speed) if wind_speed is not None else None,
                wind_dir,
                variable=bool(wind and wind.group("dir").upper() == "VRB"),
            ),
            "visibility_m": vis_m,
            "visibility": (
                f"{vis_m:04d}" if isinstance(vis_m, int) and vis_m < 10000 else ("9999" if vis_m else None)
            ),
            "msl_pressure": qnh,
            "pressure_plot": f"{int(round(qnh * 10)) % 1000:03d}" if qnh is not None else None,
            "present_weather": " ".join(wx) or None,
            "total_cloud": _COVER_TO_OKTAS.get(clouds[-1]["cover"]) if clouds else None,
            "cloud_layers": _cloud_layers_from_metar(clouds),
        }
    )
    return out


def _parse_labeled(text: str, *, omm: str) -> Optional[dict[str, Any]]:
    hits = 0
    out: dict[str, Any] = {
        "omm": str(omm),
        "raw_aeromet": " ".join(str(text).split()),
        "source": "DMA",
        "nil": False,
        "notes": ["from_aeromet_labeled"],
        "cloud_layers": [],
        "wind_barb": "0",
    }
    wm = _RE_WIND_LABELED.search(text)
    if wm:
        hits += 1
        out["wind_dir"] = int(wm.group("dir"))
        out["wind_speed_kt"] = float(wm.group("spd"))
    for key, pat in _LABEL_SPECS:
        m = pat.search(text)
        if not m:
            continue
        hits += 1
        val = m.group(1)
        if key in ("temp_c", "dewpoint_c", "msl_pressure"):
            out[key] = _as_float(val)
        elif key == "visibility_m":
            try:
                out[key] = int(float(str(val).replace(",", ".")))
            except ValueError:
                out[key] = val
        else:
            out[key] = val
    if hits < 2:
        return None
    if out.get("visibility_m") is not None and out.get("visibility") is None:
        vm = out["visibility_m"]
        if isinstance(vm, int):
            out["visibility"] = f"{vm:04d}" if vm < 10000 else "9999"
    out["wind_barb"] = barb_key(out.get("wind_speed_kt"), out.get("wind_dir"))
    if isinstance(out.get("msl_pressure"), float):
        out["pressure_plot"] = f"{int(round(out['msl_pressure'] * 10)) % 1000:03d}"
    return out


def _parse_json(text: str, *, omm: str) -> Optional[dict[str, Any]]:
    s = str(text).strip()
    if not s.startswith("{"):
        return None
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    out: dict[str, Any] = {
        "omm": str(omm),
        "raw_aeromet": s,
        "source": "DMA",
        "nil": False,
        "notes": ["from_aeromet_json"],
        "cloud_layers": data.get("cloud_layers") or [],
    }
    mapping = {
        "temp_c": ("temp_c", "temp", "temperatura", "TT"),
        "dewpoint_c": ("dewpoint_c", "td", "rocio", "rocío"),
        "wind_dir": ("wind_dir", "dd", "dir"),
        "wind_speed_kt": ("wind_speed_kt", "ff", "wind_speed", "viento"),
        "visibility_m": ("visibility_m", "vis", "visibilidad"),
        "total_cloud": ("total_cloud", "N", "nubes"),
        "msl_pressure": ("msl_pressure", "qnh", "presion", "presión"),
        "present_weather": ("present_weather", "ww", "tiempo"),
        "obs_iso": ("obs_iso", "fecha", "datetime"),
        "nh": ("nh", "Nh"),
        "cl": ("cl", "CL"),
        "cm": ("cm", "CM"),
        "ch": ("ch", "CH"),
    }
    for dest, keys in mapping.items():
        for k in keys:
            if k in data and data[k] is not None:
                out[dest] = data[k]
                break
    out["wind_barb"] = barb_key(out.get("wind_speed_kt"), out.get("wind_dir"))
    return out if len(out) > 6 else None


def parse_aeromet(
    aeromet: Optional[str],
    *,
    omm: str,
    raw_synop: Optional[str] = None,
    obs_iso: Optional[str] = None,
    hour_key: Optional[str] = None,
    now: Optional[datetime] = None,
    meta: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """
    Convierte AEROMET → dict compatible con StationPlot / hover SYNOP.

    Si AEROMET está vacío, retorna None (el caller puede decodificar el SYNOP).
    """
    if aeromet is None:
        return None
    text = str(aeromet).strip()
    if not text or text.upper() in ("NULL", "NONE", "NIL", "-"):
        return None

    parsed = (
        _parse_json(text, omm=omm)
        or _parse_bulletin(text, omm=omm, now=now)
        or _parse_labeled(text, omm=omm)
    )
    if not parsed:
        # Conservar texto crudo para el detalle aunque no se pudo estructurar
        parsed = {
            "omm": str(omm),
            "raw_aeromet": " ".join(text.split()),
            "source": "DMA",
            "nil": False,
            "notes": ["aeromet_unparsed"],
            "cloud_layers": [],
            "wind_barb": "0",
        }

    meta = meta or {}
    if raw_synop:
        parsed["raw"] = " ".join(str(raw_synop).split())
    else:
        parsed.setdefault("raw", parsed.get("raw_aeromet"))
    if obs_iso and not parsed.get("obs_iso"):
        parsed["obs_iso"] = obs_iso
    if hour_key and not parsed.get("hour_key"):
        parsed["hour_key"] = hour_key
    if parsed.get("obs_iso") and not parsed.get("hour_key"):
        iso = str(parsed["obs_iso"])
        parsed["hour_key"] = iso[0:4] + iso[5:7] + iso[8:10] + iso[11:13]
    parsed["nombre"] = meta.get("nombre")
    parsed["lat"] = meta.get("lat")
    parsed["lng"] = meta.get("lng")
    parsed["fir"] = meta.get("fir")
    parsed["omm"] = str(omm)
    parsed["wmo"] = str(omm)
    parsed["source"] = "DMA"
    return parsed
