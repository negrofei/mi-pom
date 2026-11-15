/**
 * Pestaña Consulta (/consulta): METAR/SPECI | TAF + enmienda.
 */
(function (global) {
  const FIR_OPTIONS = [
    { code: "EZE", name: "Ezeiza" },
    { code: "CBA", name: "Córdoba" },
    { code: "DOZ", name: "Mendoza" },
    { code: "SIS", name: "Resistencia" },
    { code: "CRV", name: "Comodoro Rivadavia" },
  ];
  const ID_LIMIT = 40;

  let airportsCache = null;
  let airportsPromise = null;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTaf(raw) {
    if (global.MetarPlot && typeof global.MetarPlot.formatTafDisplay === "function") {
      return global.MetarPlot.formatTafDisplay(raw);
    }
    return String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s+(?=BECMG\b)/gi, "\n")
      .replace(/\s+(?=PROB\d{2}\b)/gi, "\n")
      .replace(/(?<!PROB\d{2})\s+(?=TEMPO\b)/gi, "\n");
  }

  function parseIdsInput(value) {
    return String(value || "")
      .toUpperCase()
      .split(/[\s,;]+/)
      .map((t) => t.replace(/[^A-Z]/g, ""))
      .filter((t) => t.length === 4)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, ID_LIMIT);
  }

  function formatIds(ids) {
    return (Array.isArray(ids) ? ids : parseIdsInput(ids)).join(", ");
  }

  function normalizePresetName(name) {
    return String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 32);
  }

  function sanitizePresets(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const name = normalizePresetName(item.name);
      if (!name) continue;
      const key = name.toUpperCase();
      if (seen.has(key)) continue;
      const ids = parseIdsInput(Array.isArray(item.ids) ? item.ids.join(",") : item.ids);
      if (!ids.length) continue;
      seen.add(key);
      out.push({ name, ids });
    }
    return out.slice(0, 40);
  }

  function customPresetKey(name) {
    return `custom:${normalizePresetName(name)}`;
  }

  function firPresetKey(code) {
    return `fir:${String(code || "").toUpperCase()}`;
  }

  async function loadAirports() {
    if (airportsCache) return airportsCache;
    if (airportsPromise) return airportsPromise;
    airportsPromise = fetch("/api/airports")
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data.airports) ? data.airports : [];
        airportsCache = list
          .map((a) => ({
            icao: String(a.icao || "")
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, ""),
            fir: String(a.fir || "").toUpperCase(),
            nombre: a.nombre || "",
          }))
          .filter((a) => a.icao.length === 4);
        return airportsCache;
      })
      .catch((err) => {
        airportsPromise = null;
        throw err;
      });
    return airportsPromise;
  }

  function icaosForFir(airports, firCode) {
    const fir = String(firCode || "").toUpperCase();
    return (airports || [])
      .filter((a) => a.fir === fir)
      .map((a) => a.icao)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .sort()
      .slice(0, ID_LIMIT);
  }

  function resolveSelection(key, { airports = [], presets = [] } = {}) {
    const k = String(key || "manual");
    if (k === "manual" || !k) {
      return { mode: "manual", key: "manual", ids: null, label: "Personalizada" };
    }
    if (k.startsWith("fir:")) {
      const fir = k.slice(4).toUpperCase();
      const meta = FIR_OPTIONS.find((f) => f.code === fir);
      const ids = icaosForFir(airports, fir);
      return {
        mode: "fir",
        key: firPresetKey(fir),
        fir,
        ids,
        label: meta ? `FIR ${fir} · ${meta.name}` : `FIR ${fir}`,
      };
    }
    if (k.startsWith("custom:")) {
      const name = normalizePresetName(k.slice(7));
      const preset = sanitizePresets(presets).find(
        (p) => p.name.toUpperCase() === name.toUpperCase()
      );
      return {
        mode: "custom",
        key: customPresetKey(name),
        name,
        ids: preset ? [...preset.ids] : [],
        label: name || "Guardada",
        missing: !preset,
      };
    }
    return { mode: "manual", key: "manual", ids: null, label: "Personalizada" };
  }

  function upsertPreset(presets, name, ids) {
    const cleanName = normalizePresetName(name);
    const cleanIds = parseIdsInput(Array.isArray(ids) ? ids.join(",") : ids);
    if (!cleanName) throw new Error("Indicá un nombre para la selección");
    if (!cleanIds.length) throw new Error("Indicá al menos un ICAO para guardar");
    const next = sanitizePresets(presets).filter(
      (p) => p.name.toUpperCase() !== cleanName.toUpperCase()
    );
    next.unshift({ name: cleanName, ids: cleanIds });
    return sanitizePresets(next);
  }

  function removePreset(presets, name) {
    const cleanName = normalizePresetName(name);
    if (!cleanName) return sanitizePresets(presets);
    return sanitizePresets(presets).filter(
      (p) => p.name.toUpperCase() !== cleanName.toUpperCase()
    );
  }

  function highlight(raw, reasons, side) {
    if (global.MetarPlot && typeof global.MetarPlot.highlightRawHtml === "function") {
      return global.MetarPlot.highlightRawHtml(raw, reasons || [], side);
    }
    const text = side === "taf" ? formatTaf(raw) : String(raw || "");
    return esc(text || "—");
  }

  function amendBlock(alert, tafRaw) {
    if (!alert) {
      return `<div class="lookup-amend-ok">Sin diferencia por umbrales de enmienda vs la obs. más reciente.</div>`;
    }
    if (global.MetarPlot && typeof global.MetarPlot.tafAmendPanelHtml === "function") {
      // Panel completo ya incluye Obs+TAF; en layout partido solo queremos motivos
      const reasons = Array.isArray(alert.reasons) ? alert.reasons : [];
      if (!reasons.length && alert.reason_labels) {
        return `<ul class="taf-amend-reasons">${alert.reason_labels
          .map((r) => `<li>${esc(String(r))}</li>`)
          .join("")}</ul>`;
      }
      const colorFn = global.MetarPlot.amendReasonColor || (() => "#1565c0");
      return `
        <div class="lookup-amend-head">
          <span class="taf-amend-badge">Posible enmienda TAF</span>
          ${alert.obs_product ? `· ${esc(alert.obs_product)}` : ""}
          ${alert.obs_iso ? `· ${esc(alert.obs_iso)}` : ""}
        </div>
        <ul class="taf-amend-reasons">${reasons
          .map((r) => {
            const color = colorFn(r.key);
            return `<li class="taf-amend-reason" style="--amend-hl:${color};border-left-color:${color}">
              <span class="taf-amend-reason-swatch" style="background:${color}" aria-hidden="true"></span>
              <span>${esc(String(r.label || r))}</span>
            </li>`;
          })
          .join("")}</ul>`;
    }
    const labels = alert.reason_labels || [];
    return `<ul class="taf-amend-reasons">${labels
      .map((r) => `<li>${esc(String(r))}</li>`)
      .join("")}</ul>`;
  }

  function stationHtml(st) {
    const taf = st.taf;
    const msgs = st.messages || [];
    const alert = st.taf_amend || null;
    const reasons = (alert && alert.reasons) || [];
    const latestIso = msgs[0] && msgs[0].obs_iso;

    const msgsHtml = msgs.length
      ? msgs
          .map((m, idx) => {
            const kind = m.is_speci || m.metar_type === "SPECI" ? "SPECI" : "METAR";
            const isLatest = idx === 0;
            const rawHtml =
              global.MetarPlot && typeof global.MetarPlot.annotateMetarRawHtml === "function"
                ? global.MetarPlot.annotateMetarRawHtml(m.raw || "")
                : esc(m.raw || "—");
            const cat =
              (global.MetarPlot && global.MetarPlot.catMeta && global.MetarPlot.catMeta(m.flt_cat)) || {
                color: "#888",
                label: m.flt_cat || "—",
              };
            return `
            <article class="lookup-msg${kind === "SPECI" ? " is-speci" : ""}${
              isLatest ? " is-latest" : ""
            }">
              <span class="flt-pill" style="background:${cat.color}">${esc(cat.label || "—")}</span>
              <pre class="raw taf-amend-raw metar-raw-annotated">${rawHtml}</pre>
            </article>`;
          })
          .join("")
      : `<div class="lookup-empty">Sin METAR/SPECI en la ventana pedida.</div>`;

    const tafBody =
      taf && taf.raw
        ? `<div class="lookup-taf-meta">
            <span class="lookup-badge taf">TAF</span>
            ${taf.issue_iso ? `<span>emisión ${esc(taf.issue_iso)}</span>` : ""}
            ${
              taf.valid_from_iso || taf.valid_to_iso
                ? `<span>válido ${esc(taf.valid_from_iso || "—")} → ${esc(
                    taf.valid_to_iso || "—"
                  )}</span>`
                : ""
            }
          </div>
          <pre class="raw taf-raw taf-amend-raw metar-raw-annotated">${
            global.MetarPlot && typeof global.MetarPlot.annotateTafRawHtml === "function"
              ? global.MetarPlot.annotateTafRawHtml(taf.raw)
              : esc(taf.raw || "—")
          }</pre>`
        : `<div class="lookup-empty">Sin TAF disponible.</div>`;

    const amendHtml =
      taf && taf.raw
        ? `<div class="lookup-amend">${amendBlock(alert, taf.raw)}</div>`
        : "";

    return `
      <section class="lookup-station${st.has_taf_amend ? " has-amend" : ""}" data-icao="${esc(
        st.icao
      )}">
        <header class="lookup-station-head">
          <h2><strong>${esc(st.icao)}</strong> ${esc(st.nombre || "")}
            ${st.has_taf_amend ? `<span class="taf-amend-badge">TAF AMD?</span>` : ""}
          </h2>
          <div class="lookup-station-meta">
            ${st.fir ? `FIR ${esc(st.fir)} · ` : ""}
            ${msgs.length} obs
            ${taf && taf.raw ? " · TAF" : ""}
            ${latestIso ? ` · ref ${esc(latestIso)}` : ""}
          </div>
          ${
            global.MetarPlot && typeof global.MetarPlot.wrfForecastLinkHtml === "function"
              ? global.MetarPlot.wrfForecastLinkHtml(st.icao)
              : ""
          }
        </header>
        <div class="lookup-split">
          <div class="lookup-col lookup-col-obs">
            <div class="lookup-col-title">METAR / SPECI</div>
            <div class="lookup-msg-list">${msgsHtml}</div>
          </div>
          <div class="lookup-col lookup-col-taf">
            <div class="lookup-col-title">TAF</div>
            <div class="lookup-taf">${tafBody}</div>
            ${amendHtml}
          </div>
        </div>
      </section>`;
  }

  function resultsHtml(payload) {
    const stations = payload.stations || [];
    if (!stations.length) {
      return `<div class="lookup-empty">Sin resultados.</div>`;
    }
    return stations.map(stationHtml).join("");
  }

  async function runLookup({ ids, hours, includeTaf }) {
    const list = Array.isArray(ids) ? ids : parseIdsInput(ids);
    if (!list.length) {
      throw new Error("Indicá al menos un ICAO de 4 letras");
    }
    const q = new URLSearchParams({
      ids: list.join(","),
      hours: String(hours || 6),
      taf: includeTaf ? "1" : "0",
      amend: "1",
    });
    const res = await fetch(`/api/lookup?${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error de consulta");
    return data;
  }

  global.AwLookup = {
    FIR_OPTIONS,
    ID_LIMIT,
    parseIdsInput,
    formatIds,
    normalizePresetName,
    sanitizePresets,
    customPresetKey,
    firPresetKey,
    loadAirports,
    icaosForFir,
    resolveSelection,
    upsertPreset,
    removePreset,
    resultsHtml,
    runLookup,
    stationHtml,
  };
})(window);
