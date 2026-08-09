"""
Cliente SMN mensajes_new (intranet).

URL típica:
  http://www3.smn.gov.ar/intra/mensajes_new/index.php
    ?observacion=metar|synop|speci
    &operacion=consultar
    &87582=on&87641=on

Si SMN no es alcanzable (Cloudflare / red), el llamador debe usar contingencia
(OGIMET / AviationWeather).
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from urllib.parse import urlencode

import requests

from metar_parser import parse_metar_raw
from synop_parser import parse_synop

log = logging.getLogger(__name__)

SMN_BASE = os.environ.get(
    "SMN_MENSAJES_URL",
    "http://www3.smn.gov.ar/intra/mensajes_new/index.php",
)
DEFAULT_TIMEOUT = float(os.environ.get("SMN_TIMEOUT", "35"))
USER_AGENT = "mi-pom/1.0 (argentina-wx-surveillance)"
CHUNK = 35

ObsKind = Literal["metar", "synop", "speci"]

_RE_STATION = re.compile(r"\b(?P<omm>\d{5})\b")
_RE_METAR_LINE = re.compile(
    r"(?P<msg>(?:METAR|SPECI)\s+[A-Z]{4}\s+\d{6}Z\b[^<\n\r]*?=?)",
    re.I,
)
_RE_SYNOP_LINE = re.compile(
    r"(?P<msg>AAXX\s+\d{5}\s+\d{5}\b[^<\n\r]*?=)",
    re.I,
)


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
        }
    )
    return s


def _chunks(ids: list[str], size: int) -> list[list[str]]:
    return [ids[i : i + size] for i in range(0, len(ids), size)]


def _fetch_html(kind: ObsKind, station_ids: list[str]) -> str:
    params: list[tuple[str, str]] = [
        ("observacion", kind),
        ("operacion", "consultar"),
    ]
    for sid in station_ids:
        params.append((str(sid), "on"))
    url = f"{SMN_BASE}?{urlencode(params)}"
    log.info("SMN %s stations=%s", kind, len(station_ids))
    resp = _session().get(url, timeout=DEFAULT_TIMEOUT)
    if resp.status_code == 403 or "cf-error" in resp.text.lower() or "cloudflare" in resp.text.lower()[:2000]:
        raise RuntimeError(f"SMN bloqueado/inaccesible (HTTP {resp.status_code})")
    resp.raise_for_status()
    return resp.text


def _strip_tags(html: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</tr>|</p>|</div>|</li>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return text


def _associate_omm(block: str, fallback: Optional[str] = None) -> Optional[str]:
    # Preferir OMM justo antes del mensaje
    m = re.search(r"(\d{5})\s+(?:METAR|SPECI|AAXX)\b", block, re.I)
    if m:
        return m.group(1)
    ids = _RE_STATION.findall(block)
    if len(ids) == 1:
        return ids[0]
    return fallback


def parse_smn_metar_speci_html(
    html: str,
    *,
    kind: ObsKind,
    airports: dict[str, dict],
    now: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """Extrae METAR/SPECI del HTML/texto SMN."""
    text = _strip_tags(html)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in _RE_METAR_LINE.finditer(text):
        msg = " ".join(m.group("msg").split())
        if kind == "metar" and not msg.upper().startswith("METAR"):
            continue
        if kind == "speci" and not msg.upper().startswith("SPECI"):
            # Algunas páginas mezclan; aceptar ambos y filtrar luego
            if not msg.upper().startswith("SPECI"):
                continue
        start = max(0, m.start() - 40)
        ctx = text[start : m.end()]
        omm = _associate_omm(ctx)
        parsed = parse_metar_raw(msg, airports=airports, wmo=omm, now=now, source="SMN")
        if not parsed:
            continue
        if kind == "speci" and not parsed.get("is_speci"):
            continue
        if kind == "metar" and parsed.get("is_speci"):
            continue
        key = f"{parsed['icao']}|{parsed.get('obs_iso')}|{parsed.get('raw')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(parsed)
    return out


def parse_smn_synop_html(
    html: str,
    *,
    stations: dict[str, dict],
    now: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """Extrae SYNOP AAXX del HTML/texto SMN."""
    now = now or datetime.now(timezone.utc)
    text = _strip_tags(html)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in _RE_SYNOP_LINE.finditer(text):
        msg = " ".join(m.group("msg").split())
        start = max(0, m.start() - 24)
        ctx = text[start : m.end()]
        omm = _associate_omm(ctx)
        # AAXX YYGGiw IIIII
        parts = msg.split()
        if len(parts) < 3:
            continue
        yyggiw = parts[1]
        iiiii = parts[2]
        if omm is None and iiiii.isdigit() and len(iiiii) == 5:
            omm = iiiii
        if not omm or omm not in stations:
            # aún así intentar con iiiii
            if iiiii in stations:
                omm = iiiii
            else:
                continue
        day = int(yyggiw[0:2]) if len(yyggiw) >= 4 else now.day
        hour = int(yyggiw[2:4]) if len(yyggiw) >= 4 else now.hour
        decoded = parse_synop(
            msg,
            omm,
            year=now.year,
            month=now.month,
            day=day,
            hour=hour,
            minute=0,
        )
        meta = stations[omm]
        decoded.lat = meta.get("lat")
        decoded.lng = meta.get("lng")
        decoded.nombre = meta.get("nombre")
        decoded.fir = meta.get("fir")
        if not decoded.obs_iso:
            try:
                dt = datetime(now.year, now.month, day, hour, 0, tzinfo=timezone.utc)
                decoded.obs_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                pass
        key = f"{omm}|{decoded.obs_iso}|{decoded.raw}"
        if key in seen:
            continue
        seen.add(key)
        d = decoded.to_dict()
        d["source"] = "SMN"
        d["hour_key"] = (decoded.obs_iso or "")[:13].replace("T", "").replace("-", "")[:10] if decoded.obs_iso else None
        if decoded.obs_iso:
            d["hour_key"] = decoded.obs_iso[0:4] + decoded.obs_iso[5:7] + decoded.obs_iso[8:10] + decoded.obs_iso[11:13]
        out.append(d)
    return out


def fetch_smn_messages(
    kind: ObsKind,
    station_ids: list[str],
    *,
    airports: Optional[dict[str, dict]] = None,
    stations: Optional[dict[str, dict]] = None,
) -> list[dict[str, Any]]:
    """
    Consulta SMN por lotes. Devuelve lista de dicts normalizados.
    Lanza RuntimeError si SMN no responde útilmente.
    """
    ids = sorted({str(s) for s in station_ids if s})
    if not ids:
        return []
    airports = airports or {}
    stations = stations or {}
    merged: list[dict[str, Any]] = []
    errors: list[str] = []
    for i, chunk in enumerate(_chunks(ids, CHUNK)):
        try:
            html = _fetch_html(kind, chunk)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            log.warning("SMN %s chunk failed: %s", kind, exc)
            # Si el primer lote ya falla (p.ej. Cloudflare), no martillar el resto
            if i == 0:
                raise
            continue
        if kind in ("metar", "speci"):
            merged.extend(
                parse_smn_metar_speci_html(html, kind=kind, airports=airports)
            )
        else:
            merged.extend(parse_smn_synop_html(html, stations=stations))
    if not merged and errors:
        raise RuntimeError(errors[0])
    # Último por estación
    if kind == "synop":
        by: dict[str, dict] = {}
        for n in merged:
            omm = str(n.get("omm") or "")
            prev = by.get(omm)
            if prev is None or (n.get("obs_iso") or "") >= (prev.get("obs_iso") or ""):
                by[omm] = n
        return list(by.values())
    by_icao: dict[str, dict] = {}
    for n in merged:
        icao = str(n.get("icao") or "")
        prev = by_icao.get(icao)
        if prev is None or (n.get("obs_iso") or "") >= (prev.get("obs_iso") or ""):
            by_icao[icao] = n
    return list(by_icao.values())
