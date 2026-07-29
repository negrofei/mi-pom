"""Visor SYNOP Argentina — datos desde OGIMET."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory

from ogimet_client import fetch_argentina_synops, resolve_synop_hour

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

BASE = Path(__file__).resolve().parent
STATIONS_PATH = BASE / "data" / "stations.json"
IMG_PATH = BASE / "img"

app = Flask(__name__)


def load_stations() -> dict[str, dict]:
    raw = json.loads(STATIONS_PATH.read_text(encoding="utf-8"))
    return {str(s["omm"]): s for s in raw}


STATIONS = load_stations()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/img/<path:filename>")
def img_files(filename: str):
    """Sirve barbas y símbolos meteorológicos."""
    return send_from_directory(IMG_PATH, filename)


@app.get("/api/stations")
def api_stations():
    return jsonify({"stations": list(STATIONS.values())})


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


@app.get("/health")
def health():
    return jsonify({"ok": True, "stations": len(STATIONS)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=True)
