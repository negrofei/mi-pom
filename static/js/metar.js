/**
 * Pestaña METAR / aviación:
 * - Mapa: resumen operativo desde SYNOP (vis, bases, fenómenos, ráfagas)
 * - Alertas SPECI desde AviationWeather
 */
(function (global) {
  const CAT = {
    VFR: { color: "#00aa00", label: "VFR", hint: "Techo > 3000 ft y vis > 8000 m" },
    MVFR: { color: "#0066ff", label: "MVFR", hint: "Techo 1000–3000 ft o vis 5000–8000 m" },
    IFR: { color: "#ff0000", label: "IFR", hint: "Techo 500–999 ft o vis 1500–5000 m" },
    LIFR: { color: "#ff00ff", label: "LIFR", hint: "Techo < 500 ft o vis < 1500 m" },
  };

  const H_BASE_FT = {
    "0": 80,
    "1": 250,
    "2": 500,
    "3": 800,
    "4": 1500,
    "5": 2600,
    "6": 4100,
    "7": 5700,
    "8": 7400,
    "9": 8200,
  };

  const WW = () => global.PresentWeather;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function catMeta(code) {
    return CAT[code] || { color: "#888888", label: code || "—", hint: "Sin categoría" };
  }

  // Estilos de alerta METAR
  const ALERT_STYLES = {
    wind_high: { background: "#d32f2f", color: "white", label: "Viento ≥20 kt" },
    wind_mod: { background: "#ffcc80", color: "#4a2500", label: "Viento ≥15 kt" },
    cb: { background: "#ed7a18", color: "#291300", label: "CB" },
    tcu: { background: "#ffe3a3", color: "#593b00", label: "TCU" },
    wx_precip: { background: "#fff59d", color: "#5f4b00", label: "BR/DZ/RA/VCSH" },
    wx_fog: { background: "#ce93d8", color: "#3b0045", label: "FG" },
    wx_severe: { background: "#b71c1c", color: "white", label: "TS/GR/FZRA/SQ" },
  };

  function getWindAlert(obs) {
    const spd = obs.wind_speed_kt ?? obs.wind_speed;
    const gust = obs.wind_gust_kt;
    const maxWind = Math.max(spd || 0, gust || 0);
    if (maxWind >= 20) return ALERT_STYLES.wind_high;
    if (maxWind >= 15) return ALERT_STYLES.wind_mod;
    return null;
  }

  function getConvectiveAlert(obs) {
    const raw = String(obs.raw || "").toUpperCase();
    const clouds = obs.clouds || [];
    const hasCb = /\bCB\b/.test(raw) || clouds.some(c => /CB/i.test(c.type || c.convective || ""));
    const hasTcu = /\bTCU\b/.test(raw) || clouds.some(c => /TCU/i.test(c.type || c.convective || ""));
    if (hasCb) return ALERT_STYLES.cb;
    if (hasTcu) return ALERT_STYLES.tcu;
    return null;
  }

  function getWxAlert(obs) {
    const wx = String(obs.wx_string || obs.raw || "").toUpperCase();
    // Severos: TS, GR, FZRA, SQ
    if (/\bTS\b|\+TS|TSRA|TSGR/.test(wx)) return ALERT_STYLES.wx_severe;
    if (/\bGR\b|\+GR/.test(wx)) return ALERT_STYLES.wx_severe;
    if (/\bFZRA\b|\+FZRA/.test(wx)) return ALERT_STYLES.wx_severe;
    if (/\bSQ\b/.test(wx)) return ALERT_STYLES.wx_severe;
    // Niebla
    if (/\bFG\b|\+FG|BCFG|MIFG|PRFG|FZFG/.test(wx)) return ALERT_STYLES.wx_fog;
    // Precipitación/neblina
    if (/\bBR\b/.test(wx)) return ALERT_STYLES.wx_precip;
    if (/\bDZ\b|\+DZ|-DZ|FZDZ/.test(wx)) return ALERT_STYLES.wx_precip;
    if (/\bRA\b|\+RA|-RA|SHRA/.test(wx)) return ALERT_STYLES.wx_precip;
    if (/\bVCSH\b/.test(wx)) return ALERT_STYLES.wx_precip;
    return null;
  }

  function getAllAlerts(obs) {
    const alerts = [];
    const wind = getWindAlert(obs);
    const conv = getConvectiveAlert(obs);
    const wx = getWxAlert(obs);
    if (wind) alerts.push({ type: "wind", ...wind });
    if (conv) alerts.push({ type: "conv", ...conv });
    if (wx) alerts.push({ type: "wx", ...wx });
    return alerts;
  }

  function alertBadgesHtml(obs) {
    const alerts = getAllAlerts(obs);
    if (!alerts.length) return "";
    return alerts.map(a => 
      `<span class="metar-alert-badge" style="background:${a.background};color:${a.color}">${esc(a.label)}</span>`
    ).join(" ");
  }

  // Decodificación de grupos SYNOP para hover
  const SYNOP_GROUPS = {
    header: (g) => {
      if (!/^AAXX$/i.test(g)) return null;
      return "AAXX: Mensaje SYNOP terrestre";
    },
    yyggi: (g) => {
      if (!/^\d{5}$/.test(g)) return null;
      const yy = g.slice(0, 2);
      const gg = g.slice(2, 4);
      const iw = g.slice(4, 5);
      const windUnit = iw === "3" || iw === "4" ? "nudos" : "m/s";
      return `Día ${yy}, hora ${gg} UTC, viento en ${windUnit}`;
    },
    station: (g) => {
      if (!/^\d{5}$/.test(g)) return null;
      return `Estación OMM ${g}`;
    },
    irixhvv: (g) => {
      if (!/^\d{5}$/.test(g) || g[0] > "4") return null;
      const ir = g[0]; // Indicador precipitación
      const ix = g[1]; // Tipo de estación
      const h = g[2];  // Base de nubes más bajas
      const vv = g.slice(3, 5); // Visibilidad
      const hDesc = {
        "0": "< 50 m", "1": "50–100 m", "2": "100–200 m", "3": "200–300 m",
        "4": "300–600 m", "5": "600–1000 m", "6": "1000–1500 m", "7": "1500–2000 m",
        "8": "2000–2500 m", "9": "> 2500 m o sin nubes", "/": "desconocida"
      }[h] || h;
      let visM = parseInt(vv, 10);
      let visDesc = vv;
      if (visM >= 0 && visM <= 50) visDesc = `${visM * 100} m`;
      else if (visM >= 56 && visM <= 80) visDesc = `${(visM - 50)} km`;
      else if (visM >= 81 && visM <= 89) visDesc = `${30 + (visM - 80) * 5} km`;
      else if (visM === 90) visDesc = "< 50 m";
      else if (visM === 91) visDesc = "50 m";
      else if (visM === 92) visDesc = "200 m";
      else if (visM === 93) visDesc = "500 m";
      else if (visM === 94) visDesc = "1 km";
      else if (visM === 95) visDesc = "2 km";
      else if (visM === 96) visDesc = "4 km";
      else if (visM === 97) visDesc = "10 km";
      else if (visM === 98) visDesc = "20 km";
      else if (visM === 99) visDesc = "> 50 km";
      return `Base nubes: ${hDesc}, Visibilidad: ${visDesc}`;
    },
    nddff: (g) => {
      if (!/^\d{5}$/.test(g)) return null;
      const n = g[0];
      const dd = g.slice(1, 3);
      const ff = g.slice(3, 5);
      const nDesc = n === "0" ? "despejado" : n === "9" ? "cielo oculto" : `${n}/8 oktas`;
      const dirDesc = dd === "00" ? "calma" : dd === "99" ? "variable" : `${parseInt(dd, 10) * 10}°`;
      return `Nubes: ${nDesc}, Viento: ${dirDesc} / ${ff} (unidades según iw)`;
    },
    temp: (g) => {
      if (!/^1[01]\d{3}$/.test(g)) return null;
      const sign = g[1] === "1" ? "-" : "+";
      const t = parseInt(g.slice(2), 10) / 10;
      return `Temperatura: ${sign}${t}°C`;
    },
    dewpoint: (g) => {
      if (!/^2[019]\d{3}$/.test(g)) return null;
      const sign = g[1] === "1" ? "-" : (g[1] === "9" ? "HR " : "+");
      const t = parseInt(g.slice(2), 10) / 10;
      if (g[1] === "9") return `Humedad relativa: ${parseInt(g.slice(2), 10)}%`;
      return `Punto de rocío: ${sign}${t}°C`;
    },
    pressure_sta: (g) => {
      if (!/^3\d{4}$/.test(g)) return null;
      const p = parseInt(g.slice(1), 10);
      const pHpa = p < 5000 ? (p + 10000) / 10 : p / 10;
      return `Presión estación: ${pHpa.toFixed(1)} hPa`;
    },
    pressure_msl: (g) => {
      if (!/^4\d{4}$/.test(g)) return null;
      const p = parseInt(g.slice(1), 10);
      const pHpa = p < 5000 ? (p + 10000) / 10 : p / 10;
      return `Presión nivel mar: ${pHpa.toFixed(1)} hPa`;
    },
    tendency: (g) => {
      if (!/^5[0-8]\d{3}$/.test(g)) return null;
      const a = g[1];
      const ppp = parseInt(g.slice(2), 10) / 10;
      const aDesc = {
        "0": "subiendo, luego bajando", "1": "subiendo, luego estable",
        "2": "subiendo", "3": "bajando o estable, luego subiendo",
        "4": "estable", "5": "bajando, luego subiendo",
        "6": "bajando, luego estable", "7": "bajando",
        "8": "estable o subiendo, luego bajando"
      }[a] || a;
      return `Tendencia: ${aDesc}, cambio: ${ppp} hPa/3h`;
    },
    precip: (g) => {
      if (!/^6\d{4}$/.test(g)) return null;
      const rrr = g.slice(1, 4);
      const tr = g[4];
      if (rrr === "///") return "Precipitación: sin datos";
      const mm = parseInt(rrr, 10);
      const trDesc = { "1": "6h", "2": "12h", "3": "18h", "4": "24h", "5": "1h", "6": "2h", "7": "3h", "8": "9h", "9": "15h" }[tr] || tr;
      return `Precipitación: ${mm} mm en ${trDesc}`;
    },
    weather: (g) => {
      if (!/^7\d{4}$/.test(g)) return null;
      const ww = g.slice(1, 3);
      const w1w2 = g.slice(3, 5);
      const wwText = WW().wwText(ww) || `código ${ww}`;
      return `Tiempo presente: ${wwText} (ww=${ww}), pasado: ${w1w2}`;
    },
    clouds: (g) => {
      if (!/^8[0-9\/]{4}$/.test(g)) return null;
      const nh = g[1];
      const cl = g[2];
      const cm = g[3];
      const ch = g[4];
      const clDesc = { "0": "sin Cu/Cb", "1": "Cu humilis", "2": "Cu mediocris", "3": "Cb calvus", 
                       "4": "Sc cumulogenitus", "5": "Sc no cumulog", "6": "St nebulosus", 
                       "7": "St/Cu fractus", "8": "Cu/Sc", "9": "Cb capillatus", "/": "invisible" }[cl] || cl;
      return `Nubes: Nh=${nh}/8, CL=${clDesc}, CM=${cm}, CH=${ch}`;
    },
  };

  function decodeSynopGroup(group, index, allGroups) {
    const g = String(group).toUpperCase();
    if (g === "AAXX") return "AAXX: Mensaje SYNOP de estación terrestre";
    if (g === "NIL" || g === "NIL=") return "NIL: Sin datos";
    if (g === "333") return "333: Inicio sección climática regional";
    if (g === "555") return "555: Inicio sección nacional";
    if (g.endsWith("=")) return g.slice(0, -1) + " (fin de mensaje)";
    
    // YYGGiw después de AAXX
    if (index === 1 && allGroups[0] === "AAXX") {
      return SYNOP_GROUPS.yyggi(g);
    }
    // Estación después de YYGGiw
    if (index === 2 && allGroups[0] === "AAXX") {
      return SYNOP_GROUPS.station(g);
    }
    
    // Grupos por prefijo
    if (g.startsWith("1") && g.length === 5) return SYNOP_GROUPS.temp(g);
    if (g.startsWith("2") && g.length === 5) return SYNOP_GROUPS.dewpoint(g);
    if (g.startsWith("3") && g.length === 5) return SYNOP_GROUPS.pressure_sta(g);
    if (g.startsWith("4") && g.length === 5) return SYNOP_GROUPS.pressure_msl(g);
    if (g.startsWith("5") && g.length === 5) return SYNOP_GROUPS.tendency(g);
    if (g.startsWith("6") && g.length === 5) return SYNOP_GROUPS.precip(g);
    if (g.startsWith("7") && g.length === 5) return SYNOP_GROUPS.weather(g);
    if (g.startsWith("8") && g.length === 5) return SYNOP_GROUPS.clouds(g);
    
    // iRixhVV y Nddff
    if (g.length === 5 && /^\d{5}$/.test(g)) {
      const decoded = SYNOP_GROUPS.irixhvv(g) || SYNOP_GROUPS.nddff(g);
      if (decoded) return decoded;
    }
    
    return null;
  }

  function synopWithTooltipsHtml(raw) {
    if (!raw) return "—";
    const groups = String(raw).replace(/=/g, " =").split(/\s+/).filter(Boolean);
    return groups.map((g, i) => {
      const decoded = decodeSynopGroup(g, i, groups);
      if (decoded) {
        return `<span class="synop-group" title="${esc(decoded)}">${esc(g)}</span>`;
      }
      return esc(g);
    }).join(" ");
  }

  function visStyle(m) {
    if (m == null || Number.isNaN(Number(m))) return null;
    const v = Number(m);
    // Mensajes: <500 magenta · 500–999 rojo · 1000–2999 naranja · 3000–4999 amarillo · 5000–7999 subrayado
    if (v < 500) return { color: "#ff00ff", underline: true, label: "< 500 m", key: "magenta" };
    if (v < 1000) return { color: "#c62828", underline: true, label: "500–999 m", key: "rojo" };
    if (v < 3000) return { color: "#ef6c00", underline: false, label: "1000–2999 m", key: "naranja" };
    if (v < 5000) return { color: "#f9a825", underline: false, label: "3000–4999 m", key: "amarillo" };
    if (v < 8000) return { color: null, underline: true, label: "5000–7999 m", key: "subrayado" };
    return null;
  }

  /**
   * Viento en mensaje: >15 kt amarillo · >20 kt o ráfaga ≥20 naranja · >25 kt o ráfaga >25 rojo.
   */
  function windStyle(speedKt, gustKt) {
    const s = Number(speedKt);
    const g = gustKt != null ? Number(gustKt) : NaN;
    const speed = Number.isNaN(s) ? 0 : s;
    const gust = Number.isNaN(g) ? 0 : g;
    if (speed > 25 || gust > 25) return { color: "#c62828", label: "> 25 kt", key: "rojo" };
    if (speed > 20 || gust >= 20) return { color: "#ef6c00", label: "> 20 kt", key: "naranja" };
    if (speed > 15) return { color: "#f9a825", label: "> 15 kt", key: "amarillo" };
    return null;
  }

  function coloredWindHtml(speedKt, gustKt, dir) {
    const parts = [];
    if (dir != null) parts.push(`${dir}°`);
    if (speedKt != null) parts.push(`${speedKt} kt`);
    if (gustKt != null) parts.push(`ráfaga ${gustKt} kt`);
    const txt = parts.length ? parts.join(" · ") : "—";
    const st = windStyle(speedKt, gustKt);
    if (!st) return esc(txt);
    return `<span class="metar-wind" style="color:${st.color};font-weight:700">${esc(txt)}</span>`;
  }

  function fmtVis(m) {
    if (m == null) return "—";
    if (m >= 1000) {
      const km = m / 1000;
      return `${m} m (${Number.isInteger(km) ? km : km.toFixed(1)} km)`;
    }
    return `${m} m`;
  }

  function coloredVisHtml(m) {
    const txt = fmtVis(m);
    const st = visStyle(m);
    if (!st) return esc(txt);
    const color = st.color || "inherit";
    const ul = st.underline ? "text-decoration:underline;" : "";
    return `<span class="metar-vis" style="color:${color};font-weight:700;${ul}">${esc(txt)}</span>`;
  }

  function parseWindToken(tok) {
    const m = String(tok || "")
      .toUpperCase()
      .match(/^(?:VRB|[0-9]{3})([0-9]{2,3})(?:G([0-9]{2,3}))?(KT|MPS|KMH)$/);
    if (!m) return null;
    let speed = Number(m[1]);
    let gust = m[2] != null ? Number(m[2]) : null;
    const unit = m[3];
    if (unit === "MPS") {
      speed = Math.round(speed * 1.94384);
      if (gust != null) gust = Math.round(gust * 1.94384);
    } else if (unit === "KMH") {
      speed = Math.round(speed / 1.852);
      if (gust != null) gust = Math.round(gust / 1.852);
    }
    return { speedKt: speed, gustKt: gust };
  }

  function parseVisTokenMeters(tok) {
    const t = String(tok || "").toUpperCase();
    if (t === "CAVOK" || t === "////") return null;
    // Metros ICAO: 0000–9999, opcional NDV o dirección (p.ej. 1200NE)
    const m = t.match(/^([0-9]{4})(?:NDV|[NSEW]{1,2})?$/);
    if (m) return Number(m[1]);
    // Statute miles: 3SM, 1/2SM
    const smSimple = t.match(/^([0-9]{1,2})SM$/);
    if (smSimple) return Math.round(Number(smSimple[1]) * 1609.34);
    const smFrac = t.match(/^([0-9])\/([0-9])SM$/);
    if (smFrac) return Math.round((Number(smFrac[1]) / Number(smFrac[2])) * 1609.34);
    return null;
  }

  function wrapMetarToken(tok, cls, title) {
    return `<span class="${cls}"${title ? ` title="${esc(title)}"` : ""}>${esc(tok)}</span>`;
  }

  /** Estilo de techo BKN/OVC según base (ft). Umbrales inclusivos por código METAR. */
  function ceilingTokenStyle(ft) {
    if (ft == null || Number.isNaN(Number(ft))) return null;
    const h = Number(ft);
    // ≤003 magenta+ul · >003 y ≤005 magenta · >005 y ≤010 rojo · … · >020 y ≤030 subrayado
    if (h <= 300) return { cls: "metar-tok-cld-mu", label: "≤ 300 ft (003)", key: "cld-mu" };
    if (h <= 500) return { cls: "metar-tok-cld-m", label: "301–500 ft (005)", key: "cld-m" };
    if (h <= 1000) return { cls: "metar-tok-cld-r", label: "501–1000 ft (010)", key: "cld-r" };
    if (h <= 1500) return { cls: "metar-tok-cld-o", label: "1001–1500 ft (015)", key: "cld-o" };
    if (h <= 2000) return { cls: "metar-tok-cld-y", label: "1501–2000 ft (020)", key: "cld-y" };
    if (h <= 3000) return { cls: "metar-tok-cld-u", label: "2001–3000 ft (030)", key: "cld-u" };
    return null;
  }

  /**
   * Fenómenos: BR/MI/DZ/RA → amarillo; FG/GR/TS* → rojo; intensidad + → rojo.
   */
  function parseWxTokenStyle(tok) {
    const t = String(tok || "").toUpperCase();
    if (!t || t === "NSW" || t === "NSC" || t === "NCD" || t === "SKC" || t === "CLR") return null;
    const m = t.match(
      /^(\+|-|VC)?((?:MI|PR|BC|DR|BL|SH|TS|FZ)*)((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/
    );
    if (!m) return null;
    const intensity = m[1] || "";
    const desc = m[2] || "";
    const phen = m[3] || "";
    if (!desc && !phen) return null;
    // Descriptor solo: permitir TS (tormenta); MI/SH/etc. sin fenómeno no se colorean
    if (!phen && desc !== "TS" && !desc.startsWith("TS")) return null;

    const hasPlus = intensity === "+";
    const hasTs = desc.includes("TS");
    const hasFg = phen.includes("FG");
    const hasGr = phen.includes("GR");
    if (hasPlus || hasTs || hasFg || hasGr) {
      return { cls: "metar-tok-wx-r", label: "Fenómeno significativo", key: "wx-r" };
    }
    // MI es descriptor (p.ej. MIFG ya cubierto por FG); BR/DZ/RA en fenómeno
    const hasYellow =
      phen.includes("BR") ||
      phen.includes("DZ") ||
      phen.includes("RA") ||
      desc.includes("MI");
    if (hasYellow) {
      return { cls: "metar-tok-wx-y", label: "Fenómeno", key: "wx-y" };
    }
    return null;
  }

  function annotateCloudToken(tok) {
    const t = String(tok || "").toUpperCase();
    // BKN/OVC + altura (+ CB/TCU opcional)
    const bknOvc = t.match(/^(BKN|OVC)([0-9]{3})(CB|TCU)?$/);
    if (bknOvc) {
      const ft = Number(bknOvc[2]) * 100;
      const conv = bknOvc[3] || "";
      const st = ceilingTokenStyle(ft);
      const classes = [];
      if (st) classes.push(st.cls);
      if (conv === "CB") classes.push("metar-tok-cb");
      else if (conv === "TCU") classes.push("metar-tok-tcu");
      if (!classes.length) return esc(tok);
      const title = [st && st.label ? `Techo ${st.label}` : null, conv === "CB" ? "Cumulonimbus" : conv === "TCU" ? "Towering Cumulus" : null]
        .filter(Boolean)
        .join(" · ");
      return wrapMetarToken(tok, classes.join(" "), title || undefined);
    }
    // FEW/SCT/VV + CB/TCU (sin umbral de techo pedido)
    const convOnly = t.match(/^((?:FEW|SCT|VV)[0-9]{0,3})(CB|TCU)$/);
    if (convOnly) {
      const conv = convOnly[2];
      const cls = conv === "CB" ? "metar-tok-cb" : "metar-tok-tcu";
      return wrapMetarToken(
        tok,
        cls,
        conv === "CB" ? "Cumulonimbus" : "Towering Cumulus"
      );
    }
    return null;
  }

  /** Preferencia UI: colorear segmentos en mensajes crudos (Configuración). */
  let colorRawMessages = true;

  function setColorRawMessages(on) {
    colorRawMessages = on !== false;
  }

  function isColorRawMessages() {
    return colorRawMessages !== false;
  }

  /**
   * Colorea segmentos de METAR/SPECI/TAF: viento, vis, fenómenos, techos BKN/OVC, CB/TCU.
   */
  function annotateMetarRawHtml(raw) {
    const text = String(raw || "").trim();
    if (!text) return esc("—");
    if (!colorRawMessages) return esc(text);
    const parts = text.split(/(\s+|\n+)/);
    return parts
      .map((tok) => {
        if (!tok || /^\s+$/.test(tok) || /^\n+$/.test(tok)) return tok;

        const wind = parseWindToken(tok);
        if (wind) {
          const st = windStyle(wind.speedKt, wind.gustKt);
          if (st) {
            const cls =
              st.key === "rojo"
                ? "metar-tok-wind-r"
                : st.key === "naranja"
                  ? "metar-tok-wind-o"
                  : "metar-tok-wind-y";
            return wrapMetarToken(tok, cls, `Viento ${st.label}`);
          }
          return esc(tok);
        }

        const visM = parseVisTokenMeters(tok);
        if (visM != null) {
          const st = visStyle(visM);
          if (st) {
            const cls =
              st.key === "magenta"
                ? "metar-tok-vis-m"
                : st.key === "rojo"
                  ? "metar-tok-vis-r"
                  : st.key === "naranja"
                    ? "metar-tok-vis-o"
                    : st.key === "amarillo"
                      ? "metar-tok-vis-y"
                      : "metar-tok-vis-u";
            return wrapMetarToken(tok, cls, `Vis ${st.label}`);
          }
          return esc(tok);
        }

        const cloudHtml = annotateCloudToken(tok);
        if (cloudHtml != null) return cloudHtml;

        const wx = parseWxTokenStyle(tok);
        if (wx) return wrapMetarToken(tok, wx.cls, wx.label);

        return esc(tok);
      })
      .join("");
  }

  function annotateTafRawHtml(raw) {
    return annotateMetarRawHtml(formatTafDisplay(raw));
  }

  function flightCategory(ceilingFt, visM) {
    const cats = [];
    if (ceilingFt != null) {
      if (ceilingFt < 500) cats.push("LIFR");
      else if (ceilingFt < 1000) cats.push("IFR");
      else if (ceilingFt <= 3000) cats.push("MVFR");
      else cats.push("VFR");
    }
    if (visM != null) {
      if (visM < 1500) cats.push("LIFR");
      else if (visM < 5000) cats.push("IFR");
      else if (visM <= 8000) cats.push("MVFR");
      else cats.push("VFR");
    }
    if (!cats.length) return null;
    const rank = { LIFR: 0, IFR: 1, MVFR: 2, VFR: 3 };
    return cats.reduce((a, b) => (rank[a] < rank[b] ? a : b));
  }

  /** Color por altura de base (ft) cuando hay techo BKN/OVC. */
  function baseHeightStyle(ft) {
    if (ft == null || Number.isNaN(Number(ft))) return null;
    const h = Number(ft);
    if (h < 200) return { color: "#6a1b9a", label: "< 200 ft", key: "vlifr" };
    if (h < 500) return { color: "#c62828", label: "200–500 ft", key: "lifr" };
    if (h < 1000) return { color: "#ef6c00", label: "500–1000 ft", key: "ifr" };
    if (h < 2000) return { color: "#f9a825", label: "1000–2000 ft", key: "mvfr" };
    // Entre naranja y verde
    if (h <= 2500) return { color: "#c0d63a", label: "2000–2500 ft", key: "hi" };
    return { color: "#2e7d32", label: "> 2500 ft", key: "vfr" };
  }

  // Verdes distintos: cielo despejado vs nubosidad poco significativa (FEW/SCT)
  const SKY_CLEAR_GREEN = "#00c853"; // brillante: sin nubes / CAVOK / SKC
  const SKY_FEW_GREEN = "#9ccc65"; // oliváceo: FEW/SCT sin techo

  /**
   * Estado de cielo para colorear por bases.
   * clear | few | ceiling
   */
  function skyState(obs) {
    const a = obs || {};
    const raw = String(a.raw || "").toUpperCase();
    const bases = Array.isArray(a.cloud_bases) ? a.cloud_bases : [];
    const clouds = Array.isArray(a.clouds) ? a.clouds : [];
    const hasCeiling =
      a.ceiling_ft != null ||
      bases.some((b) => b && b.is_ceiling) ||
      clouds.some((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        return cover === "BKN" || cover === "OVC" || cover === "VV" || cover === "OVX";
      });
    if (hasCeiling) return "ceiling";

    const clearToken =
      /\bCAVOK\b/.test(raw) ||
      /\bSKC\b/.test(raw) ||
      /\bCLR\b/.test(raw) ||
      /\bNCD\b/.test(raw) ||
      /\bNSC\b/.test(raw);
    const hasAnyCloud =
      bases.length > 0 ||
      clouds.some((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        return cover && cover !== "SKC" && cover !== "CLR" && cover !== "NCD" && cover !== "NSC";
      });
    if (!hasAnyCloud || clearToken) return "clear";
    return "few";
  }

  /**
   * Cantidad de nube estilo METAR a partir de oktas SYNOP (Ns/Nh/N).
   * FEW 1–2 · SCT 3–4 · BKN 5–7 · OVC 8 (9 = cielo oscurecido → OVC).
   */
  function coverAmount(cover) {
    if (cover == null || cover === "" || cover === "/") return null;
    const n = Number(String(cover));
    if (Number.isNaN(n)) return null;
    if (n <= 0) return { code: "SKC", oktas: 0, significant: false, tone: "muted" };
    if (n <= 2) return { code: "FEW", oktas: n, significant: false, tone: "muted" };
    if (n <= 4) return { code: "SCT", oktas: n, significant: false, tone: "soft" };
    if (n <= 7) return { code: "BKN", oktas: n, significant: true, tone: "bkn" };
    return { code: "OVC", oktas: n >= 9 ? 9 : 8, significant: true, tone: "ovc" };
  }

  function enrichLayer(layer) {
    const amount = coverAmount(layer.cover);
    const heightStyle = baseHeightStyle(layer.height_ft);
    const convective = convectiveFromSynopLayer(layer);
    return {
      ...layer,
      amount,
      height_style: heightStyle,
      is_ceiling: !!(amount && amount.significant),
      convective,
    };
  }

  /** CB (género 9 / Cumulonimbus) o TCU si aparece en el texto. */
  function convectiveFromSynopLayer(layer) {
    const code = layer.genus_code != null ? String(layer.genus_code) : "";
    const name = String(layer.genus || layer.genus_name || "");
    if (code === "9" || /\bCb\b|Cumulonimbus/i.test(name)) return "CB";
    if (/\bTCU\b|Towering/i.test(name)) return "TCU";
    return null;
  }

  function convectiveBadgeHtml(kind) {
    if (!kind) return "";
    const k = String(kind).toUpperCase();
    if (k !== "CB" && k !== "TCU") return "";
    return `<span class="cloud-convective ${k.toLowerCase()}" title="${
      k === "CB" ? "Cumulonimbus" : "Towering Cumulus"
    }">${esc(k)}</span>`;
  }

  function cloudBases(obs) {
    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    const fromLayers = layers
      .filter((l) => l.height_ft != null)
      .map((l) =>
        enrichLayer({
          height_ft: l.height_ft,
          cover: l.ns ?? obs.nh ?? obs.total_cloud,
          genus: l.genus_name || (l.genus != null ? `C=${l.genus}` : null),
          genus_code: l.genus,
          source: "sec.3",
        })
      )
      .sort((a, b) => a.height_ft - b.height_ft);
    if (fromLayers.length) return fromLayers;
    const h = obs.cloud_base_h != null ? String(obs.cloud_base_h) : null;
    if (h != null && H_BASE_FT[h] != null) {
      const cl = obs.cl != null ? String(obs.cl) : null;
      return [
        enrichLayer({
          height_ft: H_BASE_FT[h],
          cover: obs.nh ?? obs.total_cloud,
          genus: cl === "9" ? "Cb — Cumulonimbus (CL)" : `h=${h}`,
          genus_code: cl === "9" ? "9" : null,
          source: "sec.1",
        }),
      ];
    }
    return [];
  }

  function coloredBaseHtml(ft, opts) {
    const compact = opts && opts.compact;
    const st = baseHeightStyle(ft);
    if (ft == null) return "—";
    const txt = `${ft} ft`;
    if (!st) return esc(txt);
    return `<span class="cloud-base-h" style="color:${st.color};font-weight:700">${esc(txt)}</span>${
      compact ? "" : ""
    }`;
  }

  function amountBadgeHtml(amount) {
    if (!amount) return "";
    const cls = `cloud-amt ${amount.tone || "muted"}`;
    const oktas =
      amount.oktas != null ? ` title="${amount.oktas}/8 oktas"` : "";
    return `<span class="${cls}"${oktas}>${esc(amount.code)}</span>`;
  }

  function formatBaseLine(b) {
    // Como antes: badge BKN/OVC con tono + pies coloreados por altura
    const amt = b.amount || coverAmount(b.cover) || amountFromAwCover(b.cover);
    const heightFt =
      b.height_ft != null ? Number(b.height_ft) : b.base != null ? Number(b.base) : null;
    const height = coloredBaseHtml(heightFt);
    const badge = amountBadgeHtml(amt);
    const conv = convectiveBadgeHtml(b.convective);
    const genus = b.genus && !b.convective ? ` · ${esc(b.genus)}` : "";
    const oktas =
      amt && amt.oktas != null
        ? ` <small class="cloud-oktas">${esc(String(amt.oktas))}/8</small>`
        : "";
    return `${badge}${badge ? " " : ""}${height}${oktas}${conv ? " " + conv : ""}${genus}`;
  }

  /** Token METAR compacto para el plot del mapa: COVER + height/100 + CB/TCU. */
  function metarCloudToken(b) {
    if (!b) return "";
    const amt = b.amount || coverAmount(b.cover) || amountFromAwCover(b.cover);
    const code = (amt && amt.code) || String(b.cover || "").toUpperCase() || "///";
    let h = b.height_ft != null ? Number(b.height_ft) : b.base != null ? Number(b.base) : null;
    let hh = "";
    if (h != null && !Number.isNaN(h)) {
      hh = String(Math.max(0, Math.round(h / 100))).padStart(3, "0");
    }
    const conv = b.convective ? String(b.convective).toUpperCase() : "";
    const convOk = conv === "CB" || conv === "TCU" ? conv : "";
    if (code === "VV") return `VV${hh || "///"}${convOk}`;
    return `${code}${hh}${convOk}`;
  }

  /** Capas ordenadas (más altas arriba) para plot/hover. */
  function metarCloudLayers(obs) {
    const bases = Array.isArray(obs.cloud_bases) ? obs.cloud_bases.slice() : [];
    if (bases.length) {
      return bases.sort((a, b) => (b.height_ft || 0) - (a.height_ft || 0));
    }
    if (!Array.isArray(obs.clouds)) return [];
    return (obs.clouds || [])
      .filter((c) => c && (c.base != null || c.cover))
      .map((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        let conv =
          String(c.type || c.cloudType || c.convective || "").toUpperCase() || null;
        if (conv !== "CB" && conv !== "TCU") conv = null;
        const amount = amountFromAwCover(cover.replace(/(CB|TCU)$/, ""));
        return {
          height_ft: c.base != null ? Number(c.base) : null,
          cover,
          amount,
          convective: conv,
          is_ceiling: !!(amount && amount.significant),
          source: "METAR",
        };
      })
      .sort((a, b) => (b.height_ft || 0) - (a.height_ft || 0));
  }

  function metarCloudLines(obs) {
    return metarCloudLayers(obs).map(metarCloudToken).filter(Boolean);
  }

  function barbKeyFromObs(obs) {
    if (obs && obs.wind_barb) return String(obs.wind_barb);
    const spd = obs && obs.wind_speed_kt != null ? Number(obs.wind_speed_kt) : null;
    const dir = obs && obs.wind_dir != null ? Number(obs.wind_dir) : null;
    if ((dir == null || Number.isNaN(dir)) && spd != null && spd >= 1) return "v";
    if (spd == null || spd < 0.5) return "0";
    if (spd < 2.5) return "1";
    const rounded = Math.max(5, Math.min(150, Math.round(spd / 5) * 5));
    return String(rounded);
  }

  /**
   * Plot METAR: barba + códigos planos (BKN013), sin badges de color.
   * Colores de BKN/OVC y pies van en el hover/detalle.
   */
  function buildMetarStationHtml(obs, options) {
    const gap = Math.max(0.4, Math.min(1.5, Number(options && options.gap) || 0.75));
    const colorBy = (options && options.colorBy) || "flight";
    const fill = markerFillColor(obs, colorBy);
    const dir = obs.wind_dir != null ? Number(obs.wind_dir) : 0;
    const barb = barbKeyFromObs(obs);
    const staleCls = obs.stale ? " is-stale" : "";
    const speciCls = obs.has_speci || obs.product === "SPECI" || obs.is_speci ? " has-speci" : "";
    return `
      <div class="plot plot-metar${staleCls}${speciCls}" style="--plot-gap:${gap};--metar-fill:${fill}">
        <div class="plot-anchor">
          <div class="plot-metar-disc" title="${esc(obs.flt_cat || colorBy)}"></div>
          <img class="plot-barb" src="/img/barbs/barb_${esc(barb)}.png" alt=""
               style="transform: rotate(${dir}deg);" draggable="false" />
          ${
            obs.icao
              ? `<span class="plot-metar-icao">${esc(obs.icao)}</span>`
              : obs.omm
                ? `<span class="plot-metar-icao">${esc(obs.omm)}</span>`
                : ""
          }
        </div>
      </div>
    `;
  }

  function significantWx(ww) {
    if (ww == null || ww === "" || ww === "/") return null;
    const code = Number(String(ww).padStart(2, "0"));
    if (Number.isNaN(code)) return null;
    if ([17, 29, 91, 92, 93, 94, 95, 96, 97, 98, 99].includes(code)) {
      return { key: "ts", label: "Tormenta", tone: "danger" };
    }
    if (code >= 40 && code <= 49) return { key: "fg", label: "Niebla", tone: "warn" };
    if ([10, 11, 12, 28].includes(code)) return { key: "br", label: "Neblina", tone: "warn" };
    if (code >= 50 && code <= 59) return { key: "dz", label: "Llovizna", tone: "info" };
    if (code >= 60 && code <= 69) return { key: "ra", label: "Lluvia", tone: "info" };
    if (code >= 70 && code <= 79) return { key: "sn", label: "Nieve", tone: "info" };
    if (code >= 80 && code <= 90) return { key: "sh", label: "Chubascos", tone: "info" };
    if ([18, 19].includes(code)) return { key: "sq", label: "Turbonada/Tromba", tone: "danger" };
    if (code >= 30 && code <= 35) return { key: "du", label: "Polvo/Arena", tone: "warn" };
    return null;
  }

  /** Enriquece un SYNOP con campos de resumen aviación. */
  function fromSynop(obs) {
    const bases = cloudBases(obs);
    // Techo operativo = base más baja BKN/OVC (FEW/SCT no definen techo)
    const ceilingLayer = bases.find((b) => b.is_ceiling) || null;
    const ceiling_ft = ceilingLayer ? ceilingLayer.height_ft : null;
    const ceiling_amount = ceilingLayer ? ceilingLayer.amount : null;
    const vis = obs.visibility_m;
    const flt = flightCategory(ceiling_ft, vis);
    const sig = significantWx(obs.present_weather);
    const wwText = obs.present_weather ? WW().wwText(obs.present_weather) : null;
    const hasCb = bases.some((b) => b.convective === "CB" || b.convective === "TCU");
    return {
      ...obs,
      source: "SYNOP/OGIMET",
      cloud_bases: bases,
      ceiling_ft,
      ceiling_amount,
      flt_cat: flt,
      flt_cat_color: catMeta(flt).color,
      significant: sig,
      ww_text: wwText,
      has_convective: hasCb,
      is_speci: false,
    };
  }

  /** Extrae CB/TCU del texto METAR/SPECI (p.ej. FEW045CB, SCT030TCU). */
  function parseConvectiveFromRaw(raw) {
    const out = [];
    if (!raw) return out;
    const re = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)\b/gi;
    let m;
    while ((m = re.exec(String(raw)))) {
      out.push({
        cover: m[1].toUpperCase(),
        base: m[2] != null ? Number(m[2]) * 100 : null,
        convective: m[3].toUpperCase(),
      });
    }
    return out;
  }

  function amountFromAwCover(cover) {
    const c = String(cover || "").toUpperCase();
    if (!c) return null;
    if (c === "FEW") return { code: "FEW", significant: false, tone: "muted" };
    if (c === "SCT") return { code: "SCT", significant: false, tone: "soft" };
    if (c === "BKN") return { code: "BKN", significant: true, tone: "bkn" };
    if (c === "OVC" || c === "OVX") return { code: "OVC", significant: true, tone: "ovc" };
    if (c === "VV") return { code: "VV", significant: true, tone: "ovc" };
    if (c === "SKC" || c === "CLR" || c === "NSC" || c === "NCD") {
      return { code: c, significant: false, tone: "muted" };
    }
    return { code: c, significant: false, tone: "muted" };
  }

  function formatCloudsAw(clouds, raw) {
    const fromRaw = parseConvectiveFromRaw(raw);
    const list = Array.isArray(clouds) ? clouds.slice() : [];
    const items = list.length
      ? list
      : fromRaw.map((c) => ({
          cover: c.cover,
          base: c.base,
          type: c.convective,
          convective: c.convective,
        }));
    if (!items.length) {
      if (/\bCAVOK\b/i.test(String(raw || ""))) return "CAVOK";
      return "—";
    }
    if (!list.length) {
      if (/\bCAVOK\b/i.test(String(raw || ""))) return "CAVOK";
      return "—";
    }
    return list
      .map((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        const base = c.base != null ? Number(c.base) : null;
        let conv =
          String(c.type || c.cloudType || c.convective || "").toUpperCase() || null;
        if (conv !== "CB" && conv !== "TCU") conv = null;
        if (!conv) {
          const match = fromRaw.find(
            (r) =>
              r.cover === cover &&
              (base == null || r.base == null || Math.abs(r.base - base) < 50)
          );
          if (match) conv = match.convective;
        }
        if (!conv && /CB$/.test(cover)) conv = "CB";
        if (!conv && /TCU$/.test(cover)) conv = "TCU";
        const amt = amountFromAwCover(cover.replace(/(CB|TCU)$/, ""));
        const badge = amountBadgeHtml(amt);
        const height = base != null ? coloredBaseHtml(base) : "";
        const convBadge = convectiveBadgeHtml(conv);
        return (
          `${badge}${badge && height ? " " : ""}${height}${
            convBadge ? " " + convBadge : ""
          }`.trim() || "—"
        );
      })
      .join(" · ");
  }

  /** Epoch ms de un obs_iso / utc SYNOP. */
  function obsTimeMs(obs) {
    if (!obs) return null;
    if (obs.obs_iso) {
      const t = Date.parse(obs.obs_iso);
      if (!Number.isNaN(t)) return t;
    }
    // Fallback display SYNOP: dd/mm/yyyy HH:MM
    if (obs.utc) {
      const m = String(obs.utc).match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/
      );
      if (m) {
        const t = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
        if (!Number.isNaN(t)) return t;
      }
    }
    return null;
  }

  /**
   * SPECI válido solo si es posterior al METAR de la estación.
   * Un METAR nuevo (p.ej. xx:00) cierra el período del SPECI.
   */
  function isSpeciActive(speci, metar) {
    if (!speci) return false;
    const speciT = obsTimeMs(speci);
    const metarT = obsTimeMs(metar);
    if (speciT == null) return true;
    if (metarT == null) return true;
    return speciT > metarT;
  }

  /** Elige el SPECI más reciente vigente respecto del METAR. */
  function pickActiveSpeci(candidates, metar) {
    const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(
      Boolean
    );
    let best = null;
    for (const s of list) {
      if (!isSpeciActive(s, metar)) continue;
      if (!best || (obsTimeMs(s) || 0) > (obsTimeMs(best) || 0)) best = s;
    }
    return best;
  }

  function layersFromAwClouds(clouds, raw) {
    const fromRaw = parseConvectiveFromRaw(raw);
    const list = Array.isArray(clouds) ? clouds : [];
    return list
      .filter((c) => c.base != null)
      .map((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        let conv =
          String(c.type || c.cloudType || c.convective || "").toUpperCase() || null;
        if (conv !== "CB" && conv !== "TCU") conv = null;
        if (!conv) {
          const match = fromRaw.find(
            (r) =>
              r.cover === cover &&
              (c.base == null || r.base == null || Math.abs(r.base - c.base) < 50)
          );
          if (match) conv = match.convective;
        }
        const amount = amountFromAwCover(cover.replace(/(CB|TCU)$/, ""));
        return {
          height_ft: c.base,
          cover: amount ? amount.oktas : null,
          amount,
          convective: conv,
          is_ceiling: !!(amount && amount.significant),
          genus: conv || null,
          source: "METAR",
        };
      })
      .sort((a, b) => a.height_ft - b.height_ft);
  }

  /** Normaliza un punto de /api/surveillance para el front. */
  function fromSurveillance(point) {
    if (!point) return point;
    if (point.nil) return null;
    if (point.product === "SYNOP" || (point.omm && !point.clouds && point.cloud_layers)) {
      if (point.nil) return null;
      const a = fromSynop(point);
      return {
        ...a,
        ...point,
        cloud_bases: a.cloud_bases,
        ceiling_ft: a.ceiling_ft ?? point.ceiling_ft,
        flt_cat: a.flt_cat || point.flt_cat,
        stale: !!point.stale,
        product: "SYNOP",
        source: point.source || a.source || "SYNOP",
        wind_barb: point.wind_barb || a.wind_barb || barbKeyFromObs(point),
      };
    }
    const bases = layersFromAwClouds(point.clouds, point.raw);
    const ceilingLayer = bases.find((b) => b.is_ceiling) || null;
    const ceiling_ft =
      point.ceiling_ft != null
        ? point.ceiling_ft
        : ceilingLayer
          ? ceilingLayer.height_ft
          : null;
    const hasConv = bases.some((b) => b.convective === "CB" || b.convective === "TCU");
    const product = point.product || (point.is_speci ? "SPECI" : "METAR");
    return {
      ...point,
      cloud_bases: bases,
      ceiling_ft,
      ceiling_amount: ceilingLayer ? ceilingLayer.amount : null,
      flt_cat: point.flt_cat || flightCategory(ceiling_ft, point.visibility_m),
      flt_cat_color: catMeta(point.flt_cat).color,
      has_convective: hasConv,
      stale: !!point.stale,
      product,
      source: point.source || product,
      has_speci: !!(point.has_speci || point.speci || product === "SPECI" || point.is_speci),
      is_speci: !!(point.is_speci || product === "SPECI"),
      has_taf_amend: !!(point.has_taf_amend || point.taf_amend),
      taf_amend: point.taf_amend || null,
      raw_taf: point.raw_taf || (point.taf_amend && point.taf_amend.taf_raw) || null,
      wind_barb: point.wind_barb || barbKeyFromObs(point),
    };
  }

  function playSpeciSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playSpeciSound._ctx || new Ctx();
      playSpeciSound._ctx = ctx;
      const now = ctx.currentTime;
      const beep = (t0, freq, dur) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      };
      beep(now, 880, 0.16);
      beep(now + 0.2, 1175, 0.22);
    } catch (_) {
      /* autoplay / contexto no disponible */
    }
  }

  function playTafAmendSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playTafAmendSound._ctx || playSpeciSound._ctx || new Ctx();
      playTafAmendSound._ctx = ctx;
      playSpeciSound._ctx = ctx;
      const now = ctx.currentTime;
      const beep = (t0, freq, dur) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      };
      beep(now, 523, 0.14);
      beep(now + 0.16, 659, 0.14);
      beep(now + 0.32, 784, 0.2);
    } catch (_) {
      /* autoplay / contexto no disponible */
    }
  }

  function speciPanelHtml(speci) {
    if (!speci) return "";
    const cat = catMeta(speci.flt_cat);
    return `
      <section class="speci-panel">
        <div class="meta">
          <span class="speci-badge">SPECI</span>
          <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
          ${speci.icao ? `· ${esc(speci.icao)}` : ""}
          ${speci.obs_iso ? `· ${esc(speci.obs_iso)}` : ""}
        </div>
        <pre class="raw speci-raw metar-raw-annotated">${annotateMetarRawHtml(speci.raw)}</pre>
        <div class="av-grid">
          <div class="av-card">
            <div class="av-label">Visibilidad</div>
            <div class="av-value">${coloredVisHtml(speci.visibility_m)}</div>
          </div>
          <div class="av-card">
            <div class="av-label">Techo</div>
            <div class="av-value">${
              speci.ceiling_ft != null ? coloredBaseHtml(speci.ceiling_ft) : "—"
            }</div>
          </div>
          <div class="av-card">
            <div class="av-label">Ráfagas</div>
            <div class="av-value${speci.wind_gust_kt != null ? " av-gust" : ""}">${
              speci.wind_gust_kt != null ? esc(String(speci.wind_gust_kt)) + " kt" : "—"
            }</div>
          </div>
          <div class="av-card">
            <div class="av-label">Fenómeno</div>
            <div class="av-value">${esc(speci.wx_string || "—")}</div>
          </div>
        </div>
        <div><b>Nubes</b> ${formatCloudsAw(speci.clouds, speci.raw)}</div>
        <div><b>Viento</b> ${coloredWindHtml(
          speci.wind_speed_kt,
          speci.wind_gust_kt,
          speci.wind_dir
        )}</div>
        ${
          speci.icao
            ? `<button type="button" class="btn ghost metar-hist-btn" data-icao="${esc(
                speci.icao
              )}" data-nombre="${esc(speci.nombre || speci.icao)}">Historial METAR/SPECI 24 h</button>`
            : ""
        }
      </section>`;
  }

  function hoverHtml(obs) {
    const a = obs.cloud_bases || obs.product ? obs : fromSynop(obs);
    const cat = catMeta(a.flt_cat);
    const layers = metarCloudLayers(a);
    const bases = layers.length
      ? layers.map((b) => formatBaseLine(b)).join("<br/>")
      : "—";
    const speci = a.speci;
    const product = a.product || "SYNOP";
    const alertBadges = alertBadgesHtml(a);
    const lines = [
      `<b>${esc(a.icao || a.omm)}</b> · ${esc(a.nombre || "")}`,
      a.fir ? `FIR ${esc(a.fir)}` : "",
      alertBadges ? `<div class="metar-alerts">${alertBadges}</div>` : "",
      a.stale ? `<span class="stale-badge">Dato hora anterior</span>` : "",
      speci
        ? `<span class="speci-badge">SPECI</span> ${esc(speci.obs_iso || "")}`
        : "",
      speci ? `<div class="synop-line speci-line">${esc(speci.raw || "")}</div>` : "",
      a.has_taf_amend
        ? `<span class="taf-amend-badge">TAF AMD?</span>`
        : "",
      a.has_taf_amend && a.taf_amend && a.taf_amend.reason_labels
        ? `<div class="synop-line">${esc(
            (a.taf_amend.reason_labels || []).slice(0, 2).join(" · ")
          )}</div>`
        : "",
      `<span style="color:${cat.color}"><b>${esc(cat.label)}</b></span> · ${esc(product)} · <b>Fuente: ${esc(
        a.source
          ? a.fallback || a.source !== "SMN"
            ? `${a.source} (fallback)`
            : a.source
          : "—"
      )}</b>`,
      a.obs_iso ? `UTC ${esc(a.obs_iso)}` : a.utc ? `UTC ${esc(a.utc)}` : "",
      `Vis ${coloredVisHtml(a.visibility_m)}`,
      `Viento ${coloredWindHtml(a.wind_speed_kt, a.wind_gust_kt, a.wind_dir)}`,
      bases !== "—"
        ? `<div class="hover-bases"><b>Bases</b><br/>${bases}</div>`
        : "Bases —",
      a.significant
        ? `<span class="wx-tag ${a.significant.tone}">${esc(a.significant.label)}</span> ${esc(
            a.ww_text || ""
          )}`
        : a.ww_text
          ? esc(a.ww_text)
          : a.wx_string
            ? esc(a.wx_string)
            : "",
      !speci ? `<div class="synop-line">${esc(a.raw || "")}</div>` : "",
    ];
    return lines.filter(Boolean).join("<br/>");
  }

  function detailHtml(obs) {
    const a = obs.cloud_bases || obs.product ? obs : fromSynop(obs);
    const cat = catMeta(a.flt_cat);
    const layers = metarCloudLayers(a);
    const basesHtml = layers.length
      ? layers
          .map((b) => {
            const cls = b.is_ceiling ? "av-base-row is-ceiling" : "av-base-row";
            return `<li class="${cls}">${formatBaseLine(b)}${
              b.source ? ` <small>(${esc(b.source)})</small>` : ""
            }</li>`;
          })
          .join("")
      : "<li>—</li>";

    const ceilAmt = a.ceiling_amount ? amountBadgeHtml(a.ceiling_amount) + " " : "";
    const hasSpeci = !!(a.speci || a.has_speci || a.product === "SPECI");
    const product = a.product || "SYNOP";
    const tafAmend = a.taf_amend;
    const rawTaf = a.raw_taf || (tafAmend && tafAmend.taf_raw) || "";

    return `
      <h2>${esc(a.nombre || a.icao || a.omm)}</h2>
      <div class="meta">
        ${hasSpeci ? `<span class="speci-badge">SPECI activo</span> · ` : ""}
        ${a.has_taf_amend ? `<span class="taf-amend-badge">TAF AMD?</span> · ` : ""}
        ${a.stale ? `<span class="stale-badge">Dato hora anterior</span> · ` : ""}
        ${a.icao ? `${esc(a.icao)} · ` : ""}
        ${a.omm ? `${esc(a.omm)}` : ""}
        ${a.fir ? `· FIR ${esc(a.fir)}` : ""}
      </div>
      ${speciPanelHtml(a.speci)}
      ${tafAmendPanelHtml(tafAmend, rawTaf)}
      <section class="synop-panel${hasSpeci ? " synop-secondary" : ""}">
        <div class="meta">
          <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
          · ${esc(product)}
          · <b>Fuente: ${esc(
            a.source
              ? a.fallback || a.source !== "SMN"
                ? `${a.source} (fallback)`
                : a.source
              : "—"
          )}</b>
          ${
            a.taf_source
              ? ` · TAF: ${esc(
                  a.taf_source !== "SMN" ? `${a.taf_source} (fallback)` : a.taf_source
                )}`
              : ""
          }
          ${a.obs_iso ? `· ${esc(a.obs_iso)}` : a.utc ? `· ${esc(a.utc)}` : ""}
        </div>
        ${
          a.omm
            ? `<button type="button" class="btn primary ts-open-btn" data-omm="${esc(
                a.omm
              )}" data-nombre="${esc(a.nombre || a.omm)}">Ver serie temporal SYNOP</button>`
            : ""
        }
        ${
          a.icao
            ? `<button type="button" class="btn ghost metar-hist-btn" data-icao="${esc(
                a.icao
              )}" data-nombre="${esc(a.nombre || a.icao)}">Historial METAR/SPECI 24 h</button>`
            : ""
        }
        <div class="av-grid">
          <div class="av-card">
            <div class="av-label">Visibilidad</div>
            <div class="av-value">${coloredVisHtml(a.visibility_m)}</div>
          </div>
          <div class="av-card">
            <div class="av-label">Techo (BKN/OVC)</div>
            <div class="av-value">${
              a.ceiling_ft != null
                ? esc(
                    metarCloudToken({
                      cover: (a.ceiling_amount && a.ceiling_amount.code) || "BKN",
                      height_ft: a.ceiling_ft,
                      amount: a.ceiling_amount,
                    })
                  )
                : "—"
            }</div>
          </div>
          <div class="av-card">
            <div class="av-label">Ráfagas</div>
            <div class="av-value${a.wind_gust_kt != null ? " av-gust" : ""}">${
              a.wind_gust_kt != null ? esc(String(a.wind_gust_kt)) + " kt" : "—"
            }</div>
          </div>
          <div class="av-card">
            <div class="av-label">Fenómeno</div>
            <div class="av-value">
              ${
                a.significant
                  ? `<span class="wx-tag ${a.significant.tone}">${esc(a.significant.label)}</span>`
                  : a.wx_string
                    ? esc(a.wx_string)
                    : "—"
              }
              <div class="av-sub">${esc(a.ww_text || a.wx_string || "Sin fenómeno")}</div>
            </div>
          </div>
        </div>
        <div><b>Bases de nubes</b></div>
        <ul class="av-bases">${basesHtml}</ul>
        <div><b>Viento</b> ${coloredWindHtml(a.wind_speed_kt, a.wind_gust_kt, a.wind_dir)}</div>
        <pre class="raw metar-raw-annotated">${annotateMetarRawHtml(a.raw)}</pre>
      </section>
      ${
        rawTaf && !tafAmend
          ? `<section class="taf-panel"><div class="meta"><b>TAF</b></div><pre class="raw taf-raw metar-raw-annotated">${annotateTafRawHtml(
              rawTaf
            )}</pre></section>`
          : ""
      }
    `;
  }



  const AMEND_REASON_COLORS = {
    wind_dir: "#c62828",
    wind_speed: "#ef6c00",
    wind_gust: "#f9a825",
    vis: "#1565c0",
    ceiling: "#6a1b9a",
    cloud_amount: "#00838f",
    wx: "#ad1457",
  };

  function amendReasonColor(key) {
    const k = String(key || "");
    if (k.startsWith("vis_")) return AMEND_REASON_COLORS.vis;
    if (k.startsWith("ceiling_")) return AMEND_REASON_COLORS.ceiling;
    return AMEND_REASON_COLORS[k] || "#455a64";
  }

  function highlightRawHtml(raw, reasons, side) {
    const text = side === "taf" ? formatTafDisplay(raw) : String(raw || "");
    if (!text) return esc("—");
    const reasonList = Array.isArray(reasons) ? reasons : [];
    // Collect token -> color (first reason wins for overlaps)
    const tokenColor = new Map();
    for (const r of reasonList) {
      const color = amendReasonColor(r.key);
      const toks = side === "taf" ? r.highlight_taf || [] : r.highlight_obs || [];
      for (const tok of toks) {
        const t = String(tok || "").toUpperCase();
        if (!t || tokenColor.has(t)) continue;
        tokenColor.set(t, { color, key: r.key });
      }
    }
    if (!tokenColor.size) return esc(text);

    // Longer tokens first to avoid partial overlaps
    const tokens = [...tokenColor.keys()].sort((a, b) => b.length - a.length);
    const upper = text.toUpperCase();
    const ranges = [];
    for (const tok of tokens) {
      let from = 0;
      while (from < upper.length) {
        const idx = upper.indexOf(tok, from);
        if (idx < 0) break;
        // word-ish boundary: avoid matching inside longer alnum token
        const before = idx === 0 ? "" : upper[idx - 1];
        const after = idx + tok.length >= upper.length ? "" : upper[idx + tok.length];
        const okBefore = !before || /[^A-Z0-9+]/.test(before);
        const okAfter = !after || /[^A-Z0-9+]/.test(after);
        if (okBefore && okAfter) {
          const overlaps = ranges.some(
            (rg) => idx < rg.end && idx + tok.length > rg.start
          );
          if (!overlaps) {
            ranges.push({
              start: idx,
              end: idx + tok.length,
              color: tokenColor.get(tok).color,
              key: tokenColor.get(tok).key,
            });
          }
        }
        from = idx + tok.length;
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    let html = "";
    let cursor = 0;
    for (const rg of ranges) {
      if (cursor < rg.start) html += esc(text.slice(cursor, rg.start));
      html += `<mark class="taf-amend-hl" data-amend-key="${esc(rg.key)}" style="--amend-hl:${rg.color};background:${rg.color}33;box-shadow:inset 0 -2px 0 ${rg.color}">${esc(
        text.slice(rg.start, rg.end)
      )}</mark>`;
      cursor = rg.end;
    }
    if (cursor < text.length) html += esc(text.slice(cursor));
    return html;
  }

  /** Salto de línea antes de BECMG / TEMPO / PROBxx (PROB30 TEMPO queda junto). */
  function formatTafDisplay(raw) {
    if (!raw) return "";
    return String(raw)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s+(?=BECMG\b)/gi, "\n")
      .replace(/\s+(?=PROB\d{2}\b)/gi, "\n")
      .replace(/(?<!PROB\d{2})\s+(?=TEMPO\b)/gi, "\n");
  }

  function tafAmendPanelHtml(alert, rawTafFallback) {
    if (!alert && !rawTafFallback) return "";
    if (!alert) return "";
    const reasonObjs = Array.isArray(alert.reasons) ? alert.reasons : [];
    const reasonsHtml = reasonObjs.length
      ? `<ul class="taf-amend-reasons">${reasonObjs
          .map((r) => {
            const color = amendReasonColor(r.key);
            const label = r.label || r;
            return `<li class="taf-amend-reason" data-amend-key="${esc(r.key)}" style="--amend-hl:${color};border-left-color:${color}">
              <span class="taf-amend-reason-swatch" style="background:${color}" aria-hidden="true"></span>
              <span>${esc(String(label))}</span>
            </li>`;
          })
          .join("")}</ul>`
      : alert.reason_labels && alert.reason_labels.length
        ? `<ul class="taf-amend-reasons">${alert.reason_labels
            .map((r) => `<li>${esc(String(r))}</li>`)
            .join("")}</ul>`
        : "";
    const raw = alert.taf_raw || rawTafFallback || "";
    const obsRaw = alert.obs_raw || "";
    return `
      <section class="taf-amend-panel">
        <div class="meta">
          <span class="taf-amend-badge">Posible enmienda TAF</span>
          ${alert.obs_product ? `· ${esc(alert.obs_product)}` : ""}
          ${alert.obs_iso ? `· ${esc(alert.obs_iso)}` : ""}
        </div>
        ${reasonsHtml}
        ${
          obsRaw
            ? `<div><b>Obs</b></div><pre class="raw taf-amend-raw metar-raw-annotated">${annotateMetarRawHtml(
                obsRaw
              )}</pre>`
            : ""
        }
        ${
          raw
            ? `<div><b>TAF</b></div><pre class="raw taf-raw taf-amend-raw metar-raw-annotated">${annotateTafRawHtml(
                raw
              )}</pre>`
            : ""
        }
      </section>`;
  }

  function markerFillColor(obs, colorBy) {
    const a = obs.flt_cat != null || obs.cloud_bases || obs.clouds ? obs : fromSynop(obs);
    const mode = colorBy || "flight";
    if (mode === "vis") {
      return (visStyle(a.visibility_m) || {}).color || "#888888";
    }
    if (mode === "base") {
      const state = skyState(a);
      if (state === "clear") return SKY_CLEAR_GREEN;
      if (state === "few") return SKY_FEW_GREEN;
      const ft =
        a.ceiling_ft != null
          ? a.ceiling_ft
          : a.cloud_bases && a.cloud_bases.length
            ? a.cloud_bases[0].height_ft
            : null;
      return (baseHeightStyle(ft) || {}).color || SKY_CLEAR_GREEN;
    }
    return catMeta(a.flt_cat).color;
  }

  function legendHtml(colorBy) {
    const mode = colorBy || "flight";
    if (mode === "vis") {
      return `
        <div class="flt-legend" aria-label="Visibilidad">
          <span class="flt-leg flt-note">Vis ·</span>
          <span class="flt-leg"><i style="background:#e91e63"></i>&lt;1</span>
          <span class="flt-leg"><i style="background:#9c27b0"></i>1–1.5</span>
          <span class="flt-leg"><i style="background:#f44336"></i>1.5–3</span>
          <span class="flt-leg"><i style="background:#ff9800"></i>3–5</span>
          <span class="flt-leg"><i style="background:#ffeb3b;border-color:#666"></i>5–7</span>
          <span class="flt-leg"><i style="background:#2196f3"></i>7–9</span>
          <span class="flt-leg"><i style="background:#4caf50"></i>≥10 km</span>
        </div>`;
    }
    if (mode === "base") {
      return `
        <div class="flt-legend" aria-label="Base de nubes">
          <span class="flt-leg flt-note">Base ·</span>
          <span class="flt-leg"><i style="background:#6a1b9a"></i>&lt;200</span>
          <span class="flt-leg"><i style="background:#c62828"></i>200–500</span>
          <span class="flt-leg"><i style="background:#ef6c00"></i>500–1k</span>
          <span class="flt-leg"><i style="background:#f9a825"></i>1–2k</span>
          <span class="flt-leg"><i style="background:#c0d63a"></i>2–2.5k</span>
          <span class="flt-leg"><i style="background:#2e7d32"></i>&gt;2.5k</span>
          <span class="flt-leg"><i style="background:${SKY_FEW_GREEN}"></i>FEW/SCT</span>
          <span class="flt-leg"><i style="background:${SKY_CLEAR_GREEN}"></i>despejado</span>
        </div>`;
    }
    return `
      <div class="flt-legend" aria-label="Categorías de vuelo">
        ${Object.keys(CAT)
          .map(
            (k) =>
              `<span class="flt-leg"><i style="background:${CAT[k].color}"></i>${CAT[k].label}</span>`
          )
          .join("")}
      </div>`;
  }

  function markerOptions(obs, selected, colorBy) {
    const a = obs.flt_cat != null || obs.cloud_bases ? obs : fromSynop(obs);
    const danger = a.significant && a.significant.tone === "danger";
    const hasSpeci = !!(a.has_speci || a.speci);
    const hasConv = !!a.has_convective;
    const stale = !!a.stale;
    return {
      radius: selected ? 9 : hasSpeci || a.significant ? 8 : 7,
      color: hasSpeci ? "#b71c1c" : danger ? "#7f0000" : hasConv ? "#e65100" : "#111",
      weight: selected || hasSpeci || a.significant || hasConv ? 2.5 : 1,
      fillColor: markerFillColor(a, colorBy),
      fillOpacity: stale ? (selected ? 0.5 : 0.32) : 0.92,
      opacity: stale ? 0.55 : 0.95,
      className: stale ? "av-marker-stale" : "av-marker-fresh",
    };
  }

  function speciWarnIcon() {
    return L.divIcon({
      className: "speci-warn-icon",
      html: '<span class="speci-warn-badge" title="SPECI vigente">⚠</span>',
      iconSize: [22, 22],
      iconAnchor: [-8, 20],
    });
  }

  function tafAmendWarnIcon() {
    return L.divIcon({
      className: "taf-amend-warn-icon",
      html: '<span class="taf-amend-warn-badge" title="Posible enmienda TAF">AMD</span>',
      iconSize: [28, 18],
      iconAnchor: [36, 22],
    });
  }

  function speciListHtml(items) {
    if (!items || !items.length) {
      return `<div class="speci-list-empty">No hay SPECI vigentes respecto del SYNOP actual.</div>`;
    }
    return items
      .map((s, idx) => {
        const cat = catMeta(s.flt_cat);
        const name = esc(s.nombre || s.station_nombre || s.icao || s.omm || "—");
        const icao = esc(s.icao || "—");
        const omm = s.omm ? esc(String(s.omm)) : "";
        const when = esc(s.obs_iso || "—");
        const raw = esc(s.raw || "");
        const clouds = formatCloudsAw(s.clouds, s.raw);
        const key = esc(String(s.icao || s.omm || idx));
        return `
          <button type="button" class="speci-list-item" data-speci-key="${key}" data-omm="${omm}" data-icao="${icao}">
            <div class="speci-list-item-top">
              <span class="speci-warn-inline" aria-hidden="true">⚠</span>
              <strong>${icao}</strong>
              <span class="speci-list-name">${name}</span>
              <span class="flt-pill" style="background:${cat.color}">${esc(cat.label || "—")}</span>
            </div>
            <div class="speci-list-when">${when}${omm ? ` · OMM ${omm}` : ""}</div>
            <div class="speci-list-meta">Vis ${coloredVisHtml(s.visibility_m)} · Nubes ${clouds}</div>
            <code class="speci-list-raw">${raw}</code>
          </button>`;
      })
      .join("");
  }

  function tafAmendListHtml(items) {
    if (!items || !items.length) {
      return `<div class="speci-list-empty">No hay diferencias TAF/obs por umbrales de enmienda.</div>`;
    }
    return items
      .map((s, idx) => {
        const name = esc(s.nombre || s.station_nombre || s.icao || s.omm || "—");
        const icao = esc(s.icao || "—");
        const omm = s.omm ? esc(String(s.omm)) : "";
        const when = esc(s.obs_iso || "—");
        const reasonObjs = Array.isArray(s.reasons) ? s.reasons : [];
        const reasonsHtml = reasonObjs.length
          ? `<ul class="taf-amend-reasons">${reasonObjs
              .map((r) => {
                const color = amendReasonColor(r.key);
                return `<li class="taf-amend-reason" style="--amend-hl:${color};border-left-color:${color}">
                  <span class="taf-amend-reason-swatch" style="background:${color}" aria-hidden="true"></span>
                  <span>${esc(String(r.label || r))}</span>
                </li>`;
              })
              .join("")}</ul>`
          : (s.reason_labels || []).length
            ? `<ul class="taf-amend-reasons">${(s.reason_labels || [])
                .map((r) => `<li>${esc(String(r))}</li>`)
                .join("")}</ul>`
            : "";
        const key = esc(String(s.icao || s.omm || idx));
        return `
          <button type="button" class="taf-amend-list-item" data-taf-key="${key}" data-omm="${omm}" data-icao="${icao}">
            <div class="speci-list-item-top">
              <span class="taf-amend-warn-inline" aria-hidden="true">AMD</span>
              <strong>${icao}</strong>
              <span class="speci-list-name">${name}</span>
              ${s.obs_product ? `<span class="metar-badge">${esc(s.obs_product)}</span>` : ""}
            </div>
            <div class="speci-list-when">${when}${omm ? ` · OMM ${omm}` : ""}</div>
            ${reasonsHtml}
            <code class="speci-list-raw">${esc(s.obs_raw || "")}</code>
          </button>`;
      })
      .join("");
  }

  // Historial METAR/SPECI (DMA → AW)
  function historyHtml(payload) {
    const points = payload.points || [];
    if (!points.length) {
      return `<div class="ts-empty">Sin METARs/SPECI en las últimas ${payload.hours || 24} h.</div>`;
    }
    const items = points
      .map((p) => {
        const cat = catMeta(p.flt_cat);
        return `
          <article class="metar-hist-item${p.is_speci ? " is-speci" : ""}">
            <span class="flt-pill" style="background:${cat.color}">${esc(cat.label || "—")}</span>
            <pre class="raw metar-raw-annotated">${annotateMetarRawHtml(p.raw)}</pre>
          </article>`;
      })
      .join("");
    return `<div class="metar-hist-list">${items}</div>`;
  }

  async function loadHistory(container, icao) {
    container.innerHTML = `<div class="ts-loading">Cargando METARs…</div>`;
    const res = await fetch(`/api/metars/${encodeURIComponent(icao)}?hours=24&taf=0`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar historial");
    container.innerHTML = historyHtml(data);
    return data;
  }

  global.MetarPlot = {
    CAT,
    catMeta,
    visStyle,
    windStyle,
    fmtVis,
    coloredVisHtml,
    coloredWindHtml,
    annotateMetarRawHtml,
    annotateTafRawHtml,
    setColorRawMessages,
    isColorRawMessages,
    baseHeightStyle,
    skyState,
    coverAmount,
    amountFromAwCover,
    coloredBaseHtml,
    formatCloudsAw,
    metarCloudToken,
    metarCloudLines,
    buildMetarStationHtml,
    convectiveBadgeHtml,
    fromSynop,
    fromSurveillance,
    hoverHtml,
    detailHtml,
    legendHtml,
    markerOptions,
    markerFillColor,
    speciWarnIcon,
    tafAmendWarnIcon,
    speciListHtml,
    tafAmendListHtml,
    formatTafDisplay,
    highlightRawHtml,
    amendReasonColor,
    tafAmendPanelHtml,
    historyHtml,
    loadHistory,
    significantWx,
    isSpeciActive,
    pickActiveSpeci,
    obsTimeMs,
    playSpeciSound,
    playTafAmendSound,
    // Alertas METAR
    ALERT_STYLES,
    getWindAlert,
    getConvectiveAlert,
    getWxAlert,
    getAllAlerts,
    alertBadgesHtml,
    // SYNOP con decodificación
    synopWithTooltipsHtml,
    decodeSynopGroup,
  };
})(window);
