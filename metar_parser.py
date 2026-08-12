"""Parseador liviano de METAR/SPECI (texto crudo) para vigilancia SMN."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from aviationweather_client import FLT_CAT_COLORS, _ceil_ft_from_clouds, flight_category
from synop_parser import barb_key

_RE_HEADER = re.compile(
    r"\b(?P<kind>METAR|SPECI)\s+(?P<icao>[A-Z]{4})\s+(?P<ddhhmm>\d{6})Z\b",
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


def _temp_token(tok: str) -> float:
    if tok.startswith("M"):
        return -float(tok[1:])
    return float(tok)


def parse_metar_time(ddhhmm: str, *, now: Optional[datetime] = None) -> datetime:
    """Convierte ddhhmmZ a datetime UTC (asume mes/año actuales o mes anterior)."""
    now = now or datetime.now(timezone.utc)
    day = int(ddhhmm[0:2])
    hour = int(ddhhmm[2:4])
    minute = int(ddhhmm[4:6])
    year, month = now.year, now.month
    try:
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    except ValueError:
        if month == 1:
            year, month = year - 1, 12
        else:
            month -= 1
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    if dt > now + timedelta(hours=24):
        if month == 1:
            year, month = year - 1, 12
        else:
            month -= 1
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    return dt


def parse_metar_raw(
    raw: str,
    *,
    airports: Optional[dict[str, dict]] = None,
    wmo: Optional[str] = None,
    now: Optional[datetime] = None,
    source: str = "SMN",
) -> Optional[dict[str, Any]]:
    """Decodifica un METAR/SPECI crudo a dict compatible con el front."""
    if not raw:
        return None
    text = " ".join(str(raw).replace("=", " ").split())
    m = _RE_HEADER.search(text)
    if not m:
        return None

    kind = m.group("kind").upper()
    icao = m.group("icao").upper()
    dt = parse_metar_time(m.group("ddhhmm"), now=now)
    obs_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    hour_key = dt.strftime("%Y%m%d%H")

    airports = airports or {}
    meta = airports.get(icao) or {}

    wind = _RE_WIND.search(text)
    wind_dir = None
    wind_speed = None
    wind_gust = None
    wind_variable = False
    if wind:
        d = wind.group("dir").upper()
        wind_variable = d == "VRB"
        wind_dir = None if wind_variable else int(d)
        wind_speed = int(wind.group("spd"))
        if wind.group("gust"):
            wind_gust = int(wind.group("gust"))

    if _RE_CAVOK.search(text):
        vis_m = 10000
    else:
        # Vis suele estar después del viento
        vis_m = None
        after = text[m.end() :]
        if wind:
            after = text[wind.end() :]
        vm = _RE_VIS.search(after)
        if vm:
            vis_m = int(vm.group("vis"))

    clouds: list[dict[str, Any]] = []
    for cm in _RE_CLOUD.finditer(text):
        cover = cm.group("cover").upper()
        base = int(cm.group("base")) * 100 if cm.group("base") else None
        conv = cm.group("conv").upper() if cm.group("conv") else None
        item: dict[str, Any] = {"cover": cover, "base": base}
        if conv:
            item["type"] = conv
            item["convective"] = conv
        clouds.append(item)

    ceiling = _ceil_ft_from_clouds(clouds)
    flt = flight_category(ceiling, vis_m)

    temp_c = dewpoint_c = None
    tm = _RE_TEMP.search(text)
    if tm:
        temp_c = _temp_token(tm.group("t"))
        dewpoint_c = _temp_token(tm.group("td"))

    altim = None
    qm = _RE_QNH.search(text)
    if qm:
        altim = float(qm.group("qnh"))

    wx_parts = _RE_WX.findall(text)
    # findall with groups returns tuples if groups exist — use finditer
    wx_parts = [x.group(0) for x in _RE_WX.finditer(text)]
    wx_string = " ".join(wx_parts) if wx_parts else None

    cover = None
    if clouds:
        # cobertura más restrictiva
        rank = {"VV": 0, "OVC": 1, "BKN": 2, "SCT": 3, "FEW": 4}
        cover = min((c["cover"] for c in clouds), key=lambda c: rank.get(c, 9))

    return {
        "icao": icao,
        "nombre": meta.get("nombre") or icao,
        "lat": meta.get("lat"),
        "lng": meta.get("lng"),
        "elev": meta.get("elev"),
        "fir": meta.get("fir"),
        "iata": meta.get("iata"),
        "wmo": wmo or meta.get("wmo"),
        "obs_iso": obs_iso,
        "hour_key": hour_key,
        "temp_c": temp_c,
        "dewpoint_c": dewpoint_c,
        "wind_dir": wind_dir,
        "wind_speed_kt": wind_speed,
        "wind_gust_kt": wind_gust,
        "wind_barb": barb_key(
            float(wind_speed) if wind_speed is not None else None,
            wind_dir,
            variable=wind_variable,
        ),
        "visibility_m": vis_m,
        "visib_raw": None,
        "altim_hpa": altim,
        "wx_string": wx_string,
        "cover": cover,
        "clouds": clouds,
        "ceiling_ft": ceiling,
        "flt_cat": flt,
        "flt_cat_color": FLT_CAT_COLORS.get(flt or "", "#888888"),
        "raw": text if text.endswith("=") else text + "=",
        "raw_taf": None,
        "metar_type": kind,
        "is_speci": kind == "SPECI",
        "source": source,
    }
