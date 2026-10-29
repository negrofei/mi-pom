"""Visor SYNOP / METAR Argentina — DMA + OGIMET + AviationWeather."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory

from aviationweather_client import (
    fetch_argentina_metars,
    fetch_station_metars,
)
from dma_client import (
    dma_status,
    fetch_dma_station_metar_series,
    fetch_dma_station_synop_series,
    fetch_dma_synops,
)
from ogimet_client import fetch_argentina_synops, fetch_station_series, resolve_synop_hour
from surveillance import build_surveillance

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

BASE = Path(__file__).resolve().parent
STATIONS_PATH = BASE / "data" / "stations.json"
AIRPORTS_PATH = BASE / "data" / "airports.json"
FIR_PATH = BASE / "data" / "fir_argentina.geojson"
IMG_PATH = BASE / "img"

app = Flask(__name__)


def load_stations() -> dict[str, dict]:
    raw = json.loads(STATIONS_PATH.read_text(encoding="utf-8"))
    return {str(s["omm"]): s for s in raw}


def load_airports() -> dict[str, dict]:
    raw = json.loads(AIRPORTS_PATH.read_text(encoding="utf-8"))
    return {str(a["icao"]).upper(): a for a in raw}


STATIONS = load_stations()
AIRPORTS = load_airports()


_UI_PRODUCT = {"synop": "synop", "metar": "metar"}


@app.get("/")
def index_root():
    return redirect("/synop", code=302)


@app.get("/synop")
@app.get("/metar")
def index_product():
    """Una URL por panel para poder abrirlos en pestañas distintas del navegador."""
    page = (request.path or "/synop").strip("/") or "synop"
    ui_product = _UI_PRODUCT.get(page, "synop")
    titles = {
        "synop": "SYNOP Argentina",
        "metar": "METAR / vigilancia Argentina",
    }
    return render_template(
        "index.html",
        initial_product=ui_product,
        page_path=page,
        page_title=titles.get(page, "WX Argentina"),
    )


@app.get("/img/<path:filename>")
def img_files(filename: str):
    """Sirve barbas y símbolos meteorológicos."""
    return send_from_directory(IMG_PATH, filename)


@app.get("/data/<path:filename>")
def data_files(filename: str):
    """Sirve GeoJSON y otros datos estáticos."""
    return send_from_directory(BASE / "data", filename)


@app.get("/api/fir")
def api_fir():
    """Polígonos FIR de Argentina (líneas de información de vuelo)."""
    return jsonify(json.loads(FIR_PATH.read_text(encoding="utf-8")))


@app.get("/api/stations")
def api_stations():
    return jsonify({"stations": list(STATIONS.values())})


@app.get("/api/airports")
def api_airports():
    return jsonify({"airports": list(AIRPORTS.values()), "count": len(AIRPORTS)})


@app.get("/api/surveillance")
def api_surveillance():
    """
    Vigilancia METAR: cascade DMA → AviationWeather / OGIMET.
    """
    try:
        payload = build_surveillance(stations=STATIONS, airports=AIRPORTS)
    except Exception as exc:  # noqa: BLE001
        log.exception("Error vigilancia")
        return jsonify({"error": f"No se pudo armar vigilancia: {exc}"}), 502
    return jsonify(payload)


@app.get("/api/dma/status")
def api_dma_status():
    """Estado del sondeo MySQL DMA (10.10.100.121)."""
    force = (request.args.get("refresh") or "0") in ("1", "true", "yes")
    return jsonify(dma_status(force_refresh=force))


@app.get("/api/specis")
def api_specis():
    """SPECI vigentes según /api/surveillance."""
    try:
        hours = int(request.args.get("hours", "6"))
    except ValueError:
        return jsonify({"error": "hours inválido"}), 400
    hours = max(1, min(hours, 12))
    try:
        payload = build_surveillance(stations=STATIONS, airports=AIRPORTS)
    except Exception as exc:  # noqa: BLE001
        log.exception("Error consultando SPECI")
        return jsonify({"error": f"No se pudo consultar SPECI: {exc}"}), 502
    specis = payload.get("specis") or []
    return jsonify(
        {
            "hours": hours,
            "source": "contingency" if payload.get("contingency_only") else "DMA",
            "contingency_only": payload.get("contingency_only"),
            "count": len(specis),
            "specis": specis,
            "filled_by": payload.get("filled_by"),
        }
    )


@app.get("/api/taf-amends")
def api_taf_amends():
    """Alertas de posible enmienda TAF (METAR/SPECI vs umbrales ICAO)."""
    try:
        payload = build_surveillance(stations=STATIONS, airports=AIRPORTS)
    except Exception as exc:  # noqa: BLE001
        log.exception("Error consultando enmiendas TAF")
        return jsonify({"error": f"No se pudo consultar enmiendas TAF: {exc}"}), 502
    amends = payload.get("taf_amends") or []
    return jsonify(
        {
            "source": "contingency" if payload.get("contingency_only") else "DMA",
            "contingency_only": payload.get("contingency_only"),
            "taf_source": (payload.get("sources") or {}).get("aw_taf"),
            "count": len(amends),
            "taf_amends": amends,
            "filled_by": payload.get("filled_by"),
        }
    )


@app.get("/api/metars")
def api_metars():
    """METARs (y TAF) de aeródromos argentinos vía AviationWeather."""
    hour = request.args.get("hour")
    timeline = (request.args.get("timeline") or "latest").lower()
    if timeline not in ("exact", "latest"):
        return jsonify({"error": "timeline debe ser 'exact' o 'latest'"}), 400
    try:
        hours = int(request.args.get("hours", "3" if timeline == "latest" else "1"))
    except ValueError:
        return jsonify({"error": "hours inválido"}), 400
    hours = max(1, min(hours, 24))
    include_taf = request.args.get("taf", "1") == "1"

    try:
        when = resolve_synop_hour(hour)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        metars = fetch_argentina_metars(
            airports=AIRPORTS,
            hours=hours,
            include_taf=include_taf,
            timeline=timeline,
            when=when,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Error consultando AviationWeather")
        return jsonify({"error": f"No se pudo consultar AviationWeather: {exc}"}), 502

    specis = [m for m in metars if m.get("is_speci")]
    return jsonify(
        {
            "hour": when.strftime("%Y%m%d%H"),
            "hour_label": when.strftime("%d/%m/%Y %H:00 UTC"),
            "timeline": timeline,
            "hours": hours,
            "source": "AviationWeather",
            "count": len(metars),
            "speci_count": len(specis),
            "specis": [
                {
                    "icao": s["icao"],
                    "nombre": s.get("nombre"),
                    "wmo": s.get("wmo"),
                    "obs_iso": s.get("obs_iso"),
                    "raw": s.get("raw"),
                    "flt_cat": s.get("flt_cat"),
                }
                for s in specis
            ],
            "metars": metars,
        }
    )


@app.get("/api/metars/<icao>")
def api_metar_station(icao: str):
    """Historial METAR/SPECI: DMA primero, fallback AviationWeather."""
    try:
        hours = int(request.args.get("hours", "24"))
    except ValueError:
        return jsonify({"error": "hours inválido"}), 400
    hours = max(1, min(hours, 48))
    include_taf = request.args.get("taf", "1") == "1"
    key = str(icao).upper().strip()
    if key not in AIRPORTS:
        return jsonify({"error": f"Aeródromo {key} no encontrado"}), 404

    source = "DMA"
    dma_err: str | None = None
    points: list = []
    try:
        points = fetch_dma_station_metar_series(
            key, airports=AIRPORTS, hours=hours
        )
    except Exception as exc:  # noqa: BLE001
        dma_err = str(exc)
        log.warning("DMA historial METAR %s falló: %s", key, exc)
        points = []

    if not points:
        try:
            points = fetch_station_metars(
                key, airports=AIRPORTS, hours=hours, include_taf=include_taf
            )
            source = "AviationWeather"
            for p in points:
                p["source"] = p.get("source") or "AviationWeather"
                p["fallback"] = True
        except Exception as exc:  # noqa: BLE001
            log.exception("Error consultando historial METAR")
            return jsonify(
                {
                    "error": (
                        f"No se pudo consultar historial (DMA: {dma_err}; AW: {exc})"
                    )
                }
            ), 502

    meta = AIRPORTS[key]
    return jsonify(
        {
            "icao": key,
            "nombre": meta.get("nombre"),
            "fir": meta.get("fir"),
            "hours": hours,
            "source": source,
            "fallback": source != "DMA",
            "dma_error": dma_err,
            "count": len(points),
            "points": points,
        }
    )


@app.get("/api/synops")
def api_synops():
    """SYNOPs: DMA (AEROMET) primero; si falla o vacío, OGIMET."""
    hour = request.args.get("hour")
    timeline = (request.args.get("timeline") or "exact").lower()
    if timeline not in ("exact", "latest"):
        return jsonify({"error": "timeline debe ser 'exact' o 'latest'"}), 400

    try:
        lookback = int(request.args.get("lookback", "24"))
    except ValueError:
        return jsonify({"error": "lookback inválido"}), 400
    lookback = max(1, min(lookback, 72))

    try:
        when = resolve_synop_hour(hour)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    include_nil = request.args.get("nil", "0") == "1"
    source = "DMA"
    synops: list[dict] = []
    dma_err: str | None = None

    try:
        synops = fetch_dma_synops(
            stations=STATIONS,
            when=when,
            timeline=timeline,
            lookback_hours=lookback,
            prefer_aeromet=True,
        )
    except Exception as exc:  # noqa: BLE001
        dma_err = str(exc)
        log.warning("DMA SYNOP falló, fallback OGIMET: %s", exc)
        synops = []

    if not synops:
        try:
            decoded = fetch_argentina_synops(
                when,
                stations=STATIONS,
                timeline=timeline,  # type: ignore[arg-type]
                lookback_hours=lookback,
            )
            if not include_nil:
                decoded = [s for s in decoded if not s.nil]
            synops = [s.to_dict() for s in decoded]
            source = "OGIMET"
        except Exception as exc:  # noqa: BLE001
            log.exception("Error consultando OGIMET")
            msg = f"No se pudo consultar SYNOP (DMA: {dma_err}; OGIMET: {exc})"
            return jsonify({"error": msg}), 502
    elif not include_nil:
        synops = [s for s in synops if not s.get("nil")]

    # Marcar fuente en cada estación (detalle al click)
    fallback = source != "DMA"
    for s in synops:
        s["source"] = s.get("source") or source
        s["fallback"] = fallback or (str(s.get("source") or "") != "DMA")

    payload = {
        "hour": when.strftime("%Y%m%d%H"),
        "hour_label": when.strftime("%d/%m/%Y %H:00 UTC"),
        "timeline": timeline,
        "lookback_hours": lookback if timeline == "latest" else 0,
        "source": source,
        "fallback": fallback,
        "dma_error": dma_err,
        "count": len(synops),
        "synops": synops,
    }
    return jsonify(payload)


@app.get("/api/synops/<omm>")
def api_station_series(omm: str):
    """Serie temporal SYNOP: DMA primero, fallback OGIMET."""
    hour = request.args.get("hour")
    try:
        hours = int(request.args.get("hours", "24"))
    except ValueError:
        return jsonify({"error": "hours inválido"}), 400
    hours = max(1, min(hours, 72))

    try:
        when = resolve_synop_hour(hour)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if str(omm) not in STATIONS:
        return jsonify({"error": f"Estación {omm} no encontrada"}), 404

    include_nil = request.args.get("nil", "0") == "1"
    source = "DMA"
    dma_err: str | None = None
    points: list = []

    try:
        points = fetch_dma_station_synop_series(
            str(omm), stations=STATIONS, hours=hours, when=when, prefer_aeromet=True
        )
        if not include_nil:
            points = [p for p in points if not p.get("nil")]
    except Exception as exc:  # noqa: BLE001
        dma_err = str(exc)
        log.warning("DMA serie SYNOP %s falló: %s", omm, exc)
        points = []

    if not points:
        try:
            series = fetch_station_series(
                str(omm), when, stations=STATIONS, hours=hours
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("Error consultando serie OGIMET")
            return jsonify(
                {
                    "error": (
                        f"No se pudo consultar serie (DMA: {dma_err}; OGIMET: {exc})"
                    )
                }
            ), 502
        source = "OGIMET"
        for obs_dt, decoded in series:
            if decoded.nil and not include_nil:
                continue
            item = decoded.to_dict()
            item["obs_iso"] = obs_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            item["hour_key"] = obs_dt.strftime("%Y%m%d%H")
            item["source"] = "OGIMET"
            item["fallback"] = True
            points.append(item)

    meta = STATIONS[str(omm)]
    return jsonify(
        {
            "omm": str(omm),
            "nombre": meta.get("nombre"),
            "hours": hours,
            "until": when.strftime("%Y%m%d%H"),
            "until_label": when.strftime("%d/%m/%Y %H:00 UTC"),
            "source": source,
            "fallback": source != "DMA",
            "dma_error": dma_err,
            "count": len(points),
            "points": points,
        }
    )


@app.get("/health")
def health():
    status = dma_status()
    return jsonify(
        {
            "ok": True,
            "stations": len(STATIONS),
            "airports": len(AIRPORTS),
            "dma": status,
            "contingency_only": not bool(status.get("ok")),
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=True)
