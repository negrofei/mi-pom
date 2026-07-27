/**
 * Símbolos meteorológicos WMO en SVG (cobertura, nubes, tiempo presente, tendencia).
 * Aproximaciones esquemáticas para ploteo de estación.
 */
(function (global) {
  const NUBES_CL = [
    "Fractocumulus / Cumulus humilis",
    "Cumulus mediocris o congestus",
    "Cumulonimbus calvus",
    "Stratocumulus cumulogenitus",
    "Stratocumulus (no cumulogenitus)",
    "Stratus nebulosus o fractostratus",
    "Fractostratus / Fractocumulus de mal tiempo (pannus)",
    "Cumulus y Stratocumulus a distintos niveles",
    "Cumulonimbus capillatus",
  ];
  const NUBES_CM = [
    "Altostratus translucidus",
    "Altostratus opacus o Nimbostratus",
    "Altocumulus translucidus a un nivel",
    "Bancos de Altocumulus (lenticular)",
    "Altocumulus invadiendo el cielo",
    "Altocumulus cumulogenitus",
    "Altocumulus en capas / con Nimbostratus",
    "Altocumulus castellanus o floccus",
    "Altocumulus de cielo caótico",
  ];
  const NUBES_CH = [
    "Cirrus fibratus / uncinus",
    "Cirrus spissatus en bancos",
    "Cirrus spissatus cumulonimbogenitus",
    "Cirrus invadiendo el cielo",
    "Cirrus y Cirrostratus (&lt;45°)",
    "Cirrus y Cirrostratus (&gt;45°)",
    "Cirrostratus cubriendo todo el cielo",
    "Cirrostratus parcial",
    "Cirrocumulus predominante",
  ];

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cloudCoverSymbol(n, x, y, r) {
    const code = n == null || n === "" || n === "/" ? null : String(n);
    if (code == null) {
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#111" stroke-width="1.6" stroke-dasharray="2 2"/>`;
    }
    const c = Number(code);
    const base = `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#111" stroke-width="1.6"/>`;
    if (c === 0) return base;
    if (c === 9) {
      // cielo obscurecido: X
      return (
        base +
        `<path d="M${x - r * 0.55} ${y - r * 0.55} L${x + r * 0.55} ${y + r * 0.55} M${x + r * 0.55} ${y - r * 0.55} L${x - r * 0.55} ${y + r * 0.55}" stroke="#111" stroke-width="1.8"/>`
      );
    }
    // Rellenos por oktas (aproximación)
    const clips = {
      1: `<path d="M${x} ${y - r} A${r} ${r} 0 0 1 ${x + 0.01} ${y - r} L${x} ${y} Z" fill="#111"/>`,
      2: `<path d="M${x} ${y - r} A${r} ${r} 0 0 1 ${x + r} ${y} L${x} ${y} Z" fill="#111"/>`,
      3: `<path d="M${x} ${y - r} A${r} ${r} 0 0 1 ${x + r * 0.7} ${y + r * 0.7} L${x} ${y} Z" fill="#111"/>`,
      4: `<path d="M${x} ${y - r} A${r} ${r} 0 0 1 ${x} ${y + r} L${x} ${y} Z" fill="#111"/>`,
      5: `<path d="M${x} ${y - r} A${r} ${r} 0 1 1 ${x - r * 0.7} ${y + r * 0.7} L${x} ${y} Z" fill="#111"/>`,
      6: `<path d="M${x} ${y - r} A${r} ${r} 0 1 1 ${x - r} ${y} L${x} ${y} Z" fill="#111"/>`,
      7: `${base}<circle cx="${x}" cy="${y}" r="${r - 0.5}" fill="#111"/><circle cx="${x}" cy="${y}" r="${r * 0.28}" fill="#fff"/>`,
      8: `<circle cx="${x}" cy="${y}" r="${r}" fill="#111" stroke="#111" stroke-width="1.6"/>`,
    };
    if (c === 7) return clips[7];
    if (c === 8) return clips[8];
    return base + (clips[c] || "");
  }

  function windBarb(speedKt, dirDeg, cx, cy, length) {
    const kt = Math.max(0, Number(speedKt) || 0);
    if (kt < 0.5 || dirDeg == null || Number.isNaN(Number(dirDeg))) {
      // calma: círculo concéntrico
      return `<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="#111" stroke-width="1.4"/>`;
    }
    // Convención meteorológica: la barba apunta HACIA donde sopla el viento (desde donde viene)
    // En plots, el asta se dibuja en la dirección de procedencia.
    const rad = ((Number(dirDeg)) * Math.PI) / 180;
    const x2 = cx + Math.sin(rad) * length;
    const y2 = cy - Math.cos(rad) * length;

    let remaining = Math.round(kt);
    // Redondeo a 5 kt
    remaining = Math.round(remaining / 5) * 5;
    const marks = [];
    let pos = 0;
    const spacing = 5.2;
    const barbLen = 12;

    // pennants (50 kt)
    while (remaining >= 50) {
      const t = 1 - pos / length;
      const bx = cx + Math.sin(rad) * (length * t);
      const by = cy - Math.cos(rad) * (length * t);
      const px = bx + Math.sin(rad + Math.PI / 2) * barbLen;
      const py = by - Math.cos(rad + Math.PI / 2) * barbLen;
      const t2 = 1 - (pos + spacing) / length;
      const bx2 = cx + Math.sin(rad) * (length * t2);
      const by2 = cy - Math.cos(rad) * (length * t2);
      marks.push(
        `<polygon points="${bx},${by} ${px},${py} ${bx2},${by2}" fill="#111"/>`
      );
      remaining -= 50;
      pos += spacing + 2;
    }
    while (remaining >= 10) {
      const t = 1 - pos / length;
      const bx = cx + Math.sin(rad) * (length * t);
      const by = cy - Math.cos(rad) * (length * t);
      const px = bx + Math.sin(rad + Math.PI / 2) * barbLen;
      const py = by - Math.cos(rad + Math.PI / 2) * barbLen;
      marks.push(`<line x1="${bx}" y1="${by}" x2="${px}" y2="${py}" stroke="#111" stroke-width="1.6"/>`);
      remaining -= 10;
      pos += spacing;
    }
    if (remaining >= 5) {
      const t = 1 - pos / length;
      const bx = cx + Math.sin(rad) * (length * t);
      const by = cy - Math.cos(rad) * (length * t);
      const px = bx + Math.sin(rad + Math.PI / 2) * (barbLen * 0.55);
      const py = by - Math.cos(rad + Math.PI / 2) * (barbLen * 0.55);
      marks.push(`<line x1="${bx}" y1="${by}" x2="${px}" y2="${py}" stroke="#111" stroke-width="1.6"/>`);
    }

    return (
      `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="1.7"/>` +
      marks.join("")
    );
  }

  function tendencySymbol(a, x, y) {
    if (a == null || a === "/" || a === "") return "";
    const s = String(a);
    const paths = {
      0: `M${x - 6} ${y} L${x - 2} ${y - 5} L${x + 2} ${y + 5} L${x + 6} ${y}`, // rising then steady-ish
      1: `M${x - 6} ${y + 4} L${x + 6} ${y - 4}`, // rising
      2: `M${x - 6} ${y + 2} L${x} ${y - 5} L${x + 6} ${y + 2}`, // rising then falling? simplified /
      3: `M${x - 6} ${y} L${x + 6} ${y}`, // steady
      4: `M${x - 6} ${y - 2} L${x} ${y + 5} L${x + 6} ${y - 2}`,
      5: `M${x - 6} ${y - 4} L${x + 6} ${y + 4}`, // falling
      6: `M${x - 6} ${y} L${x - 2} ${y + 5} L${x + 2} ${y - 5} L${x + 6} ${y}`,
      7: `M${x - 6} ${y - 4} L${x} ${y + 4} L${x + 6} ${y - 4}`,
      8: `M${x - 6} ${y + 4} L${x} ${y - 4} L${x + 6} ${y + 4}`,
    };
    // Usar símbolos clásicos simplificados a/a
    const simple = {
      "0": `<path d="M${x - 7} ${y + 3} L${x} ${y - 5} L${x + 7} ${y + 3}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "1": `<path d="M${x - 7} ${y + 4} L${x + 7} ${y - 4}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "2": `<path d="M${x - 7} ${y + 4} L${x - 1} ${y - 4} L${x + 7} ${y - 4}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "3": `<path d="M${x - 7} ${y} L${x + 7} ${y}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "4": `<path d="M${x - 7} ${y - 4} L${x - 1} ${y + 4} L${x + 7} ${y + 4}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "5": `<path d="M${x - 7} ${y - 4} L${x + 7} ${y + 4}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "6": `<path d="M${x - 7} ${y - 3} L${x} ${y + 5} L${x + 7} ${y - 3}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "7": `<path d="M${x - 7} ${y - 4} L${x + 1} ${y + 4} L${x + 7} ${y - 4}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
      "8": `<path d="M${x - 7} ${y + 4} L${x + 1} ${y - 4} L${x + 7} ${y + 4}" fill="none" stroke="#1a4a9a" stroke-width="1.6"/>`,
    };
    return simple[s] || `<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="10" fill="#1a4a9a">${esc(s)}</text>`;
  }

  function presentWeather(ww, x, y) {
    if (ww == null || ww === "" || ww === "//") return "";
    const code = String(ww).padStart(2, "0");
    // Subconjunto frecuente + fallback numérico
    const symbols = {
      "04": `<text x="${x}" y="${y}" text-anchor="middle" font-size="13" fill="#111">∞</text>`, // humo aprox
      "05": `<text x="${x}" y="${y}" text-anchor="middle" font-size="14" fill="#111">∞</text>`, // neblina
      "10": `<path d="M${x - 8} ${y - 2} Q${x - 4} ${y - 6} ${x} ${y - 2} Q${x + 4} ${y + 2} ${x + 8} ${y - 2}" fill="none" stroke="#111" stroke-width="1.5"/>`,
      "50": rainDots(x, y, 2),
      "51": rainDots(x, y, 2),
      "60": rainDots(x, y, 3),
      "61": rainDots(x, y, 3),
      "63": rainDots(x, y, 4),
      "65": rainDots(x, y, 5),
      "70": snowStars(x, y, 2),
      "71": snowStars(x, y, 2),
      "73": snowStars(x, y, 3),
      "80": rainDots(x, y, 3) + `<path d="M${x - 6} ${y + 6} L${x} ${y - 2} L${x + 6} ${y + 6}" fill="none" stroke="#111" stroke-width="1.2"/>`,
      "95": `<text x="${x}" y="${y + 1}" text-anchor="middle" font-size="12" fill="#111">⚡</text>`,
    };
    if (symbols[code]) return symbols[code];
    return `<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9" fill="#333">${esc(code)}</text>`;
  }

  function rainDots(x, y, n) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * 4;
      s += `<circle cx="${x + dx}" cy="${y}" r="1.4" fill="#111"/>`;
    }
    return s;
  }

  function snowStars(x, y, n) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * 5;
      s += `<text x="${x + dx}" y="${y + 3}" text-anchor="middle" font-size="9" fill="#111">*</text>`;
    }
    return s;
  }

  function cloudType(kind, code, x, y) {
    if (code == null || code === "" || code === "/" || code === "0") return "";
    const c = String(code);
    // Formas esquemáticas por familia
    if (kind === "CL") {
      const map = {
        "1": dome(x, y, false),
        "2": dome(x, y, true),
        "3": dome(x, y, true) + `<line x1="${x}" y1="${y - 8}" x2="${x}" y2="${y - 14}" stroke="#111" stroke-width="1.4"/>`,
        "4": dome(x, y, false) + `<path d="M${x - 3} ${y - 8} A3 3 0 0 1 ${x + 3} ${y - 8}" fill="none" stroke="#111"/>`,
        "5": `<path d="M${x - 9} ${y} Q${x - 4} ${y - 8} ${x} ${y} Q${x + 4} ${y + 6} ${x + 9} ${y}" fill="none" stroke="#111" stroke-width="1.5"/>`,
        "6": `<line x1="${x - 9}" y1="${y}" x2="${x + 9}" y2="${y}" stroke="#111" stroke-width="1.6"/>`,
        "7": `<path d="M${x - 8} ${y + 2} Q${x} ${y - 6} ${x + 8} ${y + 2}" fill="none" stroke="#111" stroke-width="1.5"/>`,
        "8": dome(x - 4, y, false) + dome(x + 4, y + 2, false),
        "9": dome(x, y, true) + `<path d="M${x - 6} ${y - 10} L${x + 8} ${y - 14}" stroke="#111" stroke-width="1.3"/>`,
      };
      return map[c] || `<text x="${x}" y="${y}" text-anchor="middle" font-size="9">${esc(c)}</text>`;
    }
    if (kind === "CM") {
      return `<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="10" fill="#111">—${esc(c)}—</text>`;
    }
    // CH
    return `<path d="M${x - 8} ${y + 2} Q${x - 3} ${y - 5} ${x + 2} ${y + 1} Q${x + 5} ${y + 4} ${x + 9} ${y - 2}" fill="none" stroke="#111" stroke-width="1.4"/><text x="${x + 10}" y="${y + 3}" font-size="8">${esc(c)}</text>`;
  }

  function dome(x, y, tall) {
    const h = tall ? 10 : 7;
    return `<path d="M${x - 8} ${y} A8 ${h} 0 0 1 ${x + 8} ${y}" fill="none" stroke="#111" stroke-width="1.5"/><line x1="${x - 8}" y1="${y}" x2="${x + 8}" y2="${y}" stroke="#111" stroke-width="1.3"/>`;
  }

  function cloudLabel(kind, code) {
    const n = Number(code);
    if (!n || n < 1 || n > 9) return "";
    const arr = kind === "CL" ? NUBES_CL : kind === "CM" ? NUBES_CM : NUBES_CH;
    return `(${n}) — ${arr[n - 1]}`;
  }

  global.SynopSymbols = {
    cloudCoverSymbol,
    windBarb,
    tendencySymbol,
    presentWeather,
    cloudType,
    cloudLabel,
    NUBES_CL,
    NUBES_CM,
    NUBES_CH,
    esc,
  };
})(window);
