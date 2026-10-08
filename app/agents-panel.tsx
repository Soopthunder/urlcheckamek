"use client";

import { useEffect, useRef, useState } from "react";

type AgentEvent = { agent?: string; kind: string; text?: string };
type Bubble = { agent: string; kind: string; text: string };
type Status = { ollama: boolean; modelo: string; modeloListo: boolean; workspace: string };

const AGENTS: Record<string, { name: string; color: string }> = {
  extractor: { name: "Extractor", color: "#8b93a1" },
  analista: { name: "Analista · IA 1", color: "#5b8def" },
  revisor: { name: "Revisor · IA 2", color: "#e0a63c" },
  soluciones: { name: "Soluciones", color: "#35c07a" },
  sistema: { name: "Sistema", color: "#8b93a1" },
};

export default function AgentsPanel({ urls, onClose }: { urls: string[]; onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [project, setProject] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [running, setRunning] = useState(false);
  const [nota, setNota] = useState("");
  const [notaOk, setNotaOk] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then(setStatus).catch(() => {});
    return () => abortRef.current?.abort(); // closing the panel stops the agents
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [bubbles]);

  function push(e: AgentEvent) {
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

        <div className="chat">
          {!bubbles.length && (
            <p className="mini">
              Extractor → Analista (IA 1) ⇄ Revisor (IA 2) → Soluciones. Las reglas y prompts se editan en{" "}
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
