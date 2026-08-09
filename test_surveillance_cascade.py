"""Tests cascade vigilancia: SMN SPECI→METAR→SYNOP → AW → OGIMET."""

from __future__ import annotations

from unittest.mock import patch

from surveillance import build_surveillance, is_speci_active_vs_metar


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
}


def _metar(icao, wmo, obs_iso, *, speci=False, source="SMN"):
    return {
        "icao": icao,
        "wmo": wmo,
        "omm": wmo,
        "obs_iso": obs_iso,
        "hour_key": obs_iso[0:4] + obs_iso[5:7] + obs_iso[8:10] + obs_iso[11:13],
        "raw": f"{'SPECI' if speci else 'METAR'} {icao} …=",
        "is_speci": speci,
        "visibility_m": 9999,
        "flt_cat": "VFR",
        "source": source,
        "clouds": [],
    }


def _synop(omm, obs_iso, *, source="SMN"):
    return {
        "omm": omm,
        "obs_iso": obs_iso,
        "hour_key": obs_iso[0:4] + obs_iso[5:7] + obs_iso[8:10] + obs_iso[11:13],
        "raw": f"AAXX … {omm}=",
        "source": source,
        "visibility_m": 20000,
        "cloud_layers": [],
    }


def test_cascade_smn_speci_over_metar():
    smn_speci = [_metar("SABE", "87582", "2026-08-09T19:20:00Z", speci=True)]
    smn_metar = [_metar("SABE", "87582", "2026-08-09T19:00:00Z")]
    only = {"87582": STATIONS["87582"]}

    with patch("surveillance.fetch_smn_messages") as smn, patch(
        "surveillance.fetch_argentina_metars"
    ) as aw_m, patch("surveillance.fetch_argentina_specis") as aw_s, patch(
        "surveillance.fetch_argentina_synops"
    ) as og:

        def _smn(kind, *_a, **_k):
            if kind == "speci":
                return smn_speci
            if kind == "metar":
                return smn_metar
            return []

        smn.side_effect = _smn
        out = build_surveillance(stations=only, airports=AIRPORTS)

    by = {p["omm"]: p for p in out["stations"]}
    assert by["87582"]["product"] == "SPECI"
    assert by["87582"]["source"] == "SMN"
    assert out["filled_by"]["SMN"] == 1
    assert out["missing_after_smn"] == 0
    aw_m.assert_not_called()
    aw_s.assert_not_called()
    og.assert_not_called()


def test_cascade_smn_metar_when_speci_expired():
    smn_speci = [_metar("SABE", "87582", "2026-08-09T18:40:00Z", speci=True)]
    smn_metar = [_metar("SABE", "87582", "2026-08-09T19:00:00Z")]
    only = {"87582": STATIONS["87582"]}

    with patch("surveillance.fetch_smn_messages") as smn, patch(
        "surveillance.fetch_argentina_metars"
    ), patch("surveillance.fetch_argentina_specis"), patch(
        "surveillance.fetch_argentina_synops"
    ):

        def _smn(kind, *_a, **_k):
            if kind == "speci":
                return smn_speci
            if kind == "metar":
                return smn_metar
            return []

        smn.side_effect = _smn
        out = build_surveillance(stations=only, airports=AIRPORTS)

    by = {p["omm"]: p for p in out["stations"]}
    assert by["87582"]["product"] == "METAR"
    assert is_speci_active_vs_metar(smn_speci[0], smn_metar[0]) is False


def test_cascade_smn_synop_then_aw_then_ogimet():
    """87582 SMN SYNOP; 87642 solo AW; 87047 solo OGIMET."""

    class FakeSynop:
        def __init__(self, omm, obs_iso):
            self.omm = omm
            self.obs_iso = obs_iso
            self.raw = f"AAXX {omm}"

        def to_dict(self):
            return _synop(self.omm, self.obs_iso, source="OGIMET")

    with patch("surveillance.fetch_smn_messages") as smn, patch(
        "surveillance.fetch_argentina_metars"
    ) as aw_m, patch("surveillance.fetch_argentina_specis") as aw_s, patch(
        "surveillance.fetch_argentina_synops"
    ) as og, patch("surveillance.resolve_synop_hour", return_value=None):

        def _smn(kind, *_a, **_k):
            if kind == "synop":
                return [_synop("87582", "2026-08-09T18:00:00Z")]
            return []

        smn.side_effect = _smn
        aw_m.return_value = [
            _metar("SAZA", "87642", "2026-08-09T19:00:00Z", source="AviationWeather")
        ]
        aw_s.return_value = []
        og.return_value = [FakeSynop("87047", "2026-08-09T15:00:00Z")]

        out = build_surveillance(stations=STATIONS, airports=AIRPORTS)

    by = {p["omm"]: p for p in out["stations"]}
    assert by["87582"]["product"] == "SYNOP"
    assert by["87582"]["source"] == "SMN"
    assert by["87642"]["product"] == "METAR"
    assert by["87642"]["source"] == "AviationWeather"
    assert by["87047"]["product"] == "SYNOP"
    assert by["87047"]["source"] == "OGIMET"
    assert out["filled_by"]["SMN"] == 1
    assert out["filled_by"]["AviationWeather"] == 1
    assert out["filled_by"]["OGIMET"] == 1
    assert out["missing_after_smn"] == 2


if __name__ == "__main__":
    test_cascade_smn_speci_over_metar()
    test_cascade_smn_metar_when_speci_expired()
    test_cascade_smn_synop_then_aw_then_ogimet()
    print("ok")
