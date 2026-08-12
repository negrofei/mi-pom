"""Parseador de mensajes SYNOP (FM-12 AAXX) para ploteo de estación."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional


CLOUD_GENUS = {
    "0": "Ci — Cirrus",
    "1": "Cc — Cirrocumulus",
    "2": "Cs — Cirrostratus",
    "3": "Ac — Altocumulus",
    "4": "As — Altostratus",
    "5": "Ns — Nimbostratus",
    "6": "Sc — Stratocumulus",
    "7": "St — Stratus",
    "8": "Cu — Cumulus",
    "9": "Cb — Cumulonimbus",
}


@dataclass
class CloudLayer:
    """Grupo 8NsChshs de la sección 3."""

    ns: Optional[str] = None  # cantidad (oktas) de esa capa
    genus: Optional[str] = None  # C (género)
    genus_name: Optional[str] = None
    hs: Optional[str] = None  # código de altura
    height_m: Optional[int] = None
    height_ft: Optional[int] = None
    raw: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SynopDecoded:
    omm: str
    raw: str
    day: Optional[int] = None
    hour: Optional[int] = None
    wind_units: str = "mps"  # mps | kt
    lat: Optional[float] = None
    lng: Optional[float] = None
    nombre: Optional[str] = None
    fir: Optional[str] = None  # EZE / CBA / DOZ / SIS / CRV
    utc: Optional[str] = None
    obs_iso: Optional[str] = None  # ISO-8601 UTC para comparar con SPECI/METAR

    # Sección 1
    precip_indicator: Optional[str] = None
    station_type: Optional[str] = None
    visibility: Optional[str] = None  # VV (código)
    visibility_m: Optional[int] = None  # visibilidad horizontal en metros
    cloud_base_h: Optional[str] = None  # h (tabla 1600)
    total_cloud: Optional[str] = None  # N
    wind_dir: Optional[int] = None  # grados
    wind_speed: Optional[float] = None  # en unidades originales
    wind_speed_kt: Optional[float] = None
    wind_gust_kt: Optional[float] = None  # ráfaga (grupo 910ff, sec. 3)
    wind_barb: str = "0"  # clave de PNG barb_*
    temp_c: Optional[float] = None
    dewpoint_c: Optional[float] = None
    station_pressure: Optional[float] = None
    msl_pressure: Optional[float] = None
    pressure_plot: Optional[str] = None  # últimos 3 dígitos estilo plot
    tendency_char: Optional[str] = None  # a
    tendency_val: Optional[str] = None  # pp (décimas, 2 dígitos display)
    present_weather: Optional[str] = None  # ww
    past_weather: Optional[str] = None  # W1W2
    # Grupo 8 de sección 1: NhCLCMCH
    nh: Optional[str] = None
    cl: Optional[str] = None
    cm: Optional[str] = None
    ch: Optional[str] = None
    # Capas adicionales de sección 3: 8NsChshs (puede haber varias)
    cloud_layers: list[CloudLayer] = field(default_factory=list)
    nil: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


def _safe_int(s: str) -> Optional[int]:
    s = s.strip()
    if not s or "/" in s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _temp_from_group(group: str) -> Optional[float]:
    """Grupo 1sTTT o 2sTTT."""
    if len(group) < 5 or group[1] == "/":
        return None
    sign = group[1]
    raw = _safe_int(group[2:5])
    if raw is None:
        return None
    val = raw / 10.0
    if sign == "1":
        return -val
    if sign == "0":
        return val
    return None


def _pressure_from_pppp(pppp: str) -> Optional[float]:
    if len(pppp) != 4 or "/" in pppp:
        return None
    n = _safe_int(pppp)
    if n is None:
        return None
    tenths = n
    if tenths < 5000:
        return (tenths + 10000) / 10.0
    return tenths / 10.0


def _pressure_plot_digits(pressure: Optional[float]) -> Optional[str]:
    """Últimos 3 dígitos de la presión en décimas (1013.2 → '132')."""
    if pressure is None:
        return None
    tenths = int(round(pressure * 10)) % 1000
    return f"{tenths:03d}"


def _height_from_hshs(hs: Optional[str]) -> Optional[int]:
    """Decodifica hshs (tabla WMO 1690) a metros aproximados."""
    if hs is None or "/" in hs:
        return None
    code = _safe_int(hs)
    if code is None:
        return None
    if 0 <= code <= 50:
        return code * 30
    if 56 <= code <= 80:
        return (code - 50) * 300
    if 81 <= code <= 88:
        return (code - 80) * 1500 + 9000
    if code == 89:
        return 21000
    return None


def _meters_to_feet(meters: Optional[int]) -> Optional[int]:
    """Convierte metros a pies, redondeando a cientos de pies (1389 → 1400)."""
    if meters is None:
        return None
    feet = meters * 3.28084
    return int(round(feet / 100.0) * 100)


def _visibility_meters(vv: Optional[str]) -> Optional[int]:
    """Decodifica VV (tabla WMO 4377) a metros."""
    if vv is None or "/" in vv:
        return None
    code = _safe_int(vv)
    if code is None:
        return None
    if code == 0:
        return 50  # < 100 m; usamos 50 como representativo
    if 1 <= code <= 50:
        return code * 100
    if 56 <= code <= 80:
        return (code - 50) * 1000
    if code == 81:
        return 35000
    if code == 82:
        return 40000
    if code == 83:
        return 45000
    if code == 84:
        return 50000
    if code == 85:
        return 60000
    if code == 86:
        return 70000
    if code == 87:
        return 80000
    if code == 88:
        return 90000
    if code == 89:
        return 100000  # > 70 km / ≥ 100 km según
    # 90–99: valores especiales
    special = {
        90: 50,
        91: 50,
        92: 200,
        93: 500,
        94: 1000,
        95: 2000,
        96: 4000,
        97: 10000,
        98: 20000,
        99: 50000,
    }
    return special.get(code)


def barb_key(
    speed_kt: Optional[float],
    wind_dir: Optional[int] = None,
    *,
    notes: Optional[list[str]] = None,
    variable: bool = False,
) -> str:
    """Clave de archivo barb_*.png (compartida SYNOP/METAR)."""
    notes = notes or []
    if (
        variable
        or any("variable" in n for n in notes)
        or (wind_dir is None and speed_kt and speed_kt > 0)
    ):
        if speed_kt and speed_kt >= 1:
            return "v"
    if speed_kt is None or speed_kt < 0.5:
        return "0"
    if speed_kt < 2.5:
        return "1"
    rounded = int(round(speed_kt / 5.0) * 5)
    rounded = max(5, min(150, rounded))
    return str(rounded)


def _barb_key(speed_kt: Optional[float], wind_dir: Optional[int], notes: list[str]) -> str:
    return barb_key(speed_kt, wind_dir, notes=notes)


def _split_sections(tokens: list[str]) -> tuple[list[str], list[str], list[str]]:
    """Separa tokens en sección 1, sección 3 (333) y resto (555/222)."""
    section1: list[str] = []
    section3: list[str] = []
    section5: list[str] = []
    mode = "1"
    for t in tokens:
        if t == "333":
            mode = "3"
            continue
        if t == "555":
            mode = "5"
            continue
        if t == "222":
            mode = "ship"
            continue
        if mode == "1":
            section1.append(t)
        elif mode == "3":
            section3.append(t)
        else:
            section5.append(t)
    return section1, section3, section5


def parse_synop(
    raw: str,
    omm: str,
    *,
    year: Optional[int] = None,
    month: Optional[int] = None,
    day: Optional[int] = None,
    hour: Optional[int] = None,
    minute: int = 0,
) -> SynopDecoded:
    msg = " ".join(raw.replace("=", " ").split())
    out = SynopDecoded(omm=str(omm), raw=msg)

    if year and month and day is not None and hour is not None:
        out.utc = f"{day:02d}/{month:02d}/{year} {hour:02d}:{minute:02d}"
        out.obs_iso = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00Z"
        out.day = day
        out.hour = hour

    upper = msg.upper()
    if " NIL" in f" {upper}" or upper.endswith("NIL") or " NIL=" in upper + "=":
        out.nil = True
        return out

    tokens = upper.split()
    if not tokens:
        out.nil = True
        return out

    # Buscar AAXX YYGGi_w
    i = 0
    if tokens[0] == "AAXX" and len(tokens) > 1:
        yyggiw = tokens[1]
        if len(yyggiw) >= 5:
            out.day = _safe_int(yyggiw[0:2]) or out.day
            out.hour = _safe_int(yyggiw[2:4]) or out.hour
            iw = yyggiw[4]
            out.wind_units = "kt" if iw in ("3", "4") else "mps"
        i = 2
        if i < len(tokens) and tokens[i].isdigit() and len(tokens[i]) == 5:
            out.omm = tokens[i]
            i += 1
    elif tokens[0].isdigit() and len(tokens[0]) == 5:
        out.omm = tokens[0]
        i = 1

    section1, section3, _section5 = _split_sections(tokens[i:])

    if not section1:
        return out

    # Primer grupo: iRixhVV
    g0 = section1[0]
    if len(g0) >= 5:
        out.precip_indicator = g0[0] if g0[0] != "/" else None
        out.station_type = g0[1] if g0[1] != "/" else None
        out.cloud_base_h = g0[2] if g0[2] != "/" else None
        out.visibility = g0[3:5] if "//" not in g0[3:5] else None
        out.visibility_m = _visibility_meters(out.visibility)

    # Segundo: Nddff
    if len(section1) > 1:
        g1 = section1[1]
        if len(g1) >= 5:
            out.total_cloud = g1[0] if g1[0] != "/" else None
            dd = g1[1:3]
            ff = g1[3:5]
            if dd != "//":
                ddi = _safe_int(dd)
                if ddi is not None:
                    if ddi == 99:
                        out.wind_dir = None
                        out.notes.append("viento variable")
                    else:
                        out.wind_dir = (ddi * 10) % 360
            if ff != "//":
                speed = _safe_int(ff)
                if speed is not None:
                    out.wind_speed = float(speed)
                    if out.wind_units == "kt":
                        out.wind_speed_kt = float(speed)
                    else:
                        out.wind_speed_kt = round(speed * 1.94384, 1)

    for g in section1[2:]:
        if not g or len(g) < 5:
            continue
        if g.startswith("1"):
            out.temp_c = _temp_from_group(g)
        elif g.startswith("2"):
            out.dewpoint_c = _temp_from_group(g)
        elif g.startswith("3"):
            out.station_pressure = _pressure_from_pppp(g[1:5])
        elif g.startswith("4"):
            out.msl_pressure = _pressure_from_pppp(g[1:5])
            out.pressure_plot = _pressure_plot_digits(out.msl_pressure)
        elif g.startswith("5"):
            out.tendency_char = g[1] if g[1] != "/" else None
            if g[2:5] != "///":
                ppp = g[2:5]
                out.tendency_val = ppp[1:] if len(ppp) == 3 else ppp
        elif g.startswith("7"):
            out.present_weather = g[1:3] if "/" not in g[1:3] else None
            out.past_weather = g[3:5] if "/" not in g[3:5] else None
        elif g.startswith("8"):
            # NhCLCMCH
            out.nh = g[1] if g[1] != "/" else None
            out.cl = g[2] if g[2] != "/" else None
            out.cm = g[3] if g[3] != "/" else None
            out.ch = g[4] if g[4] != "/" else None

    # Sección 3: capas 8NsChshs + ráfagas 910ff
    for g in section3:
        if len(g) == 5 and g.startswith("8"):
            ns = g[1] if g[1] != "/" else None
            genus = g[2] if g[2] != "/" else None
            hs = g[3:5] if "/" not in g[3:5] else None
            height_m = _height_from_hshs(hs)
            out.cloud_layers.append(
                CloudLayer(
                    ns=ns,
                    genus=genus,
                    genus_name=CLOUD_GENUS.get(genus or "", None),
                    hs=hs,
                    height_m=height_m,
                    height_ft=_meters_to_feet(height_m),
                    raw=g,
                )
            )
        elif len(g) == 5 and g.startswith("910"):
            # 910ff — máxima ráfaga en la hora precedente (mismas unidades que ff)
            ff = g[3:5]
            if "/" not in ff:
                speed = _safe_int(ff)
                if speed is not None:
                    if out.wind_units == "kt":
                        out.wind_gust_kt = float(speed)
                    else:
                        out.wind_gust_kt = round(speed * 1.94384, 1)

    if out.pressure_plot is None and out.station_pressure is not None:
        out.pressure_plot = _pressure_plot_digits(out.station_pressure)

    out.wind_barb = _barb_key(out.wind_speed_kt, out.wind_dir, out.notes)
    return out
