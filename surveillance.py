"""
Vigilancia METAR: combina SMN (primario) con contingencias OGIMET / AviationWeather.

Prioridad:
  METAR  → SMN → AviationWeather
  SYNOP  → SMN → OGIMET
  SPECI  → SMN → AviationWeather

SPECI vigente solo si es posterior al último METAR de la estación.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
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


def _fetch_metars_with_fallback(
    *,
    airports: dict[str, dict],
    wmo_ids: list[str],
) -> tuple[list[dict], str]:
    try:
        rows = fetch_smn_messages("metar", wmo_ids, airports=airports)
        if rows:
            return rows, "SMN"
    except Exception as exc:  # noqa: BLE001
        log.warning("SMN METAR falló, contingencia AW: %s", exc)
    try:
        rows = fetch_argentina_metars(
            airports=airports,
            hours=6,
            include_taf=False,
            timeline="latest",
            when=resolve_synop_hour(None),
        )
        # latest per icao already
        return rows, "AviationWeather"
    except Exception as exc:  # noqa: BLE001
        log.exception("AW METAR también falló")
        return [], f"error:{exc}"


def _fetch_synops_with_fallback(
    *,
    stations: dict[str, dict],
    wmo_ids: list[str],
) -> tuple[list[dict], str]:
    try:
        rows = fetch_smn_messages("synop", wmo_ids, stations=stations)
        if rows:
            return rows, "SMN"
    except Exception as exc:  # noqa: BLE001
        log.warning("SMN SYNOP falló, contingencia OGIMET: %s", exc)
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
        return rows, "OGIMET"
    except Exception as exc:  # noqa: BLE001
        log.exception("OGIMET SYNOP también falló")
        return [], f"error:{exc}"


def _fetch_specis_with_fallback(
    *,
    airports: dict[str, dict],
    wmo_ids: list[str],
) -> tuple[list[dict], str]:
    try:
        rows = fetch_smn_messages("speci", wmo_ids, airports=airports)
        if rows:
            return rows, "SMN"
    except Exception as exc:  # noqa: BLE001
        log.warning("SMN SPECI falló, contingencia AW: %s", exc)
    try:
        rows = fetch_argentina_specis(airports=airports, hours=6)
        return rows, "AviationWeather"
    except Exception as exc:  # noqa: BLE001
        log.exception("AW SPECI también falló")
        return [], f"error:{exc}"


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

    metars, metar_src = _fetch_metars_with_fallback(airports=airports, wmo_ids=wmo_ids)
    synops, synop_src = _fetch_synops_with_fallback(stations=stations, wmo_ids=wmo_ids)
    specis_raw, speci_src = _fetch_specis_with_fallback(airports=airports, wmo_ids=wmo_ids)

    metar_by_wmo = _latest_by_key(
        [m for m in metars if m.get("wmo")], "wmo"
    )
    metar_by_icao = _latest_by_key(metars, "icao")
    synop_by_omm = _latest_by_key(synops, "omm")

    # SPECI activos vs METAR
    active_specis: list[dict] = []
    speci_by_wmo: dict[str, dict] = {}
    for s in specis_raw:
        wmo = str(s["wmo"]) if s.get("wmo") is not None else None
        icao = str(s.get("icao") or "").upper() or None
        metar = None
        if wmo and wmo in metar_by_wmo:
            metar = metar_by_wmo[wmo]
        elif icao and icao in metar_by_icao:
            metar = metar_by_icao[icao]
        if not is_speci_active_vs_metar(s, metar):
            continue
        active_specis.append(s)
        if wmo:
            prev = speci_by_wmo.get(wmo)
            if prev is None or (s.get("obs_iso") or "") >= (prev.get("obs_iso") or ""):
                speci_by_wmo[wmo] = s

    active_specis.sort(key=lambda x: x.get("obs_iso") or "", reverse=True)

    points: list[dict[str, Any]] = []
    for omm, meta in stations.items():
        if meta.get("lat") is None or meta.get("lng") is None:
            continue
        metar = metar_by_wmo.get(str(omm))
        synop = synop_by_omm.get(str(omm))
        speci = speci_by_wmo.get(str(omm))

        if metar:
            product = "METAR"
            base = {**metar}
            obs_iso = metar.get("obs_iso")
            hour_key = metar.get("hour_key")
            source = metar.get("source") or metar_src
        elif synop:
            product = "SYNOP"
            base = {**synop}
            obs_iso = synop.get("obs_iso")
            hour_key = synop.get("hour_key")
            source = synop.get("source") or synop_src
        else:
            continue

        stale = True
        if hour_key:
            stale = str(hour_key) < current_hour_key
        elif obs_iso:
            try:
                dt = datetime.fromisoformat(str(obs_iso).replace("Z", "+00:00"))
                stale = _floor_hour(dt) < current_hour
            except ValueError:
                stale = True

        # Edad en horas (para UI)
        age_hours = None
        tms = _obs_ms({"obs_iso": obs_iso})
        if tms is not None:
            age_hours = round((now.timestamp() - tms) / 3600.0, 2)

        icao = base.get("icao")
        if not icao and metar:
            icao = metar.get("icao")
        # map omm→icao via airports
        if not icao:
            for a in airports.values():
                if str(a.get("wmo")) == str(omm):
                    icao = a.get("icao")
                    break

        point = {
            **base,
            "omm": str(omm),
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
            "speci": speci,
        }
        points.append(point)

    # Enriquecer SPECI list con coords de estación
    speci_list = []
    for s in active_specis:
        item = dict(s)
        wmo = str(s["wmo"]) if s.get("wmo") is not None else None
        if wmo and wmo in stations:
            item["omm"] = wmo
            item["station_nombre"] = stations[wmo].get("nombre")
            item["lat"] = stations[wmo].get("lat")
            item["lng"] = stations[wmo].get("lng")
            item["fir"] = stations[wmo].get("fir") or item.get("fir")
        speci_list.append(item)

    return {
        "now_iso": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "current_hour": current_hour_key,
        "hour_label": current_hour.strftime("%d/%m/%Y %H:00 UTC"),
        "sources": {
            "metar": metar_src,
            "synop": synop_src,
            "speci": speci_src,
        },
        "count": len(points),
        "speci_count": len(speci_list),
        "stations": points,
        "specis": speci_list,
    }
