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
# Alternativas si la principal falla (misma app, otro host)
SMN_BASE_FALLBACKS = [
    u
    for u in [
        SMN_BASE,
        "http://www3.smn.gob.ar/intra/mensajes_new/index.php",
        "http://www3.smn.gov.ar/mensajes/index.php",
        "http://www3.smn.gob.ar/mensajes/index.php",
    ]
    if u
]
# unique preserve order
_seen_bases: set[str] = set()
SMN_BASES: list[str] = []
for _u in SMN_BASE_FALLBACKS:
    if _u not in _seen_bases:
        _seen_bases.add(_u)
        SMN_BASES.append(_u)

DEFAULT_TIMEOUT = float(os.environ.get("SMN_TIMEOUT", "35"))
PROBE_TIMEOUT = float(os.environ.get("SMN_PROBE_TIMEOUT", "4"))
PROBE_TTL = float(os.environ.get("SMN_PROBE_TTL", "600"))
# auto = sondear intranet; on = forzar SMN; off = solo contingencia (Render)
_raw_mode = (os.environ.get("SMN_MODE") or "").strip().lower()
if _raw_mode:
    SMN_MODE = _raw_mode
elif os.environ.get("RENDER") or os.environ.get("RENDER_EXTERNAL_URL"):
    # Render.com: SMN intranet nunca alcanza → contingencia directa
    SMN_MODE = "off"
else:
    SMN_MODE = "auto"
USER_AGENT = "mi-pom/1.0 (argentina-wx-surveillance)"
CHUNK = 35

ObsKind = Literal["metar", "synop", "speci"]

_smn_probe_cache: dict[str, Any] = {
    "checked_at": 0.0,
    "ok": None,
    "reason": None,
    "url": None,
}

_RE_STATION = re.compile(r"\b(?P<omm>\d{5})\b")
# Captura desde METAR/SPECI hasta el '=' final (formato real SMN)
_RE_METAR_LINE = re.compile(
    r"(?P<msg>(?:METAR|SPECI)\s+[A-Z]{4}\s+\d{6}Z\b[^=]*=)",
    re.I,
)
_RE_HIDDEN_METAR = re.compile(
    r'value="[^"]*?\b(?P<msg>(?:METAR|SPECI)\s+[A-Z]{4}\s+\d{6}Z\b[^=]*?=)"',
    re.I,
)
_RE_SYNOP_LINE = re.compile(
    r"(?P<msg>AAXX\s+\d{5}\s+\d{5}\b[^=]*=)",
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


def smn_mode() -> str:
    if SMN_MODE in ("off", "contingency", "0", "false", "no"):
        return "off"
    if SMN_MODE in ("on", "force", "1", "true", "yes"):
        return "on"
    return "auto"


def _probe_once() -> tuple[bool, str, Optional[str]]:
    """Sondeo liviano: un GET corto a mensajes_new (solo base primaria)."""
    params = [
        ("observacion", "metar"),
        ("operacion", "consultar"),
        ("87582", "on"),
    ]
    qs = urlencode(params)
    bases = SMN_BASES[:1] or [SMN_BASE]
    last_err = "SMN inaccesible"
    for base in bases:
        url = f"{base}?{qs}"
        try:
            resp = _session().get(url, timeout=PROBE_TIMEOUT, allow_redirects=True)
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            continue
        head = (resp.text or "")[:2500].lower()
        if resp.status_code == 403 or "cf-error" in head or "cloudflare" in head:
            last_err = f"Cloudflare/HTTP {resp.status_code}"
            continue
        if resp.status_code >= 400:
            last_err = f"HTTP {resp.status_code}"
            continue
        body = resp.text or ""
        if (
            "METAR" in body.upper()
            or "SPECI" in body.upper()
            or "mensajes" in head
            or "headerResult" in body
            or "observacion" in head
            or "operacion" in head
        ):
            return True, "reachable", url
        last_err = "respuesta no reconocida"
    return False, last_err, None


def smn_status(*, force_refresh: bool = False) -> dict[str, Any]:
    """
    Estado SMN cacheado.

    En Render / redes externas: ok=False → vigilancia solo contingencia.
    En intranet SMN (auto): ok=True tras sondeo exitoso.
    """
    mode = smn_mode()
    now = datetime.now(timezone.utc).timestamp()
    if mode == "off":
        return {
            "ok": False,
            "mode": mode,
            "reason": "SMN_MODE=off (solo contingencia)",
            "url": None,
            "cached": False,
        }
    if mode == "on":
        return {
            "ok": True,
            "mode": mode,
            "reason": "SMN_MODE=on (forzado)",
            "url": SMN_BASES[0] if SMN_BASES else SMN_BASE,
            "cached": False,
        }

    cached_ok = _smn_probe_cache.get("ok")
    age = now - float(_smn_probe_cache.get("checked_at") or 0)
    if not force_refresh and cached_ok is not None and age < PROBE_TTL:
        return {
            "ok": bool(cached_ok),
            "mode": mode,
            "reason": _smn_probe_cache.get("reason"),
            "url": _smn_probe_cache.get("url"),
            "cached": True,
            "age_s": round(age, 1),
        }

    ok, reason, url = _probe_once()
    _smn_probe_cache["checked_at"] = now
    _smn_probe_cache["ok"] = ok
    _smn_probe_cache["reason"] = reason
    _smn_probe_cache["url"] = url
    log.info("SMN probe ok=%s reason=%s", ok, reason)
    return {
        "ok": ok,
        "mode": mode,
        "reason": reason,
        "url": url,
        "cached": False,
        "age_s": 0,
    }


def smn_available() -> bool:
    return bool(smn_status().get("ok"))


def _chunks(ids: list[str], size: int) -> list[list[str]]:
    return [ids[i : i + size] for i in range(0, len(ids), size)]


def _fetch_html(kind: ObsKind, station_ids: list[str]) -> str:
    params: list[tuple[str, str]] = [
        ("observacion", kind),
        ("operacion", "consultar"),
    ]
    for sid in station_ids:
        params.append((str(sid), "on"))
    last_err: Optional[Exception] = None
    for base in SMN_BASES:
        url = f"{base}?{urlencode(params)}"
        log.info("SMN %s stations=%s base=%s", kind, len(station_ids), base)
        try:
            resp = _session().get(url, timeout=DEFAULT_TIMEOUT, allow_redirects=True)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            log.warning("SMN request error %s: %s", base, exc)
            continue
        body_head = (resp.text or "")[:2500].lower()
        if resp.status_code == 403 or "cf-error" in body_head or "cloudflare" in body_head:
            last_err = RuntimeError(f"SMN bloqueado/inaccesible (HTTP {resp.status_code}) @ {base}")
            log.warning("%s", last_err)
            continue
        if resp.status_code >= 400:
            last_err = RuntimeError(f"SMN HTTP {resp.status_code} @ {base}")
            continue
        # Página útil: debe contener METAR/SPECI/AAXX o tablas de resultado
        if kind in ("metar", "speci") and "METAR" not in resp.text.upper() and "SPECI" not in resp.text.upper():
            if "headerResult" not in resp.text and "result" not in resp.text:
                last_err = RuntimeError(f"SMN sin mensajes {kind} @ {base}")
                continue
        return resp.text
    raise RuntimeError(str(last_err) if last_err else "SMN inaccesible")


def _strip_tags(html: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</tr>|</p>|</div>|</li>|</td>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&oacute;", "o")
        .replace("&aacute;", "a")
        .replace("&eacute;", "e")
        .replace("&iacute;", "i")
        .replace("&uacute;", "u")
    )
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


def _extract_metar_messages(html: str) -> list[str]:
    """
    Extrae textos METAR/SPECI…= del HTML SMN.
    Prioriza inputs hidden (value="… METAR ICAO … =") y el texto visible.
    """
    msgs: list[str] = []
    seen: set[str] = set()

    def _add(raw: str) -> None:
        msg = " ".join(raw.split())
        # normalizar espacio antes de =
        msg = re.sub(r"\s*=\s*$", " =", msg)
        if not msg.upper().startswith(("METAR", "SPECI")):
            return
        key = msg.upper()
        if key in seen:
            return
        seen.add(key)
        msgs.append(msg)

    for m in _RE_HIDDEN_METAR.finditer(html):
        _add(m.group("msg"))
    # Texto plano / celdas
    text = _strip_tags(html)
    for m in _RE_METAR_LINE.finditer(text):
        _add(m.group("msg"))
    # Fallback: HTML crudo (por si quedan tags raros entre tokens)
    for m in _RE_METAR_LINE.finditer(re.sub(r"(?is)<[^>]+>", " ", html)):
        _add(m.group("msg"))
    return msgs


def parse_smn_metar_speci_html(
    html: str,
    *,
    kind: ObsKind,
    airports: dict[str, dict],
    now: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """
    Extrae METAR/SPECI del HTML SMN.

    Los mensajes traen código OACI (SABE, SAZA, …). El WMO se obtiene del
    catálogo airports (SABE→87582), no del HTML.
    """
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for msg in _extract_metar_messages(html):
        upper = msg.upper()
        if kind == "metar" and not upper.startswith("METAR"):
            continue
        if kind == "speci" and not upper.startswith("SPECI"):
            continue
        # OACI → WMO vía catálogo
        m_icao = re.search(r"\b(?:METAR|SPECI)\s+([A-Z]{4})\b", upper)
        icao = m_icao.group(1) if m_icao else None
        meta = airports.get(icao or "") or {}
        wmo = meta.get("wmo")
        parsed = parse_metar_raw(
            msg, airports=airports, wmo=str(wmo) if wmo else None, now=now, source="SMN"
        )
        if not parsed:
            continue
        if kind == "speci" and not parsed.get("is_speci"):
            continue
        if kind == "metar" and parsed.get("is_speci"):
            continue
        # Completar coords/nombre si el parseador no los trajo
        if parsed.get("lat") is None and meta.get("lat") is not None:
            parsed["lat"] = meta.get("lat")
            parsed["lng"] = meta.get("lng")
            parsed["fir"] = meta.get("fir")
            parsed["nombre"] = meta.get("nombre") or parsed.get("nombre")
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
