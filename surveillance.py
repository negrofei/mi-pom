"""
Vigilancia METAR (pestaña METAR).

Cascade por estación:
  1) SMN SPECI  (si está vigente vs METAR SMN)
  2) SMN METAR
  3) SMN SYNOP  (se muestra como producto aviación vía front)
  4) AviationWeather SPECI / METAR  (solo para estaciones aún sin dato)
  5) OGIMET SYNOP                   (última opción; tarda más)

SPECI vigente solo si es estrictamente posterior al METAR de la misma etapa.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from aviationweather_client import (
    fetch_argentina_metars,
    fetch_argentina_specis,
)
from ogimet_client import fetch_argentina_synops, resolve_synop_hour
from smn_client import fetch_smn_messages

log = logging.getLogger(__name__)


def _floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _obs_ms(obs: Optional[dict]) -> Optional[float]:
    if not obs:
        return None
    iso = obs.get("obs_iso")
    if not iso:
        return None
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def is_speci_active_vs_metar(speci: dict, metar: Optional[dict]) -> bool:
    """SPECI válido solo si es estrictamente posterior al METAR."""
    st = _obs_ms(speci)
    if st is None:
        return True
    mt = _obs_ms(metar)
    if mt is None:
        return True
    return st > mt


def _latest_by_key(items: list[dict], key: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for it in items:
        k = it.get(key)
        if k is None:
            continue
        k = str(k)
        prev = out.get(k)
        if prev is None or (it.get("obs_iso") or "") >= (prev.get("obs_iso") or ""):
            out[k] = it
    return out


def _index_metar_like(rows: list[dict]) -> dict[str, dict]:
    """Indexa METAR/SPECI por WMO (y completa con ICAO→wmo ya resuelto)."""
    return _latest_by_key([r for r in rows if r.get("wmo")], "wmo")


def _try_smn(
    kind: str,
    wmo_ids: list[str],
    *,
    airports: dict[str, dict],
    stations: dict[str, dict],
) -> tuple[list[dict], Optional[str]]:
    try:
        rows = fetch_smn_messages(
            kind,  # type: ignore[arg-type]
            wmo_ids,
            airports=airports,
            stations=stations,
        )
        return rows or [], None
    except Exception as exc:  # noqa: BLE001
        log.warning("SMN %s falló: %s", kind, exc)
        return [], str(exc)


def _fetch_aw_metars(airports: dict[str, dict]) -> tuple[list[dict], Optional[str]]:
    try:
        rows = fetch_argentina_metars(
            airports=airports,
            hours=6,
            include_taf=False,
            timeline="latest",
            when=resolve_synop_hour(None),
        )
        return rows or [], None
    except Exception as exc:  # noqa: BLE001
        log.exception("AW METAR falló")
        return [], str(exc)


def _fetch_aw_specis(airports: dict[str, dict]) -> tuple[list[dict], Optional[str]]:
    try:
        rows = fetch_argentina_specis(airports=airports, hours=6)
        return rows or [], None
    except Exception as exc:  # noqa: BLE001
        log.exception("AW SPECI falló")
        return [], str(exc)


def _fetch_ogimet_synops(stations: dict[str, dict]) -> tuple[list[dict], Optional[str]]:
    try:
        when = resolve_synop_hour(None)
        decoded = fetch_argentina_synops(
            when, stations=stations, timeline="latest", lookback_hours=24
        )
        rows = []
        for d in decoded:
            item = d.to_dict()
            item["source"] = "OGIMET"
            if d.obs_iso:
                item["hour_key"] = (
                    d.obs_iso[0:4]
                    + d.obs_iso[5:7]
                    + d.obs_iso[8:10]
                    + d.obs_iso[11:13]
                )
            rows.append(item)
        return rows, None
    except Exception as exc:  # noqa: BLE001
        log.exception("OGIMET SYNOP falló")
        return [], str(exc)


def _pick_speci_or_metar(
    speci: Optional[dict],
    metar: Optional[dict],
) -> tuple[Optional[dict], Optional[str]]:
    """Prioridad SPECI (si vigente) > METAR."""
    if speci and is_speci_active_vs_metar(speci, metar):
        return speci, "SPECI"
    if metar:
        return metar, "METAR"
    if speci:
        # SPECI vencido y sin METAR: aún así mostrar el SPECI
        return speci, "SPECI"
    return None, None


def _icao_for_omm(omm: str, airports: dict[str, dict], base: dict) -> Optional[str]:
    icao = base.get("icao")
    if icao:
        return str(icao).upper()
    for a in airports.values():
        if str(a.get("wmo")) == str(omm):
            return str(a.get("icao") or "").upper() or None
    return None


def _stale_flags(
    *,
    hour_key: Optional[str],
    obs_iso: Optional[str],
    current_hour: datetime,
    current_hour_key: str,
) -> bool:
    if hour_key:
        return str(hour_key) < current_hour_key
    if obs_iso:
        try:
            dt = datetime.fromisoformat(str(obs_iso).replace("Z", "+00:00"))
            return _floor_hour(dt) < current_hour
        except ValueError:
            return True
    return True


def build_surveillance(
    *,
    stations: dict[str, dict],
    airports: dict[str, dict],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    current_hour = _floor_hour(now)
    current_hour_key = current_hour.strftime("%Y%m%d%H")

    wmo_from_airports = [str(a["wmo"]) for a in airports.values() if a.get("wmo")]
    wmo_ids = sorted(set(list(stations.keys()) + wmo_from_airports))

    # --- Etapa SMN (todas las estaciones) ---
    smn_speci_rows, err_smn_speci = _try_smn(
        "speci", wmo_ids, airports=airports, stations=stations
    )
    smn_metar_rows, err_smn_metar = _try_smn(
        "metar", wmo_ids, airports=airports, stations=stations
    )
    smn_synop_rows, err_smn_synop = _try_smn(
        "synop", wmo_ids, airports=airports, stations=stations
    )

    smn_speci = _index_metar_like(smn_speci_rows)
    smn_metar = _index_metar_like(smn_metar_rows)
    smn_synop = _latest_by_key(smn_synop_rows, "omm")

    chosen: dict[str, dict[str, Any]] = {}
    filled_by = {"SMN": 0, "AviationWeather": 0, "OGIMET": 0}
    missing: list[str] = []

    for omm, meta in stations.items():
        if meta.get("lat") is None or meta.get("lng") is None:
            continue
        key = str(omm)
        obs, product = _pick_speci_or_metar(smn_speci.get(key), smn_metar.get(key))
        if obs is not None:
            chosen[key] = {
                "obs": obs,
                "product": product or "METAR",
                "source": obs.get("source") or "SMN",
                "speci": smn_speci.get(key)
                if product == "SPECI"
                or (
                    smn_speci.get(key)
                    and is_speci_active_vs_metar(smn_speci[key], smn_metar.get(key))
                )
                else None,
            }
            filled_by["SMN"] += 1
            continue
        syn = smn_synop.get(key)
        if syn is not None:
            chosen[key] = {
                "obs": syn,
                "product": "SYNOP",
                "source": syn.get("source") or "SMN",
                "speci": None,
            }
            filled_by["SMN"] += 1
            continue
        missing.append(key)

    # --- Contingencia solo para estaciones sin dato SMN ---
    aw_metar: dict[str, dict] = {}
    aw_speci: dict[str, dict] = {}
    ogimet_synop: dict[str, dict] = {}
    err_aw_metar = err_aw_speci = err_ogimet = None

    if missing:
        aw_metar_rows, err_aw_metar = _fetch_aw_metars(airports)
        aw_speci_rows, err_aw_speci = _fetch_aw_specis(airports)
        ogimet_rows, err_ogimet = _fetch_ogimet_synops(stations)
        aw_metar = _index_metar_like(aw_metar_rows)
        aw_speci = _index_metar_like(aw_speci_rows)
        ogimet_synop = _latest_by_key(ogimet_rows, "omm")

        for key in missing:
            obs, product = _pick_speci_or_metar(aw_speci.get(key), aw_metar.get(key))
            if obs is not None:
                chosen[key] = {
                    "obs": obs,
                    "product": product or "METAR",
                    "source": obs.get("source") or "AviationWeather",
                    "speci": aw_speci.get(key)
                    if product == "SPECI"
                    or (
                        aw_speci.get(key)
                        and is_speci_active_vs_metar(aw_speci[key], aw_metar.get(key))
                    )
                    else None,
                }
                filled_by["AviationWeather"] += 1
                continue
            syn = ogimet_synop.get(key)
            if syn is not None:
                chosen[key] = {
                    "obs": syn,
                    "product": "SYNOP",
                    "source": syn.get("source") or "OGIMET",
                    "speci": None,
                }
                filled_by["OGIMET"] += 1

    # --- Armar puntos + lista SPECI ---
    points: list[dict[str, Any]] = []
    active_specis: list[dict] = []
    seen_speci: set[str] = set()

    for omm, meta in stations.items():
        if meta.get("lat") is None or meta.get("lng") is None:
            continue
        key = str(omm)
        pick = chosen.get(key)
        if not pick:
            continue
        base = {**pick["obs"]}
        product = pick["product"]
        source = pick["source"]
        speci = pick.get("speci")
        # Si el producto primario es SPECI, el propio obs es el SPECI
        if product == "SPECI":
            speci = base

        obs_iso = base.get("obs_iso")
        hour_key = base.get("hour_key")
        stale = _stale_flags(
            hour_key=hour_key,
            obs_iso=obs_iso,
            current_hour=current_hour,
            current_hour_key=current_hour_key,
        )
        age_hours = None
        tms = _obs_ms({"obs_iso": obs_iso})
        if tms is not None:
            age_hours = round((now.timestamp() - tms) / 3600.0, 2)

        icao = _icao_for_omm(key, airports, base)
        point = {
            **base,
            "omm": key,
            "nombre": meta.get("nombre") or base.get("nombre"),
            "lat": meta.get("lat"),
            "lng": meta.get("lng"),
            "fir": meta.get("fir") or base.get("fir"),
            "icao": icao,
            "product": product,
            "source": source,
            "obs_iso": obs_iso,
            "hour_key": hour_key,
            "stale": stale,
            "age_hours": age_hours,
            "has_speci": bool(speci),
            "speci": speci if product != "SPECI" else None,
            # si product==SPECI el detalle ya es el SPECI; evitar duplicar panel
        }
        # Mantener speci en overlay solo cuando el primario NO es SPECI
        if product == "SPECI":
            point["has_speci"] = True
            point["is_speci"] = True
        points.append(point)

        if speci:
            sk = str(speci.get("icao") or speci.get("wmo") or key)
            if sk not in seen_speci:
                seen_speci.add(sk)
                item = dict(speci)
                item["omm"] = key
                item["station_nombre"] = meta.get("nombre")
                item["lat"] = meta.get("lat")
                item["lng"] = meta.get("lng")
                item["fir"] = meta.get("fir") or item.get("fir")
                item["source"] = item.get("source") or source
                active_specis.append(item)

    active_specis.sort(key=lambda x: x.get("obs_iso") or "", reverse=True)

    return {
        "now_iso": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "current_hour": current_hour_key,
        "hour_label": current_hour.strftime("%d/%m/%Y %H:00 UTC"),
        "cascade": [
            "SMN SPECI",
            "SMN METAR",
            "SMN SYNOP",
            "AviationWeather SPECI/METAR",
            "OGIMET SYNOP",
        ],
        "sources": {
            "smn_speci": {
                "ok": err_smn_speci is None,
                "count": len(smn_speci_rows),
                "error": err_smn_speci,
            },
            "smn_metar": {
                "ok": err_smn_metar is None,
                "count": len(smn_metar_rows),
                "error": err_smn_metar,
            },
            "smn_synop": {
                "ok": err_smn_synop is None,
                "count": len(smn_synop_rows),
                "error": err_smn_synop,
            },
            "aw_metar": {
                "ok": err_aw_metar is None if missing else None,
                "count": len(aw_metar) if missing else 0,
                "error": err_aw_metar,
                "used": bool(missing),
            },
            "aw_speci": {
                "ok": err_aw_speci is None if missing else None,
                "count": len(aw_speci) if missing else 0,
                "error": err_aw_speci,
                "used": bool(missing),
            },
            "ogimet_synop": {
                "ok": err_ogimet is None if missing else None,
                "count": len(ogimet_synop) if missing else 0,
                "error": err_ogimet,
                "used": bool(missing),
            },
        },
        "filled_by": filled_by,
        "missing_after_smn": len(missing),
        "count": len(points),
        "speci_count": len(active_specis),
        "stations": points,
        "specis": active_specis,
        "debug_urls": {
            "metar": "/api/smn/debug?kind=metar&omm=87582&raw=1",
            "speci": "/api/smn/debug?kind=speci&omm=87582&raw=1",
            "synop": "/api/smn/debug?kind=synop&omm=87582&raw=1",
        },
    }
