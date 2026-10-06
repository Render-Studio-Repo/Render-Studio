/** Selection is independent of MCP listening and microphone ownership. */
import { DEFAULT_AI_MODEL } from "../components/ai-model-defaults.js?v=astra-default1&astraoffice=20260917-1&gpt61sol=20261001-1";
export const OFFICE_AGENTS = Object.freeze([
  { id: "astra", name: "Astra", role: "Project assistant", color: 0x57d9b5 },
  { id: "cursor-engineer", name: "Cursor", role: "Engineering", color: 0x78b7eb },
  { id: "project-manager", name: "PM", role: "Project planning", color: 0xe7c76d },
  { id: "vibe-rnd", name: "RnD", role: "Research", color: 0x94c681 },
  { id: "instruction-auditor", name: "Auditor", role: "Review", color: 0xb6c2cb },
  { id: "analytics", name: "Analytics", role: "Data and evidence", color: 0x69c5cb, charts: true },
  { id: "vibe-marketing", name: "Marketing", role: "Marketing", color: 0xec9ca6 },
  { id: "comms", name: "Comms", role: "Communications", color: 0xbeb0dd },
  { id: "vibe-sales", name: "Sales", role: "Customer discovery", color: 0xd4b97b },
  { id: "cad-bot", name: "CAD bot", role: "Open/shut, click, tolerance", color: 0x7ee787 },
  { id: "clip-bot", name: "Clip-bot", role: "Media", color: 0x94b1c7 },
  { id: "ledger", name: "Ledger", role: "Task records", color: 0xa3c1b5 },
  { id: "printer-bot", name: "Print-bot", role: "3D printer setup and monitor", color: 0xc4785b },
].map(Object.freeze));
const aliases = { cursor: "cursor-engineer", pm: "project-manager", rnd: "vibe-rnd", auditor: "instruction-auditor", mkt: "vibe-marketing", sales: "vibe-sales", clip: "clip-bot", printer: "printer-bot", cad: "cad-bot" };
let selected = "astra";
const listeners = new Set();
export const agentById = id => OFFICE_AGENTS.find(a => a.id === (aliases[id] || id));
export const activeOfficeAgent = () => agentById(selected);
export function selectedAstraModel(storage = globalThis.localStorage) {
  try { return storage?.getItem?.("render3d.sandbox.astraModel") === "gpt-6-astra-pro" ? "gpt-6-astra-pro" : DEFAULT_AI_MODEL; }
  catch { return DEFAULT_AI_MODEL; }
}
export function officeModelLabel(agent = activeOfficeAgent()) {
  return agent.id === "astra" ? `${selectedAstraModel()} (selected)` : "Model not reported";
}
export function selectOfficeAgent(id) {
  const agent = agentById(id);
  if (!agent) return activeOfficeAgent();
  if (agent.id !== selected) {
    selected = agent.id;
    for (const fn of listeners) fn(agent);
  }
  return agent;
}
export function onOfficeAgentChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function openOfficeAgent(id = selected) {
  const agent = selectOfficeAgent(id);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("render3d-sandbox-open-agent", { detail: { agent: agent.id } }));
  return agent;
}
