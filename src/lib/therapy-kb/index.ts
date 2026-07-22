// Therapy knowledge base — public surface.
export { MODALITIES, TECHNIQUES } from "./catalog";
export type { TherapyTechnique, TherapyModality, TechniqueCategory } from "./catalog";
export { selectTechniques, techniqueAllowed, buildTechniqueBlock } from "./select";
export type { SelectionInputs, SelectedTechnique } from "./select";
export { THERAPY_KB_RULES } from "./signoff";
