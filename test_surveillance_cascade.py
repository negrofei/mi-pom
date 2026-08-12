"""Tests: contingencia SMN, cascade, NIL oculto, barbas METAR."""

from __future__ import annotations

from unittest.mock import patch

from metar_parser import parse_metar_raw
from surveillance import build_surveillance, is_speci_active_vs_metar
from synop_parser import barb_key


STATIONS = {
    "87582": {
        "omm": "87582",
        "nombre": "Aeroparque",
        "lat": -34.56,
        "lng": -58.42,
        "fir": "EZE",
    },
    "87642": {
        "omm": "87642",
        "nombre": "Sauce Viejo",
        "lat": -31.7,
        "lng": -60.8,
        "fir": "EZE",
    },
    "87047": {
        "omm": "87047",
        "nombre": "La Quiaca",
        "lat": -22.1,
        "lng": -65.6,
        "fir": "SIS",
    },
}

AIRPORTS = {
    "SABE": {
        "icao": "SABE",
        "wmo": "87582",
        "nombre": "Aeroparque",
        "lat": -34.56,
        "lng": -58.42,
        "fir": "EZE",
    },
    "SAZA": {
        "icao": "SAZA",
        "wmo": "87642",
        "nombre": "Sauce Viejo",
        "lat": -31.7,
        "lng": -60.8,
        "fir": "EZE",
    },
    "SAZR": {
        "icao": "SAZR",
        "wmo": "87448",
        "nombre": "Santa Rosa",
        "lat": -36.58,
        "lng": -64.27,
        "fir": "EZE",
    },
}


def _metar(icao, wmo, obs_iso, *, speci=False, source="SMN", raw=None, clouds=None):
    return {
        "icao": icao,
        "wmo": wmo,
        "omm": wmo,
        "obs_iso": obs_iso,
        "hour_key": obs_iso[0:4] + obs_iso[5:7] + obs_iso[8:10] + obs_iso[11:13],
        "raw": raw or f"{'SPECI' if speci else 'METAR'} {icao} …=",
        "is_speci": speci,
        "visibility_m": 9999,
        "flt_cat": "VFR",
        "source": source,
        "clouds": clouds or [],
        "wind_dir": 100,
        "wind_speed_kt": 5,
        "wind_barb": "5",
    }


def _synop(omm, obs_iso, *, source="SMN", nil=False):
    return {
        "omm": omm,
        "obs_iso": obs_iso,
        "hour_key": obs_iso[0:4] + obs_iso[5:7] + obs_iso[8:10] + obs_iso[11:13],
        "raw": f"AAXX … {omm} NIL=" if nil else f"AAXX … {omm}=",
        "source": source,
        "visibility_m": 20000,
        "cloud_layers": [],
        "nil": nil,
        "wind_barb": "0",
    }


def test_barb_key_and_metar_parser_wind_barb():
    assert barb_key(5, 100) == "5"
    assert barb_key(0, None) == "0"
    assert barb_key(10, None, variable=True) == "v"
    m = parse_metar_raw(
        "METAR SAZR 121100Z 10005KT 9999 SCT008 BKN013 03/02 Q1023=",
        airports=AIRPORTS,
        now=__import__("datetime").datetime(2026, 8, 12, 12, 0, tzinfo=__import__("datetime").timezone.utc),
    )
    assert m["wind_barb"] == "5"
    assert m["wind_dir"] == 100
    assert [c["cover"] for c in m["clouds"]] == ["SCT", "BKN"]


def test_contingency_skips_smn_when_unavailable():
    with patch("surveillance.smn_status", return_value={"ok": False, "mode": "auto", "reason": "Cloudflare"}), patch(
        "surveillance.fetch_smn_messages"
    ) as smn, patch("surveillance.fetch_argentina_metars") as aw_m, patch(
        "surveillance.fetch_argentina_specis"
    ) as aw_s, patch("surveillance.fetch_argentina_synops") as og, patch(
        "surveillance.resolve_synop_hour", return_value=None
    ):
        aw_m.return_value = [
            _metar("SABE", "87582", "2026-08-12T11:00:00Z", source="AviationWeather")
        ]
        aw_s.return_value = []
        og.return_value = []
        out = build_surveillance(stations={"87582": STATIONS["87582"]}, airports=AIRPORTS)

    smn.assert_not_called()
    assert out["contingency_only"] is True
    assert out["filled_by"]["AviationWeather"] == 1
    assert out["filled_by"]["SMN"] == 0


def test_nil_synop_hidden():
    class Fake:
        def __init__(self, omm, obs_iso, nil=False):
            self.omm = omm
            self.obs_iso = obs_iso
            self.nil = nil
            self.raw = "NIL" if nil else "AAXX"

        def to_dict(self):
            return _synop(self.omm, self.obs_iso, source="OGIMET", nil=self.nil)

    with patch("surveillance.smn_status", return_value={"ok": False, "mode": "off", "reason": "off"}), patch(
        "surveillance.fetch_argentina_metars", return_value=[]
    ), patch("surveillance.fetch_argentina_specis", return_value=[]), patch(
        "surveillance.fetch_argentina_synops",
        return_value=[Fake("87582", "2026-08-12T11:00:00Z", nil=True)],
    ), patch("surveillance.resolve_synop_hour", return_value=None):
        out = build_surveillance(stations={"87582": STATIONS["87582"]}, airports=AIRPORTS)

    assert out["count"] == 0
    assert out["stations"] == []


def test_cascade_smn_speci_then_metar():
    only = {"87582": STATIONS["87582"]}
    with patch(
        "surveillance.smn_status", return_value={"ok": True, "mode": "on", "reason": "forced"}
    ), patch("surveillance.fetch_smn_messages") as smn, patch(
        "surveillance.fetch_argentina_metars"
    ) as aw_m, patch("surveillance.fetch_argentina_specis"), patch(
        "surveillance.fetch_argentina_synops"
    ):

        def _smn(kind, *_a, **_k):
            if kind == "speci":
                return [_metar("SABE", "87582", "2026-08-12T11:20:00Z", speci=True)]
            if kind == "metar":
                return [_metar("SABE", "87582", "2026-08-12T11:00:00Z")]
            return []

        smn.side_effect = _smn
        out = build_surveillance(stations=only, airports=AIRPORTS)

    by = {p["omm"]: p for p in out["stations"]}
    assert by["87582"]["product"] == "SPECI"
    assert out["contingency_only"] is False
    assert out["missing_after_smn"] == 0
    aw_m.assert_not_called()
    assert is_speci_active_vs_metar(
        {"obs_iso": "2026-08-12T11:20:00Z"}, {"obs_iso": "2026-08-12T11:00:00Z"}
    )


if __name__ == "__main__":
    test_barb_key_and_metar_parser_wind_barb()
    test_contingency_skips_smn_when_unavailable()
    test_nil_synop_hidden()
    test_cascade_smn_speci_then_metar()
    print("ok")
