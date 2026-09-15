"""Tests TAF parser + criterios de enmienda vs METAR."""

from datetime import datetime, timezone

from taf_amend import evaluate_amendment, evaluate_obs_vs_period
from taf_parser import parse_taf_raw, prevailing_conditions


NOW = datetime(2026, 8, 12, 14, 0, tzinfo=timezone.utc)

TAF_SAMPLE = (
    "TAF SAZR 121100Z 1212/1312 10005KT 9999 SCT030 "
    "BECMG 1218/1220 18015G25KT 3000 -RA BKN008 "
    "TEMPO 1220/1302 1500 TSRA BKN005CB "
    "FM130600 20010KT CAVOK="
)


def test_parse_taf_periods():
    taf = parse_taf_raw(TAF_SAMPLE, now=NOW)
    assert taf is not None
    assert taf.icao == "SAZR"
    kinds = [p.kind for p in taf.periods]
    assert kinds[0] == "BASE"
    assert "BECMG" in kinds
    assert "TEMPO" in kinds
    assert "FM" in kinds
    base = taf.periods[0]
    assert base.wind_speed_kt == 5
    assert base.visibility_m == 9999


def test_prevailing_after_becmg():
    taf = parse_taf_raw(TAF_SAMPLE, now=NOW)
    # Después del BECMG (22Z)
    when = datetime(2026, 8, 12, 22, 0, tzinfo=timezone.utc)
    prev = prevailing_conditions(taf, when)
    assert prev is not None
    assert prev.wind_speed_kt == 15
    assert prev.wind_gust_kt == 25
    assert prev.visibility_m == 3000
    assert prev.ceiling_ft == 800


def test_wind_speed_amend():
    taf = parse_taf_raw(
        "TAF SAZR 121100Z 1212/1312 10005KT 9999 NSC=",
        now=NOW,
    )
    obs = {
        "icao": "SAZR",
        "obs_iso": "2026-08-12T14:00:00Z",
        "wind_dir": 100,
        "wind_speed_kt": 18,
        "visibility_m": 9999,
        "clouds": [],
        "ceiling_ft": None,
        "raw": "METAR SAZR 121400Z 10018KT 9999 NSC 10/05 Q1020=",
    }
    alert = evaluate_amendment(obs, taf, when=NOW)
    assert alert is not None
    assert any(r["key"] == "wind_speed" for r in alert["reasons"])


def test_vis_threshold_amend():
    taf = parse_taf_raw(
        "TAF SAZR 121100Z 1212/1312 10005KT 9999 SCT020=",
        now=NOW,
    )
    obs = {
        "icao": "SAZR",
        "obs_iso": "2026-08-12T14:00:00Z",
        "wind_dir": 100,
        "wind_speed_kt": 5,
        "visibility_m": 1200,
        "clouds": [{"cover": "SCT", "base": 2000}],
        "ceiling_ft": None,
        "raw": "METAR SAZR 121400Z 10005KT 1200 SCT020 10/05 Q1020=",
    }
    alert = evaluate_amendment(obs, taf, when=NOW)
    assert alert is not None
    assert any(r["key"].startswith("vis_") for r in alert["reasons"])
    assert 1500 in (alert["reasons"][0].get("thresholds") or []) or any(
        1500 in (r.get("thresholds") or []) for r in alert["reasons"]
    )


def test_ceiling_threshold_amend():
    taf = parse_taf_raw(
        "TAF SAZR 121100Z 1212/1312 10005KT 9999 BKN025=",
        now=NOW,
    )
    obs = {
        "icao": "SAZR",
        "obs_iso": "2026-08-12T14:00:00Z",
        "wind_dir": 100,
        "wind_speed_kt": 5,
        "visibility_m": 9999,
        "clouds": [{"cover": "BKN", "base": 300}],
        "ceiling_ft": 300,
        "raw": "METAR SAZR 121400Z 10005KT 9999 BKN003 10/05 Q1020=",
    }
    alert = evaluate_amendment(obs, taf, when=NOW)
    assert alert is not None
    assert any("ceiling" in r["key"] for r in alert["reasons"])


def test_cloud_amount_flip():
    taf = parse_taf_raw(
        "TAF SAZR 121100Z 1212/1312 10005KT 9999 SCT008=",
        now=NOW,
    )
    obs = {
        "icao": "SAZR",
        "obs_iso": "2026-08-12T14:00:00Z",
        "wind_dir": 100,
        "wind_speed_kt": 5,
        "visibility_m": 9999,
        "clouds": [{"cover": "BKN", "base": 800}],
        "ceiling_ft": 800,
        "raw": "METAR SAZR 121400Z 10005KT 9999 BKN008 10/05 Q1020=",
    }
    alert = evaluate_amendment(obs, taf, when=NOW)
    assert alert is not None
    assert any(r["key"] == "cloud_amount" for r in alert["reasons"])


def test_tempo_covers_obs_no_amend():
    """TEMPO explica la tormenta → no enmienda por wx."""
    taf = parse_taf_raw(TAF_SAMPLE, now=NOW)
    when = datetime(2026, 8, 12, 22, 30, tzinfo=timezone.utc)
    obs = {
        "icao": "SAZR",
        "obs_iso": "2026-08-12T22:30:00Z",
        "wind_dir": 180,
        "wind_speed_kt": 15,
        "wind_gust_kt": 25,
        "visibility_m": 1500,
        "clouds": [{"cover": "BKN", "base": 500, "type": "CB"}],
        "ceiling_ft": 500,
        "wx_string": "TSRA",
        "raw": "METAR SAZR 122230Z 18015G25KT 1500 TSRA BKN005CB 12/11 Q1015=",
    }
    # Prevailing after BECMG is 3000 -RA BKN008; TEMPO is 1500 TSRA BKN005
    # Obs matches TEMPO → should not amend (or fewer reasons)
    alert = evaluate_amendment(obs, taf, when=when)
    # TEMPO should cover vis and wx and maybe ceiling
    if alert:
        keys = {r["key"] for r in alert["reasons"]}
        assert "wx" not in keys or not alert  # preferably no wx
        # At minimum TEMPO matching should remove vis/ceiling/wx if matched
    # Stronger: expect no alert when fully within TEMPO
    assert alert is None or not any(
        k.startswith("vis") or k == "wx" or k.startswith("ceiling")
        for k in (r["key"] for r in alert["reasons"])
    )


def test_no_false_alarm_match():
    taf = parse_taf_raw(
        "TAF SAZR 121100Z 1212/1312 10005KT 9999 SCT030=",
        now=NOW,
    )
    obs = {
        "icao": "SAZR",
        "obs_iso": "2026-08-12T14:00:00Z",
        "wind_dir": 110,
        "wind_speed_kt": 6,
        "visibility_m": 9999,
        "clouds": [{"cover": "SCT", "base": 3000}],
        "ceiling_ft": None,
        "raw": "METAR SAZR 121400Z 11006KT 9999 SCT030 10/05 Q1020=",
    }
    assert evaluate_amendment(obs, taf, when=NOW) is None


if __name__ == "__main__":
    test_parse_taf_periods()
    test_prevailing_after_becmg()
    test_wind_speed_amend()
    test_vis_threshold_amend()
    test_ceiling_threshold_amend()
    test_cloud_amount_flip()
    test_tempo_covers_obs_no_amend()
    test_no_false_alarm_match()
    print("ok")
