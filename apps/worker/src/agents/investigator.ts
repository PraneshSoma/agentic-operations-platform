import {
  InvestigationResultSchema,
  type ContextPackage,
  type IncomingRequest,
  type InvestigationResult,
  type LLMProvider,
  type OperationalProcedureContract,
} from "@aop/contracts";

/**
 * Thrown when the Investigator's output references an evidence_id that
 * doesn't trace back to the supplied ContextPackage — spec §11's rule,
 * enforced structurally: "The agent may not invent connector results.
 * Every factual operational claim must trace to evidence." A Zod schema
 * alone cannot check this (it has no way to know what evidence actually
 * exists) — this is a second, semantic validation pass on top of the
 * schema pass.
 */
export class InventedEvidenceError extends Error {
  constructor(public readonly invented_evidence_ids: readonly string[]) {
    super(
      `Investigator referenced evidence_id(s) not present in the ContextPackage — ` +
        `no invented connector results are permitted (spec §11): ${invented_evidence_ids.join(", ")}`,
    );
    this.name = "InventedEvidenceError";
  }
}

/**
 * The known evidence_id universe for one ContextPackage. Scope decision:
 * RuntimeContext.logs.evidence_refs (spec §8.1) is the only field
 * ContextPackage carries that is literally typed as a list of evidence
 * references — this MVP-scope grounding check validates against that.
 * A full Evidence Ledger cross-check (confirming each id also resolves to
 * a real persisted Evidence row) is E-01's job once real persistence
 * exists; this function's contract stays the same either way.
 */
function knownEvidenceIds(contextPackage: ContextPackage): Set<string> {
  return new Set(contextPackage.runtime_context.logs.evidence_refs);
}

function collectReferencedEvidenceIds(result: InvestigationResult): Set<string> {
  const ids = new Set<string>();
  for (const observation of result.observations) {
    for (const id of observation.evidence_ids) ids.add(id);
  }
  for (const hypothesis of result.hypotheses) {
    for (const id of hypothesis.supporting_evidence_ids) ids.add(id);
    for (const id of hypothesis.contradicting_evidence_ids) ids.add(id);
  }
  for (const id of result.diagnosis.evidence_ids) ids.add(id);
  return ids;
}

function buildSystemPrompt(opc: OperationalProcedureContract, evidenceIds: ReadonlySet<string>): string {
  return [
    `You are the Investigator agent for the Operational Procedure Contract "${opc.name}" (${opc.opc_id}).`,
    `Objective: ${opc.investigation.objective}`,
    `Required checks: ${opc.investigation.required_checks.join(", ") || "(none declared)"}`,
    `Maximum hypotheses: ${opc.investigation.max_hypotheses}`,
    "",
    "You may reference ONLY the following evidence_id values — never invent one:",
    evidenceIds.size > 0 ? [...evidenceIds].join(", ") : "(none available)",
    "",
    "Respond with a single JSON object matching the InvestigationResult schema exactly " +
      "(observations, hypotheses, diagnosis, missing_information, recommended_next_step). " +
      "Every evidence_ids/supporting_evidence_ids/contradicting_evidence_ids entry must be " +
      "one of the evidence_id values listed above.",
  ].join("\n");
}

function buildUserPrompt(incomingRequest: IncomingRequest, contextPackage: ContextPackage): string {
  return JSON.stringify(
    {
      request: { subject: incomingRequest.subject, description: incomingRequest.description, labels: incomingRequest.labels },
      context: {
        application: contextPackage.application_context,
        runtime: contextPackage.runtime_context,
        historical_evidence: contextPackage.historical_evidence,
        missing_context: contextPackage.missing_context,
        stale_context: contextPackage.stale_context,
      },
    },
    null,
    2,
  );
}

export interface RunInvestigationInput {
  incomingRequest: IncomingRequest;
  opc: OperationalProcedureContract;
  contextPackage: ContextPackage;
  llmProvider: LLMProvider;
}

/**
 * runInvestigation — spec §11's Investigator Agent (story B-05). Calls
 * the injected LLMProvider, validates the response against
 * InvestigationResultSchema, then runs the evidence-grounding check —
 * rejecting the result outright (throwing InventedEvidenceError) rather
 * than silently stripping invented evidence_ids, since a diagnosis built
 * partly on invented evidence is not a diagnosis this platform can trust
 * with a lesser fix.
 */
export async function runInvestigation(input: RunInvestigationInput): Promise<InvestigationResult> {
  const evidenceIds = knownEvidenceIds(input.contextPackage);

  const completion = await input.llmProvider.complete({
    systemPrompt: buildSystemPrompt(input.opc, evidenceIds),
    userPrompt: buildUserPrompt(input.incomingRequest, input.contextPackage),
  });

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(completion.text);
  } catch {
    throw new Error(`Investigator response was not valid JSON: ${completion.text.slice(0, 200)}`);
  }

  const parsed = InvestigationResultSchema.safeParse(rawParsed);
  if (!parsed.success) {
    throw new Error(`Investigator response failed InvestigationResult validation: ${parsed.error.message}`);
  }

  const referenced = collectReferencedEvidenceIds(parsed.data);
  const invented = [...referenced].filter((id) => !evidenceIds.has(id));
  if (invented.length > 0) {
    throw new InventedEvidenceError(invented);
  }

  return parsed.data;
}
