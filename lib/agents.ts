import { promises as fs } from "fs";
import path from "path";
import { extractFacts, senales, Senal } from "./extract";
import { getReport } from "./store";

// Carpeta editable por el usuario: AGENTS.md, contexto/, skills/, memoria/, proyectos/.
// La app de escritorio la copia a %APPDATA%/SiteCheck/workspace en el primer arranque.
export const WORKSPACE = process.env.WORKSPACE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "workspace");
export const OLLAMA = "http://127.0.0.1:11434";

export type AgentEvent = { agent?: string; kind: "start" | "token" | "message" | "info" | "error" | "done"; text?: string };
type Emit = (e: AgentEvent) => void;
type Msg = { role: "system" | "user" | "assistant"; content: string };

const read = (rel: string) => fs.readFile(path.join(WORKSPACE, rel), "utf-8").catch(() => "");

export async function getConfig(): Promise<{ modelo: string; rondasDebate: number; contexto: number }> {
  const cfg = JSON.parse((await read("config.json")) || "{}");
  return { modelo: "qwen2.5:7b", rondasDebate: 2, contexto: 16384, ...cfg };
}

// Prompt de sistema de cada agente = reglas generales + todo /contexto + memoria + su skill.
// Se relee en cada auditoría, así que editar los .md cambia el comportamiento sin reinstalar.
async function systemPrompt(skill: string) {
  const ctxFiles = await fs.readdir(path.join(WORKSPACE, "contexto")).catch(() => [] as string[]);
  const ctx = await Promise.all(ctxFiles.filter((f) => f.endsWith(".md")).map((f) => read(path.join("contexto", f))));
  return [
    await read("AGENTS.md"),
    ...ctx,
    "# Memoria del usuario (lo que figura acá NO es un error, no lo marques)\n" + (await read("memoria/memoria.md")),
    "# TU TAREA\n" + (await read(path.join("skills", skill))),
  ].join("\n\n---\n\n");
}

// Un turno de un agente contra Ollama, transmitiendo cada token a la UI.
async function chat(agent: string, messages: Msg[], emit: Emit, signal: AbortSignal): Promise<string> {
  const { modelo, contexto } = await getConfig();
  const res = await fetch(OLLAMA + "/api/chat", {
    method: "POST",
    signal,
    body: JSON.stringify({
      model: modelo,
      messages,
      stream: true,
      // ponytail: num_ctx explícito — el default de Ollama (2–4k) corta los prompts en
      // silencio y el agente "olvida" las reglas. 16k entra en 8 GB de VRAM con un 7B.
      options: { num_ctx: contexto, temperature: 0.2 },
    }),
  }).catch((err) => {
    if (signal.aborted) throw err;
    throw new Error("No se pudo conectar con Ollama en " + OLLAMA + " — ¿está abierto?");
  });
  if (!res.ok || !res.body) throw new Error(`Ollama respondió HTTP ${res.status}: ${await res.text()}`);

  emit({ agent, kind: "start" });
  let full = "";
  let buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines.filter((l) => l.trim())) {
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      const t: string = j.message?.content ?? "";
      if (t) {
        full += t;
        emit({ agent, kind: "token", text: t });
      }
    }
  }
  return full;
}

const tablaSenales = (s: Senal[]) =>
  s.length
    ? "| Prioridad | Área | Problema | Evidencia |\n|---|---|---|---|\n" +
      s.map((x) => `| ${x.prioridad} | ${x.area} | ${x.problema} | ${x.evidencia.replace(/\|/g, "/")} |`).join("\n")
    : "(ninguna: pasa todas las reglas medibles)";

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "_").slice(0, 60) || "general";

// Pipeline: Extractor (código) -> Analista (IA 1) <-> Revisor (IA 2) -> Soluciones.
// El Revisor puede devolverle el reporte al Analista con objeciones; discuten hasta
// que aprueba o se agotan las rondas de config.json.
export async function runAudit(urls: string[], project: string, emit: Emit, signal: AbortSignal) {
  const { modelo, rondasDebate } = await getConfig();
  const [sysAnalista, sysRevisor, sysSoluciones] = await Promise.all([
    systemPrompt("02_analisis_ia1.md"),
    systemPrompt("03_validacion_ia2.md"),
    systemPrompt("04_soluciones.md"),
  ]);
  emit({ agent: "sistema", kind: "info", text: `Proyecto "${project}" · ${urls.length} URL(s) · modelo ${modelo}` });

  const validados: string[] = [];
  for (const [i, url] of urls.entries()) {
    const raw = await extractFacts(url);
    const facts = { ...raw, pagespeed: (await getReport(url)) ?? undefined };
    const factsJson = JSON.stringify(facts, null, 2);
    const tabla = tablaSenales(senales(raw));
    emit({ agent: "extractor", kind: "message", text: `[${i + 1}/${urls.length}] ${url}\n\nSeñales medidas:\n${tabla}\n\nDatos:\n${factsJson}` });

    const datos =
      `URL: ${url}\n\n## Señales medidas por código (verificadas, prioridad ya asignada)\n${tabla}\n\n` +
      `## Datos extraídos (única fuente de verdad)\n\`\`\`json\n${factsJson}\n\`\`\``;
    const analista: Msg[] = [{ role: "system", content: sysAnalista }, { role: "user", content: datos }];
    let reporte = await chat("analista", analista, emit, signal);
    let revision = "";

    for (let ronda = 1; ronda <= rondasDebate; ronda++) {
      revision = await chat("revisor", [
        { role: "system", content: sysRevisor },
        { role: "user", content: `${datos}\n\nReporte preliminar del Analista (ronda ${ronda} de ${rondasDebate}):\n${reporte}` },
      ], emit, signal);
      if (!/VEREDICTO:\s*\**\s*DEVOLVER/i.test(revision) || ronda === rondasDebate) break;
      analista.push(
        { role: "assistant", content: reporte },
        { role: "user", content: `El Revisor (IA 2) objetó tu reporte:\n\n${revision}\n\nRehacé el reporte respondiendo a cada objeción. Si una objeción es incorrecta según los datos, defendé tu hallazgo citando el dato.` },
      );
      reporte = await chat("analista", analista, emit, signal);
    }
    // ponytail: the measured signals skip the LLM round-trip entirely — a 7B reviewer
    // was silently dropping verified rows. The Revisor only judges the Analista's additions.
    validados.push(`## ${url}\n\n### Señales medidas (verificadas)\n${tabla}\n\n${revision.split(/###\s*Descartados/i)[0].trim()}`);
  }

  const final = await chat("soluciones", [
    { role: "system", content: sysSoluciones },
    { role: "user", content: `Hallazgos validados (señales medidas + hallazgos adicionales aprobados por el Revisor):\n\n${validados.join("\n\n")}` },
  ], emit, signal);

  const dir = path.join(WORKSPACE, "proyectos", slug(project));
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, "-");
  const file = path.join(dir, `reporte_final_priorizado_${stamp}.md`);
  await fs.writeFile(file, `# Reporte de auditoría — ${project}\n\n_${new Date().toLocaleString("es-AR")} · ${modelo}_\n\nURLs: ${urls.join(", ")}\n\n${final}\n`);
  emit({ agent: "sistema", kind: "done", text: file });
}
