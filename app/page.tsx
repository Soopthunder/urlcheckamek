"use client";

import { useEffect, useState, useCallback } from "react";

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

function scoreColor(score: number | null) {
  if (score === null) return "#8b93a1";
  if (score >= 90) return "#35c07a";
  if (score >= 50) return "#e0a63c";
  return "#e5484d";
}

export default function Home() {
  const [links, setLinks] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

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

  const total = links.length;
  const checkedResults = links.map((l) => results[l]).filter(Boolean) as CheckResult[];
  const up = checkedResults.filter((r) => r.ok).length;
  const down = checkedResults.filter((r) => !r.ok).length;
  const pending = total - checkedResults.length;

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
        <button type="button" className="secondary" onClick={handleCheckNow} disabled={checking}>
          {checking ? "Chequeando…" : "Chequear ahora"}
        </button>
      </form>

      {loading ? (
        <p className="mini">Cargando…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Sitio</th>
              <th>Status</th>
              <th>Latencia</th>
              <th>Último check</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.map((url) => {
              const r = results[url];
              return (
                <tr key={url}>
                  <td className="url-cell">
                    <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, "")}</a>
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
                · generado {new Date(report.generatedAt).toLocaleString("es-AR")}
              </p>
              <ul className="report-list">
                {report.suggestions.map((s, i) => <li key={i}>💡 {s}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
