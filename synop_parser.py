"""Parseador de mensajes SYNOP (FM-12 AAXX) para ploteo de estación."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional


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
    utc: Optional[str] = None

    # Sección 1
    precip_indicator: Optional[str] = None
    station_type: Optional[str] = None
    cloud_base_h: Optional[str] = None  # h
    visibility: Optional[str] = None  # VV
    total_cloud: Optional[str] = None  # N
    wind_dir: Optional[int] = None  # grados
    wind_speed: Optional[float] = None  # en unidades originales
    wind_speed_kt: Optional[float] = None
    temp_c: Optional[float] = None
    dewpoint_c: Optional[float] = None
    station_pressure: Optional[float] = None
    msl_pressure: Optional[float] = None
    pressure_plot: Optional[str] = None  # últimos 3 dígitos estilo plot
    tendency_char: Optional[str] = None  # a
    tendency_val: Optional[str] = None  # pp (décimas, 2 dígitos display)
    present_weather: Optional[str] = None  # ww
    past_weather: Optional[str] = None  # W1W2
    nh: Optional[str] = None
    cl: Optional[str] = None
    cm: Optional[str] = None
    ch: Optional[str] = None
    nil: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


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
    # Convención usual: si < 500 → +1000 hPa (valores en décimas)
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
        # Puede seguir el indicativo
        if i < len(tokens) and tokens[i].isdigit() and len(tokens[i]) == 5:
            out.omm = tokens[i]
            i += 1
    elif tokens[0].isdigit() and len(tokens[0]) == 5:
        # A veces OGIMET ya trae el cuerpo sin AAXX en la columna REPORT,
        # pero en getsynop sí viene AAXX completo.
        out.omm = tokens[0]
        i = 1

    # Si el mensaje empieza con AAXX ... omm ... grupos
    # Recortar secciones 333 / 555 / 222
    body = tokens[i:]
    section1: list[str] = []
    for t in body:
        if t in ("333", "555", "222"):
            break
        section1.append(t)

    if not section1:
        return out

    # Primer grupo: iRixhVV
    g0 = section1[0]
    if len(g0) >= 5:
        out.precip_indicator = g0[0] if g0[0] != "/" else None
        out.station_type = g0[1] if g0[1] != "/" else None
        out.cloud_base_h = g0[2] if g0[2] != "/" else None
        out.visibility = g0[3:5] if "//" not in g0[3:5] else None

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
                        out.wind_dir = None  # variable
                        out.notes.append("viento variable")
                    else:
                        out.wind_dir = (ddi * 10) % 360
            if ff != "//":
                # Puede haber grupo 00fff si ff=99, omitimos por simplicidad
                speed = _safe_int(ff)
                if speed is not None:
                    out.wind_speed = float(speed)
                    if out.wind_units == "kt":
                        out.wind_speed_kt = float(speed)
                    else:
                        out.wind_speed_kt = round(speed * 1.94384, 1)

    for g in section1[2:]:
        if not g or g[0] == "/":
            continue
        if g.startswith("1") and len(g) == 5:
            out.temp_c = _temp_from_group(g)
        elif g.startswith("2") and len(g) == 5:
            out.dewpoint_c = _temp_from_group(g)
        elif g.startswith("3") and len(g) == 5:
            out.station_pressure = _pressure_from_pppp(g[1:5])
        elif g.startswith("4") and len(g) == 5:
            out.msl_pressure = _pressure_from_pppp(g[1:5])
            out.pressure_plot = _pressure_plot_digits(out.msl_pressure)
        elif g.startswith("5") and len(g) == 5:
            out.tendency_char = g[1] if g[1] != "/" else None
            if g[2:5] != "///":
                # mostrar cambio en décimas (2 dígitos típicos del plot)
                ppp = g[2:5]
                out.tendency_val = ppp[1:] if len(ppp) == 3 else ppp
        elif g.startswith("7") and len(g) == 5:
            out.present_weather = g[1:3] if "/" not in g[1:3] else None
            out.past_weather = g[3:5] if "/" not in g[3:5] else None
        elif g.startswith("8") and len(g) == 5:
            out.nh = g[1] if g[1] != "/" else None
            out.cl = g[2] if g[2] != "/" else None
            out.cm = g[3] if g[3] != "/" else None
            out.ch = g[4] if g[4] != "/" else None

    # Si no hubo grupo 4, usar presión de estación para el plot
    if out.pressure_plot is None and out.station_pressure is not None:
        out.pressure_plot = _pressure_plot_digits(out.station_pressure)

    return out
