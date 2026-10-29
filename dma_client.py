"""
Cliente MySQL DMA (10.10.100.121) — metar_obs / speci_obs / synop_obs / taf_obs.

Fuente primaria de vigilancia-dma. Credenciales por entorno:

  DMA_MYSQL_HOST=10.10.100.121
  DMA_MYSQL_PORT=3306
  DMA_MYSQL_USER=...
  DMA_MYSQL_PASSWORD=...
  DMA_MYSQL_DATABASE=mensajes
  DMA_MYSQL_CONNECT_TIMEOUT=5
  DMA_MYSQL_SSL=0          # el servidor DMA no ofrece TLS
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from aeromet_parser import parse_aeromet
from metar_parser import parse_metar_raw
from synop_parser import parse_synop

log = logging.getLogger(__name__)

ObsKind = Literal["metar", "speci", "synop", "taf"]

DEFAULT_HOST = os.environ.get("DMA_MYSQL_HOST", "10.10.100.121")
DEFAULT_PORT = int(os.environ.get("DMA_MYSQL_PORT", "3306"))
DEFAULT_USER = os.environ.get("DMA_MYSQL_USER", os.environ.get("MYSQL_USER", ""))
DEFAULT_PASSWORD = os.environ.get(
    "DMA_MYSQL_PASSWORD", os.environ.get("MYSQL_PASSWORD", "")
)
DEFAULT_DATABASE = os.environ.get(
    "DMA_MYSQL_DATABASE", os.environ.get("MYSQL_DATABASE", "mensajes")
)
CONNECT_TIMEOUT = float(os.environ.get("DMA_MYSQL_CONNECT_TIMEOUT", "5"))
# El MySQL DMA no soporta TLS; clientes nuevos fallan si exigen SSL.
_SSL_ENV = (os.environ.get("DMA_MYSQL_SSL") or "0").strip().lower()
SSL_ENABLED = _SSL_ENV in ("1", "true", "yes", "on")

TABLE_BY_KIND: dict[ObsKind, str] = {
    "metar": os.environ.get("DMA_TABLE_METAR", "metar_obs"),
    "speci": os.environ.get("DMA_TABLE_SPECI", "speci_obs"),
    "synop": os.environ.get("DMA_TABLE_SYNOP", "synop_obs"),
    "taf": os.environ.get("DMA_TABLE_TAF", "taf_obs"),
}

# Candidatos de columnas (minúsculas) → rol lógico
_STATION_CANDIDATES = (
    "codestacion",
    "estacion",
    "omm",
    "wmo",
    "id_estacion",
    "idestacion",
    "station",
    "indicativo",
)
_TIME_CANDIDATES = (
    "utc",  # esquema DMA real (synop_obs / metar_obs / speci_obs)
    "fechahora",
    "fecha_hora",
    "fechaobs",
    "fecha_obs",
    "fecha",
    "datetime",
    "obs_time",
    "hora",
    "timestamp",
    "ts",
)
_MSG_CANDIDATES = (
    "mensaje",
    "msg",
    "raw",
    "texto",
    "synop",
    "metar",
    "speci",
    "bulletin",
    "parte",
)
_AEROMET_CANDIDATES = ("aeromet", "aero_met", "decodificado", "decoded")
# En synop_obs el OACI está en observadoDesde; en metar/speci estacion ya es OACI
_ICAO_CANDIDATES = (
    "observadodesde",
    "observado_desde",
    "icao",
    "oaci",
    "aerodromo",
    "aeródromo",
    "estacion_oaci",
)

_column_cache: dict[str, dict[str, Optional[str]]] = {}
_status_cache: dict[str, Any] = {"ok": None, "checked_at": None, "reason": None}


def _import_pymysql():
    try:
        import pymysql
        from pymysql.cursors import DictCursor
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "Falta pymysql. Instalá con: pip install pymysql"
        ) from exc
    return pymysql, DictCursor


def dma_config() -> dict[str, Any]:
    return {
        "host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "user": DEFAULT_USER,
        "database": DEFAULT_DATABASE,
        "password_set": bool(DEFAULT_PASSWORD),
        "ssl": SSL_ENABLED,
        "tables": dict(TABLE_BY_KIND),
    }


def connect():
    if not DEFAULT_USER:
        raise RuntimeError(
            "DMA_MYSQL_USER no configurado (base 10.10.100.121 / mensajes)"
        )
    pymysql, DictCursor = _import_pymysql()
    kwargs: dict[str, Any] = {
        "host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "user": DEFAULT_USER,
        "password": DEFAULT_PASSWORD,
        "database": DEFAULT_DATABASE,
        "connect_timeout": CONNECT_TIMEOUT,
        "read_timeout": 30,
        "charset": "utf8mb4",
        "cursorclass": DictCursor,
        "autocommit": True,
    }
    # PyMySQL ≥1.1: ssl_disabled evita "SSL is required, but the server does not support it"
    if not SSL_ENABLED:
        kwargs["ssl"] = None
        kwargs["ssl_disabled"] = True
    return pymysql.connect(**kwargs)


def dma_status(*, force_refresh: bool = False) -> dict[str, Any]:
    """Sondeo rápido de conectividad DMA."""
    now = datetime.now(timezone.utc)
    cached_at = _status_cache.get("checked_at")
    if (
        not force_refresh
        and cached_at is not None
        and _status_cache.get("ok") is not None
        and (now - cached_at).total_seconds() < 60
    ):
        return {
            "ok": _status_cache["ok"],
            "reason": _status_cache.get("reason"),
            "config": dma_config(),
            "cached": True,
        }
    reason = None
    ok = False
    try:
        conn = connect()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
            ok = True
            reason = "connected"
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        ok = False
        reason = str(exc)
        log.warning("DMA status fail: %s", exc)
    _status_cache.update({"ok": ok, "reason": reason, "checked_at": now})
    return {"ok": ok, "reason": reason, "config": dma_config(), "cached": False}


def _norm_col(name: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", str(name).strip().lower())


def _pick(cols: dict[str, str], candidates: tuple[str, ...]) -> Optional[str]:
    """cols: norm → original name."""
    for c in candidates:
        if c in cols:
            return cols[c]
    return None


def _describe(conn, table: str) -> dict[str, Optional[str]]:
    if table in _column_cache:
        return _column_cache[table]
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
        rows = cur.fetchall() or []
    originals = {}
    for r in rows:
        name = r.get("Field") or r.get("field") or next(iter(r.values()))
        originals[_norm_col(str(name))] = str(name)
    # Esquema DMA conocido: estacion + utc + mensaje (+ aeromet / observadoDesde)
    mapping: dict[str, Any] = {
        "station": _pick(originals, _STATION_CANDIDATES),
        "time": _pick(originals, _TIME_CANDIDATES),
        "message": _pick(originals, _MSG_CANDIDATES),
        "aeromet": _pick(originals, _AEROMET_CANDIDATES),
        "icao": _pick(originals, _ICAO_CANDIDATES),
        "_all": originals,
    }
    # Si estacion es OACI (metar/speci), no usar la misma columna como icao auxiliar
    # salvo que exista observadoDesde.
    if mapping["icao"] and mapping["station"] and mapping["icao"] == mapping["station"]:
        if "observadodesde" in originals:
            mapping["icao"] = originals["observadodesde"]
        else:
            mapping["icao"] = None
    if not mapping["station"] or not mapping["time"]:
        raise RuntimeError(
            f"Tabla {table}: no se reconocieron columnas estación/fecha "
            f"(vimos: {sorted(originals.values())})"
        )
    if not mapping["message"] and not mapping["aeromet"]:
        raise RuntimeError(
            f"Tabla {table}: falta columna de mensaje/AEROMET "
            f"(vimos: {sorted(originals.values())})"
        )
    _column_cache[table] = mapping
    return mapping


def _as_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    # YYYYMMDDHH[MM]
    if re.fullmatch(r"\d{10,12}", s):
        year = int(s[0:4])
        month = int(s[4:6])
        day = int(s[6:8])
        hour = int(s[8:10])
        minute = int(s[10:12]) if len(s) >= 12 else 0
        return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
    ):
        try:
            return datetime.strptime(s[:26], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _station_key(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    m = re.search(r"(\d{5})", s)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z]{4}", s):
        return s.upper()
    return s


def _fetch_rows(
    kind: ObsKind,
    *,
    when: Optional[datetime] = None,
    timeline: str = "latest",
    lookback_hours: int = 24,
    station_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    table = TABLE_BY_KIND[kind]
    conn = connect()
    try:
        cols = _describe(conn, table)
        station_c = cols["station"]
        time_c = cols["time"]
        msg_c = cols["message"]
        aero_c = cols.get("aeromet")
        icao_c = cols.get("icao")

        select_cols = [f"`{station_c}` AS station", f"`{time_c}` AS obs_time"]
        if msg_c:
            select_cols.append(f"`{msg_c}` AS message")
        if aero_c:
            select_cols.append(f"`{aero_c}` AS aeromet")
        if icao_c:
            select_cols.append(f"`{icao_c}` AS icao")

        now = datetime.now(timezone.utc)
        when = when or now.replace(minute=0, second=0, microsecond=0)
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)

        if timeline == "exact":
            start = when.replace(minute=0, second=0, microsecond=0)
            end = start + timedelta(hours=1)
        else:
            end = when + timedelta(hours=1)
            start = end - timedelta(hours=max(1, lookback_hours))

        where = [f"`{time_c}` >= %s", f"`{time_c}` < %s"]
        params: list[Any] = [start.replace(tzinfo=None), end.replace(tzinfo=None)]
        if station_id:
            where.append(f"`{station_c}` = %s")
            params.append(str(station_id))

        sql = (
            f"SELECT {', '.join(select_cols)} FROM `{table}` "
            f"WHERE {' AND '.join(where)} "
            f"ORDER BY `{time_c}` DESC"
        )
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = list(cur.fetchall() or [])
        return rows
    finally:
        conn.close()


def _wmo_from_row(
    row: dict[str, Any],
    *,
    airports: dict[str, dict],
    stations: dict[str, dict],
) -> Optional[str]:
    key = _station_key(row.get("station"))
    if key and key in stations:
        return key
    if key and re.fullmatch(r"\d{5}", key):
        return key
    icao = str(row.get("icao") or "").upper()
    if not icao and key and re.fullmatch(r"[A-Z]{4}", key or ""):
        icao = key
    if icao and icao in airports and airports[icao].get("wmo"):
        return str(airports[icao]["wmo"])
    # Buscar WMO en el mensaje
    msg = str(row.get("message") or "")
    m = re.search(r"\b(87\d{3}|89\d{3}|86\d{3})\b", msg)
    if m:
        return m.group(1)
    return key if key and re.fullmatch(r"\d{5}", key or "") else None


def fetch_dma_metar_like(
    kind: Literal["metar", "speci"],
    *,
    airports: dict[str, dict],
    stations: dict[str, dict],
    when: Optional[datetime] = None,
    timeline: str = "latest",
    lookback_hours: int = 6,
) -> list[dict[str, Any]]:
    """Lee metar_obs / speci_obs y decodifica el mensaje crudo."""
    rows = _fetch_rows(
        kind, when=when, timeline=timeline, lookback_hours=lookback_hours
    )
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    now = datetime.now(timezone.utc)
    for row in rows:
        raw = row.get("message") or row.get("aeromet")
        if not raw:
            continue
        wmo = _wmo_from_row(row, airports=airports, stations=stations)
        parsed = parse_metar_raw(
            str(raw),
            airports=airports,
            wmo=wmo,
            now=now,
            source="DMA",
        )
        if not parsed:
            continue
        if not parsed.get("wmo") and wmo:
            parsed["wmo"] = wmo
            parsed["omm"] = wmo
        key = str(parsed.get("wmo") or parsed.get("icao") or "")
        if not key:
            continue
        if key in seen:
            # Conservar solo el más reciente por estación (rows ORDER BY time DESC)
            continue
        seen.add(key)
        # Preferir timestamp de la fila si el parse no trae hora
        dt = _as_dt(row.get("obs_time"))
        if dt and (not parsed.get("obs_iso") or timeline == "exact"):
            parsed["obs_iso"] = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            parsed["hour_key"] = dt.strftime("%Y%m%d%H")
        meta = stations.get(str(parsed.get("wmo") or "")) or {}
        if meta:
            parsed.setdefault("nombre", meta.get("nombre"))
            parsed.setdefault("lat", meta.get("lat"))
            parsed.setdefault("lng", meta.get("lng"))
            parsed.setdefault("fir", meta.get("fir"))
        parsed["source"] = "DMA"
        parsed["is_speci"] = kind == "speci" or bool(parsed.get("is_speci"))
        out.append(parsed)
    return out


def fetch_dma_synops(
    *,
    stations: dict[str, dict],
    when: Optional[datetime] = None,
    timeline: str = "latest",
    lookback_hours: int = 24,
    prefer_aeromet: bool = True,
) -> list[dict[str, Any]]:
    """
    Lee synop_obs. Campos de plot/hover desde AEROMET si está;
    si no, decodifica el SYNOP crudo.
    """
    rows = _fetch_rows(
        "synop", when=when, timeline=timeline, lookback_hours=lookback_hours
    )
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    now = when or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    for row in rows:
        wmo = _wmo_from_row(row, airports={}, stations=stations)
        if not wmo or wmo not in stations:
            # Aceptar WMO aunque no esté en catálogo si es 5 dígitos
            if not wmo or not re.fullmatch(r"\d{5}", wmo):
                continue
        if wmo in seen:
            continue
        dt = _as_dt(row.get("obs_time"))
        obs_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None
        hour_key = dt.strftime("%Y%m%d%H") if dt else None
        meta = stations.get(wmo) or {"omm": wmo}
        raw_msg = row.get("message")
        aeromet = row.get("aeromet")

        item: Optional[dict[str, Any]] = None
        if prefer_aeromet and aeromet:
            item = parse_aeromet(
                str(aeromet),
                omm=wmo,
                raw_synop=str(raw_msg) if raw_msg else None,
                obs_iso=obs_iso,
                hour_key=hour_key,
                now=now,
                meta=meta,
            )
        if item is None and raw_msg:
            year = dt.year if dt else now.year
            month = dt.month if dt else now.month
            decoded = parse_synop(
                str(raw_msg),
                wmo,
                year=year,
                month=month,
                day=dt.day if dt else None,
                hour=dt.hour if dt else None,
                minute=dt.minute if dt else 0,
            )
            item = decoded.to_dict()
            item["source"] = "DMA"
            if obs_iso:
                item["obs_iso"] = obs_iso
                item["hour_key"] = hour_key
            if aeromet:
                item["raw_aeromet"] = " ".join(str(aeromet).split())
        if item is None:
            continue
        if item.get("nil"):
            continue
        seen.add(wmo)
        item["omm"] = wmo
        item["wmo"] = wmo
        item["nombre"] = meta.get("nombre") or item.get("nombre")
        item["lat"] = meta.get("lat")
        item["lng"] = meta.get("lng")
        item["fir"] = meta.get("fir")
        item["source"] = "DMA"
        out.append(item)
    return out


def fetch_dma_tafs(
    *,
    when: Optional[datetime] = None,
    lookback_hours: int = 30,
) -> dict[str, dict[str, Any]]:
    """
    Último TAF por ICAO desde taf_obs.

    Returns: { "SABE": {"raw": "...", "obs_iso": "...", "source": "DMA"}, ... }
    """
    rows = _fetch_rows(
        "taf", when=when, timeline="latest", lookback_hours=lookback_hours
    )
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        icao = _station_key(row.get("station"))
        if not icao or not re.fullmatch(r"[A-Z]{4}", icao):
            continue
        if icao in out:
            continue
        raw = row.get("message")
        if not raw:
            continue
        dt = _as_dt(row.get("obs_time"))
        out[icao] = {
            "icao": icao,
            "raw": " ".join(str(raw).split()),
            "obs_iso": dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None,
            "hour_key": dt.strftime("%Y%m%d%H") if dt else None,
            "source": "DMA",
        }
    return out


def fetch_dma_station_metar_series(
    icao: str,
    *,
    airports: dict[str, dict],
    hours: int = 24,
    when: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """Historial METAR+SPECI de un OACI (más reciente primero)."""
    key = str(icao).upper().strip()
    when = when or datetime.now(timezone.utc)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)

    points: list[dict[str, Any]] = []
    for kind in ("metar", "speci"):
        try:
            rows = _fetch_rows(
                kind,  # type: ignore[arg-type]
                when=when,
                timeline="latest",
                lookback_hours=hours,
                station_id=key,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("DMA serie %s %s: %s", kind, key, exc)
            continue
        for row in rows:
            raw = row.get("message")
            if not raw:
                continue
            wmo = _wmo_from_row(row, airports=airports, stations={})
            parsed = parse_metar_raw(
                str(raw),
                airports=airports,
                wmo=wmo,
                now=when,
                source="DMA",
            )
            if not parsed:
                continue
            dt = _as_dt(row.get("obs_time"))
            if dt:
                parsed["obs_iso"] = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                parsed["hour_key"] = dt.strftime("%Y%m%d%H")
            parsed["source"] = "DMA"
            parsed["fallback"] = False
            parsed["is_speci"] = kind == "speci" or bool(parsed.get("is_speci"))
            if kind == "speci":
                parsed["metar_type"] = "SPECI"
            points.append(parsed)

    points.sort(key=lambda p: p.get("obs_iso") or "", reverse=True)
    return points


def fetch_dma_station_synop_series(
    omm: str,
    *,
    stations: dict[str, dict],
    hours: int = 24,
    when: Optional[datetime] = None,
    prefer_aeromet: bool = True,
) -> list[dict[str, Any]]:
    """Serie temporal SYNOP de una estación WMO (más reciente primero)."""
    key = str(omm).strip()
    when = when or datetime.now(timezone.utc)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    meta = stations.get(key) or {"omm": key}

    rows = _fetch_rows(
        "synop",
        when=when,
        timeline="latest",
        lookback_hours=hours,
        station_id=key,
    )
    points: list[dict[str, Any]] = []
    for row in rows:
        dt = _as_dt(row.get("obs_time"))
        obs_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None
        hour_key = dt.strftime("%Y%m%d%H") if dt else None
        raw_msg = row.get("message")
        aeromet = row.get("aeromet")
        item: Optional[dict[str, Any]] = None
        if prefer_aeromet and aeromet:
            item = parse_aeromet(
                str(aeromet),
                omm=key,
                raw_synop=str(raw_msg) if raw_msg else None,
                obs_iso=obs_iso,
                hour_key=hour_key,
                now=when,
                meta=meta,
            )
        if item is None and raw_msg:
            decoded = parse_synop(
                str(raw_msg),
                key,
                year=dt.year if dt else when.year,
                month=dt.month if dt else when.month,
                day=dt.day if dt else None,
                hour=dt.hour if dt else None,
                minute=dt.minute if dt else 0,
            )
            item = decoded.to_dict()
            if obs_iso:
                item["obs_iso"] = obs_iso
                item["hour_key"] = hour_key
            if aeromet:
                item["raw_aeromet"] = " ".join(str(aeromet).split())
        if item is None:
            continue
        item["omm"] = key
        item["wmo"] = key
        item["nombre"] = meta.get("nombre") or item.get("nombre")
        item["lat"] = meta.get("lat")
        item["lng"] = meta.get("lng")
        item["fir"] = meta.get("fir")
        item["source"] = "DMA"
        item["fallback"] = False
        points.append(item)

    points.sort(key=lambda p: p.get("obs_iso") or "", reverse=True)
    return points


def fetch_dma_messages(
    kind: ObsKind,
    *,
    airports: dict[str, dict],
    stations: dict[str, dict],
    when: Optional[datetime] = None,
    timeline: str = "latest",
    lookback_hours: int = 24,
) -> list[dict[str, Any]]:
    if kind in ("metar", "speci"):
        return fetch_dma_metar_like(
            kind,  # type: ignore[arg-type]
            airports=airports,
            stations=stations,
            when=when,
            timeline=timeline,
            lookback_hours=min(lookback_hours, 12),
        )
    if kind == "taf":
        return list(fetch_dma_tafs(when=when, lookback_hours=lookback_hours).values())
    return fetch_dma_synops(
        stations=stations,
        when=when,
        timeline=timeline,
        lookback_hours=lookback_hours,
        prefer_aeromet=True,
    )
