"""Visor SYNOP / METAR Argentina — OGIMET + AviationWeather."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory

from aviationweather_client import (
    fetch_argentina_metars,
    fetch_argentina_specis,
    fetch_station_metars,
)
from ogimet_client import fetch_argentina_synops, fetch_station_series, resolve_synop_hour

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


@app.get("/")
def index():
    return render_template("index.html")


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


@app.get("/api/specis")
def api_specis():
    """SPECI recientes desde AviationWeather (alerta rápida)."""
    try:
        hours = int(request.args.get("hours", "6"))
    except ValueError:
        return jsonify({"error": "hours inválido"}), 400
    hours = max(1, min(hours, 12))

    try:
        specis = fetch_argentina_specis(airports=AIRPORTS, hours=hours)
    except Exception as exc:  # noqa: BLE001
        log.exception("Error consultando SPECI")
        return jsonify({"error": f"No se pudo consultar AviationWeather: {exc}"}), 502

    return jsonify(
        {
            "hours": hours,
            "source": "AviationWeather",
            "count": len(specis),
            "specis": specis,
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
    """Historial METAR de un aeródromo (por defecto 24 h)."""
    try:
        hours = int(request.args.get("hours", "24"))
    except ValueError:
        return jsonify({"error": "hours inválido"}), 400
    hours = max(1, min(hours, 48))
    include_taf = request.args.get("taf", "1") == "1"
    key = str(icao).upper().strip()
    if key not in AIRPORTS:
        return jsonify({"error": f"Aeródromo {key} no encontrado"}), 404

    try:
        points = fetch_station_metars(
            key, airports=AIRPORTS, hours=hours, include_taf=include_taf
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Error consultando historial METAR")
        return jsonify({"error": f"No se pudo consultar AviationWeather: {exc}"}), 502

    meta = AIRPORTS[key]
    return jsonify(
        {
            "icao": key,
            "nombre": meta.get("nombre"),
            "fir": meta.get("fir"),
            "hours": hours,
            "count": len(points),
            "points": points,
        }
    )


@app.get("/api/synops")
def api_synops():
    hour = request.args.get("hour")  # YYYYMMDDHH UTC opcional
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

    try:
        synops = fetch_argentina_synops(
            when,
            stations=STATIONS,
            timeline=timeline,  # type: ignore[arg-type]
            lookback_hours=lookback,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Error consultando OGIMET")
        return jsonify({"error": f"No se pudo consultar OGIMET: {exc}"}), 502

    include_nil = request.args.get("nil", "0") == "1"
    if not include_nil:
        synops = [s for s in synops if not s.nil]

    payload = {
        "hour": when.strftime("%Y%m%d%H"),
        "hour_label": when.strftime("%d/%m/%Y %H:00 UTC"),
        "timeline": timeline,
        "lookback_hours": lookback if timeline == "latest" else 0,
        "source": "OGIMET",
        "count": len(synops),
        "synops": [s.to_dict() for s in synops],
    }
    return jsonify(payload)


@app.get("/api/synops/<omm>")
def api_station_series(omm: str):
    """Serie temporal de una estación (por defecto últimas 24 h)."""
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

    try:
        series = fetch_station_series(
            str(omm), when, stations=STATIONS, hours=hours
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Error consultando serie OGIMET")
        return jsonify({"error": f"No se pudo consultar OGIMET: {exc}"}), 502

    include_nil = request.args.get("nil", "0") == "1"
    points = []
    for obs_dt, decoded in series:
        if decoded.nil and not include_nil:
            continue
        item = decoded.to_dict()
        item["obs_iso"] = obs_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        item["hour_key"] = obs_dt.strftime("%Y%m%d%H")
        points.append(item)

    meta = STATIONS[str(omm)]
    return jsonify(
        {
            "omm": str(omm),
            "nombre": meta.get("nombre"),
            "hours": hours,
            "until": when.strftime("%Y%m%d%H"),
            "until_label": when.strftime("%d/%m/%Y %H:00 UTC"),
            "count": len(points),
            "points": points,
        }
    )


@app.get("/health")
def health():
    return jsonify(
        {"ok": True, "stations": len(STATIONS), "airports": len(AIRPORTS)}
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=True)
