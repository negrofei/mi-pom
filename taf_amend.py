"""
Criterios de enmienda TAF vs METAR/SPECI observado.

Si la observación difiere del TAF vigente (condiciones prevalecientes,
considerando TEMPO como envelope permitido) por encima de los umbrales
de enmienda, se genera una alerta de monitoreo.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from taf_parser import (
    ParsedTaf,
    TafPeriod,
    parse_taf_raw,
    prevailing_conditions,
    tempo_conditions,
)

VIS_THRESHOLDS_M = (150, 350, 600, 800, 1500, 3000)
CEILING_THRESHOLDS_FT = (100, 200, 500, 1000)
LOW_CLOUD_FT = 1500

# Fenómenos que disparan enmienda al empezar/terminar/cambiar intensidad
_SIGNIFICANT_WX = {
    "FZFG",
    "FZDZ",
    "FZRA",
    "FZUP",
    "TS",
    "TSRA",
    "TSSN",
    "TSGR",
    "TSGS",
    "DS",
    "SS",
    "PO",
}


def _dir_diff(a: Optional[int], b: Optional[int]) -> Optional[int]:
    if a is None or b is None:
        return None
    d = abs(int(a) - int(b)) % 360
    return min(d, 360 - d)


def _crossed_thresholds(a: Optional[int], b: Optional[int], thresholds: tuple[int, ...]) -> list[int]:
    """Umbrales estrictamente entre a y b (sin importar el orden)."""
    if a is None or b is None or a == b:
        return []
    lo, hi = (a, b) if a < b else (b, a)
    return [t for t in thresholds if lo < t <= hi or lo <= t < hi]


def _crossed_vis(fcst: Optional[int], obs: Optional[int]) -> tuple[list[int], Optional[str]]:
    if fcst is None or obs is None or fcst == obs:
        return [], None
    crossed = _crossed_thresholds(fcst, obs, VIS_THRESHOLDS_M)
    # También: si pasan exactamente por un valor umbral al cambiar
    for t in VIS_THRESHOLDS_M:
        if (fcst < t <= obs) or (obs < t <= fcst) or (fcst > t >= obs) or (obs > t >= fcst):
            if t not in crossed:
                # simplificar: umbral está entre los dos valores
                if min(fcst, obs) < t < max(fcst, obs) or min(fcst, obs) <= t <= max(fcst, obs):
                    if t not in crossed and (
                        (fcst < t and obs >= t)
                        or (obs < t and fcst >= t)
                        or (fcst > t and obs <= t)
                        or (obs > t and fcst <= t)
                    ):
                        crossed.append(t)
    crossed = sorted(set(t for t in VIS_THRESHOLDS_M if min(fcst, obs) < t <= max(fcst, obs) or min(fcst, obs) <= t < max(fcst, obs)))
    # Más limpio:
    crossed = sorted(
        {
            t
            for t in VIS_THRESHOLDS_M
            if (fcst - t) * (obs - t) < 0 or (fcst != obs and (fcst == t or obs == t))
        }
    )
    if not crossed:
        return [], None
    direction = "mejora" if obs > fcst else "deteriora"
    return crossed, direction


def _crossed_ceiling(fcst: Optional[int], obs: Optional[int]) -> tuple[list[int], Optional[str]]:
    if fcst is None and obs is None:
        return [], None
    # Sin techo se trata como "muy alto" para cruce al aparecer/desaparecer BKN/OVC
    f = fcst if fcst is not None else 99999
    o = obs if obs is not None else 99999
    if f == o:
        return [], None
    crossed = sorted(
        {
            t
            for t in CEILING_THRESHOLDS_FT
            if (f - t) * (o - t) < 0 or (f != o and (f == t or o == t))
        }
    )
    if not crossed:
        return [], None
    direction = "levanta" if o > f else "desciende"
    return crossed, direction


def _cover_bucket(clouds: list[dict], *, nsc: bool = False, cavok: bool = False) -> str:
    """Por debajo de 1500 ft: 'few' (NSC/FEW/SCT) o 'bkn' (BKN/OVC).

    Solo cuentan capas con base conocida < 1500 ft. BKN/OVC altos (p.ej. BKN100)
    no disparan el criterio de cantidad bajo 1500 ft.
    """
    if cavok or nsc:
        return "few"
    low = [
        str(c.get("cover") or "").upper()
        for c in (clouds or [])
        if c.get("base") is not None and int(c["base"]) < LOW_CLOUD_FT
    ]
    if any(c in ("BKN", "OVC", "VV", "OVX") for c in low):
        return "bkn"
    if any(c in ("FEW", "SCT") for c in low):
        return "few"
    return "few"  # sin nubes bajas ≈ NSC


def _obs_cover_bucket(obs: dict) -> str:
    raw = str(obs.get("raw") or "").upper()
    cavok = "CAVOK" in raw
    nsc = any(tok in raw for tok in (" NSC", " NCD", " SKC", " CLR"))
    clouds = obs.get("clouds") or []
    # cloud_bases from front-normalized may not be present; use clouds
    return _cover_bucket(clouds, nsc=nsc, cavok=cavok)


def _wx_significant_set(tokens: list[str] | None, raw: str | None = None) -> set[str]:
    out: set[str] = set()
    blob = " ".join(tokens or [])
    if raw:
        blob = f"{blob} {raw}"
    blob = blob.upper()

    # Congelante
    if "FZFG" in blob or "FZ FG" in blob:
        out.add("FZFG")
    for tok in ("FZRA", "FZDZ", "FZUP"):
        if tok in blob:
            out.add(tok)

    # Tormenta
    if re_search_ts(blob):
        out.add("TS")

    # Tempestad polvo/arena
    if re_search_word(blob, "DS"):
        out.add("DS")
    if re_search_word(blob, "SS"):
        out.add("SS")

    # Precipitación moderada o fuerte (sin '-' leve)
    if _has_mod_heavy_precip(blob):
        out.add("MOD_HEAVY_PRECIP")

    return out


def re_search_ts(blob: str) -> bool:
    import re

    return bool(re.search(r"(?<![A-Z])(?:\+|-|VC)?TS(?:RA|SN|GR|GS|PL)?(?![A-Z])", blob))


def re_search_word(blob: str, word: str) -> bool:
    import re

    return bool(re.search(rf"(?<![A-Z]){word}(?![A-Z])", blob))


def _has_mod_heavy_precip(blob: str) -> bool:
    """Precipitación moderada (+) o fuerte, o chubascos SH* sin '-'."""
    import re

    # Intensidad explícita fuerte
    if re.search(r"\+(?:SH)?(?:DZ|RA|SN|SG|PL|GR|GS|UP)", blob):
        return True
    # Moderada: sin '-' delante del grupo de precip (excluye -RA)
    # Incluye SHRA, TSRA (TS ya se marca aparte), RA, SN, etc.
    for m in re.finditer(
        r"(?<![A-Z0-9])(?P<sig>\+|-|VC)?(?P<body>(?:MI|PR|BC|DR|BL|SH|TS|FZ)?"
        r"(?:DZ|RA|SN|SG|PL|GR|GS|UP)+)(?![A-Z0-9])",
        blob,
    ):
        sig = m.group("sig") or ""
        body = m.group("body") or ""
        if sig == "-":
            continue
        # TS* ya contado; precip moderada/fuerte o chubasco
        if "SH" in body or sig == "+" or body.endswith(
            ("DZ", "RA", "SN", "SG", "PL", "GR", "GS", "UP")
        ):
            # Moderada (sin signo) de precip: sí
            if "TS" in body and "SH" not in body and sig != "+":
                continue  # solo TS sin precip extra ya está en TS
            return True
    return False


def _obs_wx_set(obs: dict) -> set[str]:
    tokens = []
    if obs.get("wx_string"):
        tokens.append(str(obs["wx_string"]))
    if obs.get("wx_tokens"):
        tokens.extend(obs["wx_tokens"])
    return _wx_significant_set(tokens, str(obs.get("raw") or ""))


def _fcst_wx_set(period: TafPeriod) -> set[str]:
    return _wx_significant_set(period.wx_tokens, period.raw)


def _period_as_obs_like(p: TafPeriod) -> dict[str, Any]:
    return {
        "wind_dir": p.wind_dir,
        "wind_speed_kt": p.wind_speed_kt,
        "wind_gust_kt": p.wind_gust_kt,
        "visibility_m": p.visibility_m,
        "clouds": p.clouds,
        "ceiling_ft": p.ceiling_ft,
        "raw": p.raw,
        "wx_tokens": p.wx_tokens,
        "nsc": p.nsc,
        "cavok": p.cavok,
    }


def _matches_tempo(obs: dict, tempo: TafPeriod, reason_key: str) -> bool:
    """Si el TEMPO 'explica' la observación para ese criterio, no enmendar."""
    t = _period_as_obs_like(tempo)
    if reason_key.startswith("wind_dir"):
        if obs.get("wind_dir") is None or t.get("wind_dir") is None:
            return False
        return (_dir_diff(obs.get("wind_dir"), t.get("wind_dir")) or 999) < 60
    if reason_key.startswith("wind_speed"):
        if obs.get("wind_speed_kt") is None or t.get("wind_speed_kt") is None:
            return False
        return abs(int(obs["wind_speed_kt"]) - int(t["wind_speed_kt"])) < 10
    if reason_key.startswith("wind_gust"):
        og = obs.get("wind_gust_kt")
        tg = t.get("wind_gust_kt")
        if og is None and tg is None:
            return True
        if og is None or tg is None:
            return False
        return abs(int(og) - int(tg)) < 10
    if reason_key.startswith("vis"):
        if obs.get("visibility_m") is None or t.get("visibility_m") is None:
            return False
        crossed, _ = _crossed_vis(t.get("visibility_m"), obs.get("visibility_m"))
        return not crossed
    if reason_key.startswith("ceiling"):
        crossed, _ = _crossed_ceiling(t.get("ceiling_ft"), obs.get("ceiling_ft"))
        return not crossed
    if reason_key.startswith("cloud_amount"):
        return _cover_bucket(t.get("clouds") or [], nsc=bool(t.get("nsc")), cavok=bool(t.get("cavok"))) == _obs_cover_bucket(obs)
    if reason_key.startswith("wx"):
        return _obs_wx_set(obs) == _fcst_wx_set(tempo) or _obs_wx_set(obs).issubset(_fcst_wx_set(tempo))
    return False


def evaluate_obs_vs_period(obs: dict, fcst: TafPeriod) -> list[dict[str, Any]]:
    """Compara observación vs un período de pronóstico; lista de motivos de enmienda."""
    reasons: list[dict[str, Any]] = []

    # Viento dirección ≥60° con media ≥10 kt
    dd = _dir_diff(obs.get("wind_dir"), fcst.wind_dir)
    obs_spd = obs.get("wind_speed_kt")
    fcst_spd = fcst.wind_speed_kt
    if (
        dd is not None
        and dd >= 60
        and (
            (obs_spd is not None and obs_spd >= 10)
            or (fcst_spd is not None and fcst_spd >= 10)
        )
    ):
        reasons.append(
            {
                "key": "wind_dir",
                "label": f"Dirección viento Δ{dd}° (≥60°) con media ≥10 kt",
                "obs": obs.get("wind_dir"),
                "fcst": fcst.wind_dir,
            }
        )

    # Velocidad media Δ≥10 kt
    if obs_spd is not None and fcst_spd is not None and abs(int(obs_spd) - int(fcst_spd)) >= 10:
        reasons.append(
            {
                "key": "wind_speed",
                "label": f"Velocidad media Δ{abs(int(obs_spd) - int(fcst_spd))} kt (≥10 kt)",
                "obs": obs_spd,
                "fcst": fcst_spd,
            }
        )

    # Ráfagas: variación (gust-mean) o valor de ráfaga Δ≥10 con media ≥15
    obs_gust = obs.get("wind_gust_kt")
    fcst_gust = fcst.wind_gust_kt
    mean_hi = (obs_spd is not None and obs_spd >= 15) or (fcst_spd is not None and fcst_spd >= 15)
    if mean_hi:
        obs_dev = (int(obs_gust) - int(obs_spd)) if obs_gust is not None and obs_spd is not None else None
        fcst_dev = (
            (int(fcst_gust) - int(fcst_spd))
            if fcst_gust is not None and fcst_spd is not None
            else None
        )
        gust_delta = None
        if obs_gust is not None and fcst_gust is not None:
            gust_delta = abs(int(obs_gust) - int(fcst_gust))
        elif obs_dev is not None and fcst_dev is not None:
            gust_delta = abs(obs_dev - fcst_dev)
        elif (obs_gust is None) != (fcst_gust is None):
            # Aparece/desaparece ráfaga con media ≥15
            gust_delta = 10
        if gust_delta is not None and gust_delta >= 10:
            reasons.append(
                {
                    "key": "wind_gust",
                    "label": f"Ráfagas Δ≥10 kt con media ≥15 kt (obs={obs_gust}, taf={fcst_gust})",
                    "obs": obs_gust,
                    "fcst": fcst_gust,
                }
            )

    # Visibilidad
    crossed, direction = _crossed_vis(fcst.visibility_m, obs.get("visibility_m"))
    if crossed and direction:
        reasons.append(
            {
                "key": f"vis_{direction}",
                "label": f"Visibilidad se {direction} y pasa umbrales {crossed} m",
                "obs": obs.get("visibility_m"),
                "fcst": fcst.visibility_m,
                "thresholds": crossed,
            }
        )

    # Fenómenos significativos
    obs_wx = _obs_wx_set(obs)
    fcst_wx = _fcst_wx_set(fcst)
    started = obs_wx - fcst_wx
    ended = fcst_wx - obs_wx
    if started or ended:
        bits = []
        if started:
            bits.append("inicia " + ", ".join(sorted(started)))
        if ended:
            bits.append("termina " + ", ".join(sorted(ended)))
        reasons.append(
            {
                "key": "wx",
                "label": "Fenómeno significativo: " + "; ".join(bits),
                "obs": sorted(obs_wx),
                "fcst": sorted(fcst_wx),
            }
        )

    # Techo BKN/OVC
    crossed_c, dir_c = _crossed_ceiling(fcst.ceiling_ft, obs.get("ceiling_ft"))
    if crossed_c and dir_c:
        reasons.append(
            {
                "key": f"ceiling_{dir_c}",
                "label": f"Base BKN/OVC se {dir_c} y pasa umbrales {crossed_c} ft",
                "obs": obs.get("ceiling_ft"),
                "fcst": fcst.ceiling_ft,
                "thresholds": crossed_c,
            }
        )

    # Cantidad bajo 1500 ft: FEW/SCT/NSC ↔ BKN/OVC
    obs_bucket = _obs_cover_bucket(obs)
    fcst_bucket = _cover_bucket(fcst.clouds, nsc=fcst.nsc, cavok=fcst.cavok)
    if obs_bucket != fcst_bucket and {obs_bucket, fcst_bucket} == {"few", "bkn"}:
        reasons.append(
            {
                "key": "cloud_amount",
                "label": f"Cobertura <1500 ft: TAF={fcst_bucket.upper()} → OBS={obs_bucket.upper()}",
                "obs": obs_bucket,
                "fcst": fcst_bucket,
            }
        )

    return reasons


def evaluate_amendment(
    obs: dict,
    taf: ParsedTaf | str | None,
    *,
    when: Optional[datetime] = None,
) -> Optional[dict[str, Any]]:
    """
    Evalúa si el METAR/SPECI requiere enmienda del TAF.
    Devuelve dict de alerta o None.
    """
    if not obs or not taf:
        return None
    if isinstance(taf, str):
        parsed = parse_taf_raw(taf, now=when)
    else:
        parsed = taf
    if not parsed:
        return None

    when = when or datetime.now(timezone.utc)
    if obs.get("obs_iso"):
        try:
            when = datetime.fromisoformat(str(obs["obs_iso"]).replace("Z", "+00:00"))
        except ValueError:
            pass

    prev = prevailing_conditions(parsed, when)
    if not prev:
        return None

    reasons = evaluate_obs_vs_period(obs, prev)
    if not reasons:
        return None

    tempos = tempo_conditions(parsed, when)
    filtered: list[dict[str, Any]] = []
    for r in reasons:
        if any(_matches_tempo(obs, t, r["key"]) for t in tempos):
            continue
        filtered.append(r)
    if not filtered:
        return None

    return {
        "icao": obs.get("icao") or parsed.icao,
        "wmo": obs.get("wmo") or obs.get("omm"),
        "omm": obs.get("omm") or obs.get("wmo"),
        "nombre": obs.get("nombre"),
        "obs_iso": obs.get("obs_iso"),
        "obs_product": "SPECI" if obs.get("is_speci") or obs.get("product") == "SPECI" else "METAR",
        "obs_raw": obs.get("raw"),
        "taf_raw": parsed.raw,
        "taf_issue_iso": parsed.issue.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "taf_valid_from_iso": parsed.valid_from.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "taf_valid_to_iso": parsed.valid_to.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fcst_period": prev.to_dict(),
        "reasons": filtered,
        "reason_labels": [r["label"] for r in filtered],
        "needs_amend": True,
    }
