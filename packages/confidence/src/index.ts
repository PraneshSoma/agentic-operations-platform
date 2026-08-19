/**
 * @aop/confidence — the itemized confidence surface (spec §26, F-17,
 * story E-03). Assembles the five already-defined dimensions individually
 * from existing pipeline artifacts; there is deliberately no numeric
 * rollup, and no code path that could produce one — the itemized
 * dimensions are the entire confidence surface at this stage.
 */
export * from "./assemble-confidence-dimensions.js";
