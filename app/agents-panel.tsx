"use client";

import { useEffect, useRef, useState } from "react";
import type { Hallazgo } from "@/lib/findings";

type AgentEvent = { agent?: string; kind: string; text?: string; url?: string; viewport?: string; captura?: string; hallazgo?: Hallazgo };
const COLOR_PRIORIDAD: Record<string, string> = { Crítica: "#e5484d", Alta: "#f0883e", Media: "#e0a63c", Baja: "#8b93a1" };
const ORIGEN: Record<string, string> = { medido: "medido", "ia-texto": "IA texto", "ia-visual": "IA visión" };
// capturas[url][viewport] = rutas relativas a proyectos/, en el orden en que se tomaron
type Capturas = Record<string, Record<string, string[]>>;
const img = (f: string) => `/api/captura?f=${encodeURIComponent(f)}`;
type Bubble = { agent: string; kind: string; text: string };
type Status = { ollama: boolean; modelo: string; modeloListo: boolean; vision: { disponible: boolean; motivo: string }; workspace: string };

const AGENTS: Record<string, { name: string; color: string }> = {
  extractor: { name: "Extractor", color: "#8b93a1" },
  analista: { name: "Analista · IA 1", color: "#5b8def" },
  revisor: { name: "Revisor · IA 2", color: "#e0a63c" },
  soluciones: { name: "Soluciones", color: "#35c07a" },
  sistema: { name: "Sistema", color: "#8b93a1" },
  inspector: { name: "Inspector visual · IA", color: "#c678dd" },
};

export default function AgentsPanel({ urls, onClose }: { urls: string[]; onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [project, setProject] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [running, setRunning] = useState(false);
  const [nota, setNota] = useState("");
  const [notaOk, setNotaOk] = useState(false);
  // visor: muestra las capturas de la misma sesión de Playwright que se está auditando
  const [vivo, setVivo] = useState<{ url: string; viewport: string; accion: string; log: string[] } | null>(null);
  const [capturas, setCapturas] = useState<Capturas>({});
  const [verUrl, setVerUrl] = useState<string | null>(null); // null = seguir en vivo
  const [verViewport, setVerViewport] = useState<string | null>(null);
  const [verCaptura, setVerCaptura] = useState<string | null>(null);
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
  const [pestana, setPestana] = useState<"chat" | "hallazgos">("chat");
  const [soloEsteTamano, setSoloEsteTamano] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then(setStatus).catch(() => {});
    return () => abortRef.current?.abort(); // closing the panel stops the agents
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [bubbles]);

  function push(e: AgentEvent) {
    if (e.kind === "browser") {
      const linea = `${e.viewport} · ${e.text}`;
      setVivo((v) => ({ url: e.url!, viewport: e.viewport!, accion: e.text!, log: [linea, ...(v?.log ?? [])].slice(0, 8) }));
      if (e.captura) {
        setCapturas((c) => ({
          ...c,
          [e.url!]: { ...c[e.url!], [e.viewport!]: [...(c[e.url!]?.[e.viewport!] ?? []), e.captura!] },
        }));
      }
      return; // los pasos del navegador van al visor, no al chat
    }
    if (e.kind === "hallazgo" && e.hallazgo) {
      setHallazgos((hs) => [...hs, e.hallazgo!]);
      return;
    }
    if (e.agent === "extractor") {
      setVivo((v) => v && { ...v, viewport: "todos", accion: "Navegación terminada · analizando con IA" });
    }
    setBubbles((b) => {
      if (e.kind === "token" && b.length) {
        const last = b[b.length - 1];
        return [...b.slice(0, -1), { ...last, text: last.text + (e.text ?? "") }];
      }
      if (e.kind === "start") return [...b, { agent: e.agent!, kind: e.kind, text: "" }];
      return [...b, { agent: e.agent ?? "sistema", kind: e.kind, text: e.text ?? "" }];
    });
  }

  async function run() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setBubbles([]);
    setCapturas({});
    setVivo(null);
    setVerUrl(null);
    setVerViewport(null);
    setVerCaptura(null);
    setHallazgos([]);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, project }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const l of lines) if (l.trim()) push(JSON.parse(l));
      }
    } catch (err) {
      if (!ctrl.signal.aborted) push({ kind: "error", text: String(err) });
    } finally {
      setRunning(false);
    }
  }

  async function addMemoria() {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoria: nota }),
    });
    if (res.ok) {
      setNota("");
      setNotaOk(true);
      setTimeout(() => setNotaOk(false), 2000);
    }
  }

  const ready = status?.ollama && status.modeloListo;

  // Qué muestra el visor: lo elegido a mano, o si no, lo último de la sesión en vivo.
  const urlVisor = verUrl ?? vivo?.url ?? null;
  const porViewport = urlVisor ? capturas[urlVisor] ?? {} : {};
  const vpVivo = urlVisor === vivo?.url && vivo && porViewport[vivo.viewport] ? vivo.viewport : undefined;
  const vpVisor = verViewport ?? vpVivo ?? Object.keys(porViewport).at(-1) ?? null;
  const tiras = vpVisor ? porViewport[vpVisor] ?? [] : [];
  const capturaVisor = verCaptura && tiras.includes(verCaptura) ? verCaptura : tiras[tiras.length - 1];
  const siguiendo = !verUrl && !verViewport && !verCaptura;

  return (
    <div className="modal-overlay">
      <div className="modal agents">
        <div className="modal-head">
          <strong>Auditoría con agentes · {urls.length} URL(s)</strong>
          <button className="secondary" onClick={onClose}>{running ? "Detener y cerrar" : "Cerrar"}</button>
        </div>

        {status && !status.ollama && (
          <p className="warn">
            Ollama no está corriendo. Instalalo desde ollama.com (o <code>winget install Ollama.Ollama</code>),
            abrilo y descargá el modelo: <code>ollama pull {status.modelo}</code>
          </p>
        )}
        {status?.ollama && status.modeloListo && (
          <p className={status.vision.disponible ? "mini" : "warn"}>
            {status.vision.disponible
              ? `Análisis visual por IA: activo (${status.vision.motivo})`
              : `Análisis visual por IA no disponible: ${status.vision.motivo}. Se auditan igual las mediciones por código.`}
          </p>
        )}
        {status?.ollama && !status.modeloListo && (
          <p className="warn">Falta el modelo. En una terminal: <code>ollama pull {status.modelo}</code></p>
        )}

        <div className="modal-controls">
          <input
            type="text"
            placeholder="Nombre del proyecto (ej: boden)"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            disabled={running}
          />
          <button onClick={run} disabled={running || !ready}>{running ? "Agentes trabajando…" : "Iniciar auditoría"}</button>
          <button
            className="secondary"
            onClick={() => fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"abrir":true}' })}
          >
            Abrir carpeta de agentes
          </button>
        </div>

        <div className="audit-grid">
        <div className="visor">
          {!urlVisor ? (
            <p className="mini">
              Acá vas a ver las capturas reales de la sesión del navegador mientras se audita cada URL,
              en cada tamaño de pantalla.
            </p>
          ) : (
            <>
              <div className="visor-head">
                <select
                  value={urlVisor}
                  onChange={(e) => { setVerUrl(e.target.value); setVerViewport(null); setVerCaptura(null); }}
                >
                  {Object.keys(capturas).map((u) => <option key={u} value={u}>{u.replace(/^https?:\/\//, "")}</option>)}
                </select>
                <select value={vpVisor ?? ""} onChange={(e) => { setVerViewport(e.target.value); setVerCaptura(null); }}>
                  {Object.keys(porViewport).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <button
                  className={siguiendo ? "" : "secondary"}
                  onClick={() => { setVerUrl(null); setVerViewport(null); setVerCaptura(null); }}
                >
                  {siguiendo ? "● En vivo" : "Volver a en vivo"}
                </button>
              </div>
              {running && vivo && (
                <p className="mini visor-accion">
                  <strong>{vivo.viewport}</strong> · {vivo.accion}
                </p>
              )}
              {capturaVisor && (
                <a href={img(capturaVisor)} target="_blank" rel="noreferrer" title="Abrir en tamaño real">
                  <img className="visor-img" src={img(capturaVisor)} alt={capturaVisor.split("/").pop()} />
                </a>
              )}
              <div className="tiras">
                {tiras.map((c) => (
                  <img
                    key={c}
                    src={img(c)}
                    alt={c.split("/").pop()}
                    title={c.split("/").pop()}
                    className={c === capturaVisor ? "activa" : ""}
                    onClick={() => { setVerUrl(urlVisor); setVerViewport(vpVisor); setVerCaptura(c); }}
                  />
                ))}
              </div>
              {running && vivo && <pre className="visor-log">{vivo.log.join("\n")}</pre>}
            </>
          )}
        </div>

        <div className="lado">
        <div className="pestanas">
          <button className={pestana === "chat" ? "" : "secondary"} onClick={() => setPestana("chat")}>Conversación</button>
          <button className={pestana === "hallazgos" ? "" : "secondary"} onClick={() => setPestana("hallazgos")}>
            Hallazgos ({hallazgos.length})
          </button>
          {pestana === "hallazgos" && vpVisor && (
            <label className="mini">
              <input type="checkbox" checked={soloEsteTamano} onChange={(e) => setSoloEsteTamano(e.target.checked)} /> solo {vpVisor}
            </label>
          )}
        </div>
        {pestana === "hallazgos" ? (
          <div className="lista-hallazgos">
            {!hallazgos.length && <p className="mini">Los hallazgos aparecen acá a medida que se generan.</p>}
            {hallazgos
              .filter((h) => !soloEsteTamano || h.viewports.includes("todos") || h.viewports.includes(vpVisor ?? ""))
              .map((h) => {
                // el recorte señala el problema exacto; si no hay, la pantalla completa
                const delTamano = (h.evidencia.capturas ?? []).filter((c) => !soloEsteTamano || c.includes(`/${vpVisor}_`));
                const captura = delTamano.find((c) => c.includes("_recorte-")) ?? delTamano[0] ?? h.evidencia.capturas?.[0];
                return (
                  <div
                    key={h.id}
                    className={`hallazgo ${captura ? "con-captura" : ""}`}
                    style={{ borderColor: COLOR_PRIORIDAD[h.prioridad] }}
                    onClick={() => {
                      if (!captura) return;
                      setVerUrl(h.url);
                      setVerViewport(captura.split("/").pop()!.split("_")[0]);
                      setVerCaptura(captura);
                    }}
                  >
                    <div className="h-meta">
                      <strong style={{ color: COLOR_PRIORIDAD[h.prioridad] }}>{h.prioridad}</strong> · {h.categoria} ·{" "}
                      <span className={`estado ${h.estado === "confirmado" ? "ok" : ""}`}>{h.estado}</span> · {ORIGEN[h.origen]} ·{" "}
                      {h.viewports.join(", ")} <span className="h-id">{h.id}</span>
                    </div>
                    <div>{h.descripcion}</div>
                    {h.evidencia.texto && (
                      <div className="cita">
                        «{h.evidencia.texto}»{h.correccion && <> → <strong>«{h.correccion}»</strong></>}
                      </div>
                    )}
                    {h.textoOtroIdioma && <div className="cita">otra versión: «{h.textoOtroIdioma}»</div>}
                    {h.evidencia.medicion && <div className="mini">{h.evidencia.medicion}</div>}
                    {h.ubicacion && <code className="mini">{h.ubicacion}</code>}
                    {captura && <div className="mini ver">📷 ver evidencia ({h.evidencia.capturas!.length})</div>}
                  </div>
                );
              })}
          </div>
        ) : (
        <div className="chat">
          {!bubbles.length && (
            <p className="mini">
              Navegador (Playwright) → Extractor → Analista (IA 1) ⇄ Revisor (IA 2) → Soluciones. Las reglas y prompts se editan en{" "}
              <code>{status?.workspace ?? "…"}</code>
            </p>
          )}
          {bubbles.map((b, i) => {
            const a = AGENTS[b.agent] ?? AGENTS.sistema;
            return (
              <div key={i} className={`bubble ${b.kind}`} style={{ borderColor: a.color }}>
                <div className="who" style={{ color: a.color }}>{a.name}</div>
                <pre>{b.kind === "done" ? `Reporte final guardado en:\n${b.text}` : b.text || "…"}</pre>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        )}
        </div>
        </div>

        <div className="modal-controls">
          <input
            type="text"
            placeholder='Memoria: ej. "El script de SynXis es correcto, no marcarlo como error"'
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
          <button className="secondary" onClick={addMemoria} disabled={!nota.trim()}>
            {notaOk ? "Guardado ✓" : "Agregar a memoria"}
          </button>
        </div>
      </div>
    </div>
  );
}
