"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

type CheckResult = {
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
  checkedAt: string;
};

type Report = {
  url: string;
  generatedAt: string;
  performanceScore: number | null;
  suggestions: string[];
  source: string;
};

type ResultsMap = Record<string, CheckResult>;

function scoreColor(score: number | null) {
  if (score === null) return "#8b93a1";
  if (score >= 90) return "#35c07a";
  if (score >= 50) return "#e0a63c";
  return "#e5484d";
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, "");
}

// ---- sorting ----------------------------------------------------------

type SortKey = "url" | "status" | "ms" | "checkedAt";
type SortDir = "asc" | "desc";
type SortState = { key: SortKey; dir: SortDir } | null;

// ponytail: missing values (no check yet) always sort to the bottom regardless
// of asc/desc — that's the useful behavior (see the freshest/worst data first,
// not "no data" fighting for the top spot depending on direction).
export function compareRows(a: string, b: string, results: ResultsMap, sort: SortState): number {
  if (!sort) return 0;
  const ra = results[a];
  const rb = results[b];
  const mult = sort.dir === "asc" ? 1 : -1;

  if (sort.key === "url") return displayUrl(a).localeCompare(displayUrl(b)) * mult;

  const va = sort.key === "status" ? ra?.status : sort.key === "ms" ? ra?.ms : ra ? new Date(ra.checkedAt).getTime() : null;
  const vb = sort.key === "status" ? rb?.status : sort.key === "ms" ? rb?.ms : rb ? new Date(rb.checkedAt).getTime() : null;
  const missingA = va === null || va === undefined;
  const missingB = vb === null || vb === undefined;
  if (missingA && missingB) return 0;
  if (missingA) return 1;
  if (missingB) return -1;
  return (va - vb) * mult;
}

function nextSort(current: SortState, key: SortKey): SortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null; // desc -> unsorted
}

function sortIndicator(current: SortState, key: SortKey) {
  if (!current || current.key !== key) return "⇅";
  return current.dir === "asc" ? "▲" : "▼";
}

// ---- filtering ----------------------------------------------------------

// "all" | "ok" | "errors" | "pending" | "code-404" (etc)
type StatusFilter = string;

function matchesFilter(url: string, results: ResultsMap, filter: StatusFilter): boolean {
  const r = results[url];
  if (filter === "all") return true;
  if (filter === "pending") return !r;
  if (filter === "ok") return !!r?.ok;
  if (filter === "errors") return !!r && !r.ok;
  if (filter.startsWith("code-")) return r?.status === Number(filter.slice(5));
  return true;
}

export function getFilteredLinks(links: string[], results: ResultsMap, filter: StatusFilter): string[] {
  return links.filter((url) => matchesFilter(url, results, filter));
}

export function getSortedLinks(links: string[], results: ResultsMap, sort: SortState): string[] {
  if (!sort) return links;
  return [...links].sort((a, b) => compareRows(a, b, results, sort));
}

// ---- report text ----------------------------------------------------------

type ReportFormat = "grouped" | "errors" | "ok" | "plain";

function statusLabel(r: CheckResult | undefined): string {
  if (!r) return "SIN DATOS";
  if (r.status === null) return `SIN RESPUESTA${r.error ? ` (${r.error})` : ""}`;
  return `HTTP ${r.status}`;
}

function statusOrder(r: CheckResult | undefined): number {
  if (!r) return 9999; // sin datos, al final
  if (r.status === null) return 9000; // sin respuesta, casi al final
  return r.status;
}

export function buildReportText(
  links: string[],
  results: ResultsMap,
  format: ReportFormat,
  filterLabel: string
): string {
  const scoped =
    format === "errors" ? links.filter((u) => !!results[u] && !results[u].ok) :
    format === "ok" ? links.filter((u) => !!results[u]?.ok) :
    links;

  const header = [
    `SiteCheck — Reporte`,
    `Generado: ${new Date().toLocaleString("es-AR")}`,
    `Filtro activo: ${filterLabel}`,
    `Total: ${scoped.length} sitio(s)`,
    "",
  ].join("\n");

  if (format === "plain") {
    return header + scoped.map(displayUrl).join("\n");
  }

  // grouped / errors / ok all render as groups-by-status-code
  const groups = new Map<string, string[]>();
  for (const url of scoped) {
    const label = statusLabel(results[url]);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(url);
  }
  const orderedLabels = [...groups.keys()].sort(
    (a, b) => statusOrder(results[scoped.find((u) => statusLabel(results[u]) === a)!]) -
               statusOrder(results[scoped.find((u) => statusLabel(results[u]) === b)!])
  );

  const body = orderedLabels
    .map((label) => {
      const urls = groups.get(label)!;
      return `── ${label} (${urls.length}) ──\n${urls.map(displayUrl).join("\n")}`;
    })
    .join("\n\n");

  return header + body;
}

const FORMAT_LABEL: Record<ReportFormat, string> = {
  grouped: "Agrupado por código",
  errors: "Solo errores",
  ok: "Solo exitosos",
  plain: "Lista simple",
};

export default function Home() {
  const [links, setLinks] = useState<string[]>([]);
  const [results, setResults] = useState<ResultsMap>({});
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [sort, setSort] = useState<SortState>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ReportFormat>("grouped");
  const [copyFeedback, setCopyFeedback] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/links");
    const data = await res.json();
    setLinks(data.links ?? []);
    setResults(data.results ?? {});
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000); // refresh view every minute
    return () => clearInterval(interval);
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newUrl.trim()) return;
    const res = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: newUrl.trim() }),
    });
    if (res.ok) {
      setNewUrl("");
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "No se pudo agregar el link");
    }
  }

  async function handleRemove(url: string) {
    if (!confirm(`¿Quitar ${url} del monitoreo?`)) return;
    await fetch(`/api/links?url=${encodeURIComponent(url)}`, { method: "DELETE" });
    load();
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      await fetch("/api/check");
      await load();
    } finally {
      setChecking(false);
    }
  }

  async function openReport(url: string) {
    setReportFor(url);
    setReport(null);
    setReportLoading(true);
    try {
      const res = await fetch(`/api/report?url=${encodeURIComponent(url)}`);
      setReport(await res.json());
    } finally {
      setReportLoading(false);
    }
  }

  function toggleSort(key: SortKey) {
    setSort((current) => nextSort(current, key));
  }

  // ponytail: quick-filter chips are derived from what's actually in `results`
  // (not a hardcoded list) so a code that never shows up (say 429) doesn't
  // clutter the toolbar, and one that does (say 403) always gets its own chip.
  const chips = useMemo(() => {
    const codeCounts = new Map<number, number>();
    let ok = 0;
    let pending = 0;
    for (const url of links) {
      const r = results[url];
      if (!r) { pending++; continue; }
      if (r.ok) { ok++; continue; }
      if (r.status !== null) codeCounts.set(r.status, (codeCounts.get(r.status) ?? 0) + 1);
    }
    const errorCodes = [...codeCounts.entries()].sort((a, b) => a[0] - b[0]);
    const errors = errorCodes.reduce((sum, [, n]) => sum + n, 0);
    return { ok, errors, pending, errorCodes };
  }, [links, results]);

  const filteredLinks = useMemo(() => getFilteredLinks(links, results, statusFilter), [links, results, statusFilter]);
  const visibleLinks = useMemo(() => getSortedLinks(filteredLinks, results, sort), [filteredLinks, results, sort]);

  const filterLabel = useMemo(() => {
    if (statusFilter === "all") return "Todos";
    if (statusFilter === "ok") return "Exitosos (2xx)";
    if (statusFilter === "errors") return "Errores";
    if (statusFilter === "pending") return "Sin datos";
    return `HTTP ${statusFilter.slice(5)}`;
  }, [statusFilter]);

  const reportText = useMemo(
    () => buildReportText(visibleLinks, results, exportFormat, filterLabel),
    [visibleLinks, results, exportFormat, filterLabel]
  );

  async function copyReportText() {
    await navigator.clipboard.writeText(reportText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }

  function downloadReportTxt() {
    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sitecheck-reporte-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = links.length;
  const up = chips.ok;
  const down = chips.errors;
  const pending = chips.pending;

  return (
    <div className="wrap">
      <h1>SiteCheck</h1>
      <p className="sub">Monitoreo automático cada 30 min · {total} sitios</p>

      <div className="summary">
        <div className="stat"><div className="n" style={{ color: "#35c07a" }}>{up}</div><div className="l">Arriba</div></div>
        <div className="stat"><div className="n" style={{ color: "#e5484d" }}>{down}</div><div className="l">Caídos</div></div>
        <div className="stat"><div className="n" style={{ color: "#8b93a1" }}>{pending}</div><div className="l">Sin chequear</div></div>
        <div className="stat"><div className="n">{total}</div><div className="l">Total</div></div>
      </div>

      <form className="toolbar" onSubmit={handleAdd}>
        <input
          type="url"
          placeholder="https://nuevo-sitio.com/"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          required
        />
        <button type="submit">Agregar link</button>
        <button type="button" onClick={handleCheckNow} disabled={checking}>
          {checking ? "Actualizando…" : "Actualizar ahora"}
        </button>
        <button type="button" className="secondary" onClick={() => setExportOpen(true)}>
          Exportar reporte
        </button>
      </form>

      <div className="chips">
        <button className={`chip ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>
          Todos <span className="chip-n">{total}</span>
        </button>
        <button className={`chip ok ${statusFilter === "ok" ? "active" : ""}`} onClick={() => setStatusFilter("ok")}>
          OK <span className="chip-n">{chips.ok}</span>
        </button>
        <button className={`chip down ${statusFilter === "errors" ? "active" : ""}`} onClick={() => setStatusFilter("errors")}>
          Errores <span className="chip-n">{chips.errors}</span>
        </button>
        {chips.errorCodes.map(([code, n]) => (
          <button
            key={code}
            className={`chip down ${statusFilter === `code-${code}` ? "active" : ""}`}
            onClick={() => setStatusFilter(`code-${code}`)}
          >
            {code} <span className="chip-n">{n}</span>
          </button>
        ))}
        <button className={`chip ${statusFilter === "pending" ? "active" : ""}`} onClick={() => setStatusFilter("pending")}>
          Sin datos <span className="chip-n">{chips.pending}</span>
        </button>
      </div>

      {loading ? (
        <p className="mini">Cargando…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("url")}>
                Sitio <span className="sort-ind">{sortIndicator(sort, "url")}</span>
              </th>
              <th className="sortable" onClick={() => toggleSort("status")}>
                Status <span className="sort-ind">{sortIndicator(sort, "status")}</span>
              </th>
              <th className="sortable" onClick={() => toggleSort("ms")}>
                Latencia <span className="sort-ind">{sortIndicator(sort, "ms")}</span>
              </th>
              <th className="sortable" onClick={() => toggleSort("checkedAt")}>
                Último check <span className="sort-ind">{sortIndicator(sort, "checkedAt")}</span>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleLinks.length === 0 && (
              <tr><td colSpan={5} className="mini" style={{ padding: "20px 8px" }}>Ningún sitio coincide con el filtro.</td></tr>
            )}
            {visibleLinks.map((url) => {
              const r = results[url];
              return (
                <tr key={url}>
                  <td className="url-cell">
                    <a href={url} target="_blank" rel="noreferrer">{displayUrl(url)}</a>
                  </td>
                  <td>
                    {!r ? (
                      <span className="badge pending">sin datos</span>
                    ) : r.ok ? (
                      <span className="badge ok">● {r.status}</span>
                    ) : (
                      <span className="badge down" title={r.error ?? ""}>● {r.status ?? "error"}</span>
                    )}
                  </td>
                  <td className="mini">{r ? `${r.ms} ms` : "—"}</td>
                  <td className="mini">{r ? new Date(r.checkedAt).toLocaleString("es-AR") : "—"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="secondary" onClick={() => openReport(url)}>Reporte</button>
                    <button className="secondary" onClick={() => handleRemove(url)}>Quitar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {reportFor && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Reporte: {reportFor}</strong>
            <button className="secondary" onClick={() => setReportFor(null)}>Cerrar</button>
          </div>
          {reportLoading && <p className="mini">Generando reporte (PageSpeed Insights)…</p>}
          {report && !reportLoading && (
            <>
              <p className="mini">
                Performance:{" "}
                <span className="score" style={{ background: scoreColor(report.performanceScore) + "22", color: scoreColor(report.performanceScore) }}>
                  {report.performanceScore ?? "N/A"}
                </span>{" "}
                · generado {new Date(report.generatedAt).toLocaleString("es-AR)}
              </p>
              <ul className="report-list">
                {report.suggestions.map((s, i) => <li key={i}>💡 {s}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {exportOpen && (
        <div className="modal-overlay" onClick={() => setExportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Exportar reporte</strong>
              <button className="secondary" onClick={() => setExportOpen(false)}>Cerrar</button>
            </div>

            <div className="modal-controls">
              <label className="mini">
                Formato:{" "}
                <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ReportFormat)}>
                  {(Object.keys(FORMAT_LABEL) as ReportFormat[]).map((f) => (
                    <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
                  ))}
                </select>
              </label>
              <span className="mini">Filtro activo: {filterLabel} · {visibleLinks.length} sitio(s)</span>
            </div>

            <textarea className="report-text" readOnly value={reportText} />

            <div className="modal-actions">
              <button onClick={copyReportText}>{copyFeedback ? "Reporte copiado ✓" : "Copiar reporte"}</button>
              <button className="secondary" onClick={downloadReportTxt}>Descargar TXT</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
