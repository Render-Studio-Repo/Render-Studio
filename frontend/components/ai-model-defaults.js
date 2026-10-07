/** Text/reasoning default. Audio, image and other specialized endpoints keep their own models. */
export const DEFAULT_AI_MODEL = "gpt-6-astra";
/** Cheap ChatGPT HTTP model for guests / no key. */
export const CHEAP_CHAT_MODEL = "gpt-5.6-luna";
export const CHEAP_CHAT_MODEL_LABEL = "GPT-5.6 Luna";
export const ASTRA_MODEL_OPTIONS = Object.freeze([
  { value: DEFAULT_AI_MODEL, label: "GPT-6 Astra" },
  { value: "gpt-6.1-sol", label: "GPT-6.1 Sol · $2/$10" },
  { value: "gpt-6-astra-pro", label: "GPT-6 Astra Pro" },
]);
export function defaultTextModel(options = [], current = "") {
  return options.find(o => o.value === DEFAULT_AI_MODEL)?.value || options.find(o => o.value === current)?.value || options[0]?.value || current || DEFAULT_AI_MODEL;
}
