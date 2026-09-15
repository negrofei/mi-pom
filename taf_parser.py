"""
Parseador liviano de TAF (texto crudo) para vigilancia de enmiendas.

Extrae períodos BASE / FM / BECMG / TEMPO / PROB con viento, vis, nubes y wx.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

_RE_HEADER = re.compile(
    r"\bTAF(?:\s+(?:AMD|COR))?\s+(?P<icao>[A-Z]{4})\s+(?P<issue>\d{6})Z"
    r"(?:\s+(?P<valid>\d{4}/\d{4}))?",
    re.I,
)
_RE_VALID_ALT = re.compile(r"\b(?P<from>\d{4})/(?P<to>\d{4})\b")
_RE_FM = re.compile(r"\bFM(?P<dh>\d{6})\b", re.I)
_RE_BECMG = re.compile(r"\bBECMG\s+(?P<a>\d{4})/(?P<b>\d{4})\b", re.I)
_RE_TEMPO = re.compile(r"\bTEMPO\s+(?P<a>\d{4})/(?P<b>\d{4})\b", re.I)
_RE_PROB = re.compile(r"\bPROB(?P<p>\d{2})\s+(?:TEMPO\s+)?(?P<a>\d{4})/(?P<b>\d{4})\b", re.I)

_RE_WIND = re.compile(
    r"\b(?P<dir>\d{3}|VRB)(?P<spd>\d{2,3})(?:G(?P<gust>\d{2,3}))?KT\b", re.I
)
_RE_VIS = re.compile(r"\b(?P<vis>\d{4})\b")
_RE_CAVOK = re.compile(r"\bCAVOK\b", re.I)
_RE_NSC = re.compile(r"\b(?:NSC|NCD|SKC|CLR)\b", re.I)
_RE_CLOUD = re.compile(
    r"\b(?P<cover>FEW|SCT|BKN|OVC|VV)(?P<base>\d{3})?(?P<conv>CB|TCU)?\b", re.I
)
_RE_WX = re.compile(
    r"(?<![A-Z0-9])(?:\+|-|VC)?"
    r"(?:MI|PR|BC|DR|BL|SH|TS|FZ)?"
    r"(?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+"
    r"(?![A-Z0-9])",
    re.I,
)


@dataclass
class TafPeriod:
    kind: str  # BASE | FM | BECMG | TEMPO | PROB
    start: datetime
    end: datetime
    raw: str = ""
    probability: Optional[int] = None
    wind_dir: Optional[int] = None
    wind_variable: bool = False
    wind_speed_kt: Optional[int] = None
    wind_gust_kt: Optional[int] = None
    visibility_m: Optional[int] = None
    cavok: bool = False
    nsc: bool = False
    clouds: list[dict[str, Any]] = field(default_factory=list)
    ceiling_ft: Optional[int] = None
    wx_tokens: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "start_iso": self.start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end_iso": self.end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "raw": self.raw,
            "probability": self.probability,
            "wind_dir": self.wind_dir,
            "wind_variable": self.wind_variable,
            "wind_speed_kt": self.wind_speed_kt,
            "wind_gust_kt": self.wind_gust_kt,
            "visibility_m": self.visibility_m,
            "cavok": self.cavok,
            "nsc": self.nsc,
            "clouds": self.clouds,
            "ceiling_ft": self.ceiling_ft,
            "wx_tokens": self.wx_tokens,
        }


@dataclass
class ParsedTaf:
    icao: str
    issue: datetime
    valid_from: datetime
    valid_to: datetime
    raw: str
    periods: list[TafPeriod] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "icao": self.icao,
            "issue_iso": self.issue.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "valid_from_iso": self.valid_from.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "valid_to_iso": self.valid_to.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "raw": self.raw,
            "periods": [p.to_dict() for p in self.periods],
        }


def _parse_ddhhmm(token: str, *, now: datetime, issue: Optional[datetime] = None) -> datetime:
    day = int(token[0:2])
    hour = int(token[2:4])
    minute = int(token[4:6]) if len(token) >= 6 else 0
    base = issue or now
    year, month = base.year, base.month
    try:
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    except ValueError:
        if month == 1:
            year, month = year - 1, 12
        else:
            month -= 1
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    # Si queda muy en el pasado respecto del issue, avanzar un mes
    ref = issue or now
    if dt < ref - timedelta(days=20):
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
        dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    return dt


def _parse_ddhh_pair(
    a: str, b: str, *, issue: datetime, valid_from: datetime, valid_to: datetime
) -> tuple[datetime, datetime]:
    """Grupos ddhh/ddhh relativos a la validez del TAF."""
    start = _parse_ddhhmm(a + "00", now=valid_from, issue=issue)
    end = _parse_ddhhmm(b + "00", now=valid_from, issue=issue)
    if end <= start:
        end = end + timedelta(days=1)
    # Acotar a validez
    if start < valid_from - timedelta(hours=12):
        start = start + timedelta(days=1)
    if end < start:
        end = end + timedelta(days=1)
    if end > valid_to + timedelta(hours=12):
        # 24h wrap already handled
        pass
    return start, min(end, valid_to) if end > valid_to else end


def _ceiling_from_clouds(clouds: list[dict[str, Any]]) -> Optional[int]:
    bases = [
        int(c["base"])
        for c in clouds
        if c.get("base") is not None and str(c.get("cover", "")).upper() in ("BKN", "OVC", "VV")
    ]
    return min(bases) if bases else None


_RE_CHANGE_PREFIX = re.compile(
    r"^(?:FM\d{6}|(?:BECMG|TEMPO)\s+\d{4}/\d{4}|PROB\d{2}\s+(?:TEMPO\s+)?\d{4}/\d{4})\s*",
    re.I,
)


def _strip_change_prefix(text: str) -> str:
    """Quita FM/BECMG/TEMPO/PROB + ventana horaria para no confundir con vis."""
    return _RE_CHANGE_PREFIX.sub("", text.strip())


def _fill_weather(period: TafPeriod, text: str) -> None:
    # Evitar que ddhh/ddhh (p.ej. TEMPO 1220/1302) se interprete como visibilidad
    body = _strip_change_prefix(text)

    if _RE_CAVOK.search(body):
        period.cavok = True
        period.visibility_m = 10000
        period.nsc = True
        period.clouds = []
        period.ceiling_ft = None
    if _RE_NSC.search(body):
        period.nsc = True

    wind = _RE_WIND.search(body)
    if wind:
        d = wind.group("dir").upper()
        period.wind_variable = d == "VRB"
        period.wind_dir = None if period.wind_variable else int(d)
        period.wind_speed_kt = int(wind.group("spd"))
        if wind.group("gust"):
            period.wind_gust_kt = int(wind.group("gust"))

    if not period.cavok:
        # Vis: primer grupo 4 dígitos después del viento (evitar fechas)
        search_from = wind.end() if wind else 0
        vm = _RE_VIS.search(body[search_from:])
        if vm:
            period.visibility_m = int(vm.group("vis"))

    clouds: list[dict[str, Any]] = []
    for cm in _RE_CLOUD.finditer(body):
        cover = cm.group("cover").upper()
        base = int(cm.group("base")) * 100 if cm.group("base") else None
        item: dict[str, Any] = {"cover": cover, "base": base}
        if cm.group("conv"):
            item["type"] = cm.group("conv").upper()
            item["convective"] = item["type"]
        clouds.append(item)
    if clouds:
        period.clouds = clouds
        period.ceiling_ft = _ceiling_from_clouds(clouds)
        period.nsc = False

    wx = [m.group(0).upper() for m in _RE_WX.finditer(body)]
    # Filtrar falsos positivos tipo FM/BECMG tokens ya consumidos
    period.wx_tokens = [w for w in wx if w not in ("NSW",)]


def _split_change_groups(body: str) -> list[tuple[str, str, dict[str, str]]]:
    """
    Devuelve lista (kind, chunk_text, match_groups) en orden.
    kind: FM | BECMG | TEMPO | PROB
    """
    markers: list[tuple[int, str, dict[str, str], int]] = []
    for m in _RE_FM.finditer(body):
        markers.append((m.start(), "FM", {"dh": m.group("dh")}, m.end()))
    for m in _RE_BECMG.finditer(body):
        markers.append((m.start(), "BECMG", {"a": m.group("a"), "b": m.group("b")}, m.end()))
    for m in _RE_TEMPO.finditer(body):
        # Evitar TEMPO ya capturado por PROBxx TEMPO
        markers.append((m.start(), "TEMPO", {"a": m.group("a"), "b": m.group("b")}, m.end()))
    for m in _RE_PROB.finditer(body):
        markers.append(
            (
                m.start(),
                "PROB",
                {"p": m.group("p"), "a": m.group("a"), "b": m.group("b")},
                m.end(),
            )
        )
    markers.sort(key=lambda x: x[0])

    # Deduplicar TEMPO solapado con PROB TEMPO (mismo start)
    cleaned: list[tuple[int, str, dict[str, str], int]] = []
    for mk in markers:
        if cleaned and mk[0] == cleaned[-1][0]:
            # Preferir PROB sobre TEMPO en el mismo offset
            if mk[1] == "PROB":
                cleaned[-1] = mk
            continue
        if (
            cleaned
            and cleaned[-1][1] == "PROB"
            and mk[1] == "TEMPO"
            and mk[0] < cleaned[-1][3] + 8
        ):
            continue
        cleaned.append(mk)

    out: list[tuple[str, str, dict[str, str]]] = []
    for i, (start, kind, groups, _end) in enumerate(cleaned):
        stop = cleaned[i + 1][0] if i + 1 < len(cleaned) else len(body)
        out.append((kind, body[start:stop].strip(), groups))
    return out


def parse_taf_raw(
    raw: str,
    *,
    now: Optional[datetime] = None,
) -> Optional[ParsedTaf]:
    if not raw or not str(raw).strip():
        return None
    now = now or datetime.now(timezone.utc)
    text = " ".join(str(raw).replace("\n", " ").replace("=", " ").split())
    header = _RE_HEADER.search(text)
    if not header:
        return None
    icao = header.group("icao").upper()
    issue = _parse_ddhhmm(header.group("issue"), now=now)
    valid_tok = header.group("valid")
    if not valid_tok:
        m = _RE_VALID_ALT.search(text[header.end() : header.end() + 20])
        if not m:
            return None
        valid_tok = f"{m.group('from')}/{m.group('to')}"
    vf, vt = valid_tok.split("/")
    valid_from = _parse_ddhhmm(vf + "00", now=now, issue=issue)
    valid_to = _parse_ddhhmm(vt + "00", now=now, issue=issue)
    if valid_to <= valid_from:
        valid_to += timedelta(days=1)

    body = text[header.end() :].strip()
    # Quitar el grupo de validez suelto al inicio si quedó
    body = re.sub(r"^\d{4}/\d{4}\s+", "", body)

    changes = _split_change_groups(body)
    first_change_at = changes[0][1] and body.find(changes[0][1][:8]) if changes else -1
    # Mejor: posición del primer marker
    if changes:
        # recompute first marker position
        first_pos = len(body)
        for kind, chunk, _g in changes:
            idx = body.find(chunk[: min(12, len(chunk))])
            if idx >= 0:
                first_pos = min(first_pos, idx)
        base_text = body[:first_pos].strip() if first_pos < len(body) else body
    else:
        base_text = body

    periods: list[TafPeriod] = []
    base = TafPeriod(kind="BASE", start=valid_from, end=valid_to, raw=base_text)
    _fill_weather(base, base_text)
    periods.append(base)

    for kind, chunk, groups in changes:
        if kind == "FM":
            start = _parse_ddhhmm(groups["dh"], now=valid_from, issue=issue)
            end = valid_to
            p = TafPeriod(kind="FM", start=start, end=end, raw=chunk)
        elif kind == "BECMG":
            start, end = _parse_ddhh_pair(
                groups["a"], groups["b"], issue=issue, valid_from=valid_from, valid_to=valid_to
            )
            p = TafPeriod(kind="BECMG", start=start, end=end, raw=chunk)
        elif kind == "TEMPO":
            start, end = _parse_ddhh_pair(
                groups["a"], groups["b"], issue=issue, valid_from=valid_from, valid_to=valid_to
            )
            p = TafPeriod(kind="TEMPO", start=start, end=end, raw=chunk)
        else:  # PROB
            start, end = _parse_ddhh_pair(
                groups["a"], groups["b"], issue=issue, valid_from=valid_from, valid_to=valid_to
            )
            p = TafPeriod(
                kind="PROB",
                start=start,
                end=end,
                raw=chunk,
                probability=int(groups["p"]),
            )
        _fill_weather(p, chunk)
        periods.append(p)

    return ParsedTaf(
        icao=icao,
        issue=issue,
        valid_from=valid_from,
        valid_to=valid_to,
        raw=text if text.endswith("=") else text + "=",
        periods=periods,
    )


def prevailing_conditions(taf: ParsedTaf, when: datetime) -> Optional[TafPeriod]:
    """
    Condiciones prevalecientes en `when`: BASE + FM posteriores + BECMG ya cumplidos
    (toma el estado al final del BECMG).
    """
    if when < taf.valid_from or when >= taf.valid_to:
        # tolerancia: si está dentro de ±1h de validez, igual evaluar
        if when < taf.valid_from - timedelta(hours=1) or when > taf.valid_to + timedelta(hours=1):
            return None

    base = next((p for p in taf.periods if p.kind == "BASE"), None)
    if not base:
        return None

    # Copiar estado base
    state = TafPeriod(
        kind="PREVAILING",
        start=base.start,
        end=base.end,
        raw=base.raw,
        wind_dir=base.wind_dir,
        wind_variable=base.wind_variable,
        wind_speed_kt=base.wind_speed_kt,
        wind_gust_kt=base.wind_gust_kt,
        visibility_m=base.visibility_m,
        cavok=base.cavok,
        nsc=base.nsc,
        clouds=list(base.clouds),
        ceiling_ft=base.ceiling_ft,
        wx_tokens=list(base.wx_tokens),
    )

    def _apply(src: TafPeriod) -> None:
        if src.wind_speed_kt is not None or src.wind_dir is not None or src.wind_variable:
            state.wind_dir = src.wind_dir
            state.wind_variable = src.wind_variable
            state.wind_speed_kt = src.wind_speed_kt
            state.wind_gust_kt = src.wind_gust_kt
        if src.visibility_m is not None or src.cavok:
            state.visibility_m = src.visibility_m
            state.cavok = src.cavok
        if src.clouds or src.nsc or src.cavok:
            state.clouds = list(src.clouds)
            state.ceiling_ft = src.ceiling_ft
            state.nsc = src.nsc or src.cavok
            if src.cavok:
                state.clouds = []
                state.ceiling_ft = None
        if src.wx_tokens or "NSW" in src.raw.upper():
            if "NSW" in src.raw.upper():
                state.wx_tokens = []
            else:
                state.wx_tokens = list(src.wx_tokens)

    for p in taf.periods:
        if p.kind == "FM" and p.start <= when:
            _apply(p)
        elif p.kind == "BECMG" and p.end <= when:
            # BECMG completo: condiciones finales
            _apply(p)
        elif p.kind == "BECMG" and p.start <= when < p.end:
            # Durante BECMG: aplicar ya las condiciones nuevas (conservador para enmienda)
            _apply(p)

    return state


def tempo_conditions(taf: ParsedTaf, when: datetime) -> list[TafPeriod]:
    """TEMPO/PROB TEMPO vigentes en `when`."""
    out: list[TafPeriod] = []
    for p in taf.periods:
        if p.kind not in ("TEMPO", "PROB"):
            continue
        if p.start <= when < p.end:
            out.append(p)
    return out
