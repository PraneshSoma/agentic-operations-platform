#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(LOOP_ROOT, "..");
const MANIFEST_PATH = join(REPO_ROOT, "context", "composite-context.json");

function parseArgs(argv) {
  const args = { stdout: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--stdout") args.stdout = true;
    else if (arg === "--stage") args.stage = argv[++index];
    else if (arg === "--story") args.story = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.stage)
    throw new Error(
      "Usage: build-context-packet.mjs --stage <agent> [--story <id>] [--stdout|--output <path>]",
    );
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function describeFile(path, source) {
  const stats = statSync(path);
  return {
    path: relative(REPO_ROOT, path),
    layer: source.layer,
    authority: source.authority,
    purpose: source.purpose,
    bytes: stats.size,
    sha256: sha256(path),
  };
}

function matchesSimplePattern(name, pattern) {
  if (!pattern) return true;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

function resolveSource(source) {
  const absolute = join(REPO_ROOT, source.path);
  if (!existsSync(absolute)) return { files: [], missing: [source.path] };
  if (source.kind !== "directory")
    return { files: [describeFile(absolute, source)], missing: [] };

  const files = readdirSync(absolute)
    .filter((name) => matchesSimplePattern(name, source.include))
    .sort()
    .map((name) => describeFile(join(absolute, name), source));
  return {
    files,
    missing: files.length ? [] : [`${source.path}/${source.include ?? "*"}`],
  };
}

function loadStory(storyId) {
  if (!storyId) return undefined;
  const queue = readJson(join(REPO_ROOT, "pipeline", "story_queue.json"));
  const story = queue.stories.find((candidate) => candidate.id === storyId);
  if (!story)
    throw new Error(
      `Story ${storyId} was not found in pipeline/story_queue.json`,
    );
  return story;
}

function dynamicSourceKeys(story) {
  if (!story) return [];
  const text = JSON.stringify(story);
  const keys = new Set();
  if (/§\d|spec\s|AOP-001/i.test(text)) keys.add("implementation_spec");
  if (/LLD/i.test(text)) keys.add("lld");
  if (/\b(?:F|NFR)-\d+/i.test(text)) keys.add("requirements");
  return [...keys];
}

function dynamicAdrFiles(story) {
  if (!story) return [];
  const refs = [
    ...new Set(JSON.stringify(story).match(/ADR-\d{3}/g) ?? []),
  ].sort();
  return refs
    .map((ref) => join(REPO_ROOT, "pipeline", "adr", `${ref}.md`))
    .filter(existsSync);
}

function localArtifact(path, purpose) {
  if (!existsSync(path)) return undefined;
  return describeFile(path, {
    layer: "story_context",
    authority: "generated_artifact",
    purpose,
  });
}

function buildPacket(args) {
  const manifest = readJson(MANIFEST_PATH);
  const manifestHash = sha256(MANIFEST_PATH);
  const route = manifest.routes[args.stage];
  if (!route)
    throw new Error(
      `Unknown stage '${args.stage}'. Expected one of: ${Object.keys(manifest.routes).join(", ")}`,
    );
  if (route.story_specific && !args.story)
    throw new Error(`Stage '${args.stage}' requires --story <id>`);

  const story = loadStory(args.story);
  const sourceKeys = [
    ...new Set([
      ...(route.required ?? []),
      ...(route.dynamic_story_references ? dynamicSourceKeys(story) : []),
    ]),
  ];
  const sources = [];
  const missing = [];

  for (const key of sourceKeys) {
    const source = manifest.source_registry[key];
    if (!source)
      throw new Error(
        `Manifest route '${args.stage}' references unknown source '${key}'`,
      );
    const resolved = resolveSource(source);
    sources.push(...resolved.files.map((file) => ({ key, ...file })));
    missing.push(...resolved.missing.map((path) => ({ key, path })));
  }

  for (const path of dynamicAdrFiles(story)) {
    if (!sources.some((source) => source.path === relative(REPO_ROOT, path))) {
      sources.push({
        key: basename(path, ".md").toLowerCase(),
        ...describeFile(path, {
          layer: "delivery_context",
          authority: "accepted_decision",
          purpose: "Architecture decision explicitly referenced by this story",
        }),
      });
    }
  }

  if (story && route.include_planning_context) {
    const artifact = localArtifact(
      join(REPO_ROOT, "pipeline", story.id, "planning_context.json"),
      "Approved story decomposition",
    );
    if (artifact) sources.push({ key: "planning_context", ...artifact });
    else
      missing.push({
        key: "planning_context",
        path: `pipeline/${story.id}/planning_context.json`,
      });
  }

  if (story && route.include_pr_summary) {
    const artifact = localArtifact(
      join(REPO_ROOT, "pipeline", story.id, "pr_summary.md"),
      "Story implementation and test audit summary",
    );
    if (artifact) sources.push({ key: "pr_summary", ...artifact });
  }

  const cacheMaterial = {
    manifestHash,
    stage: args.stage,
    story,
    sources: sources.map(({ path, sha256: sourceHash }) => ({
      path,
      sourceHash,
    })),
    invariants: manifest.always_on_invariants,
  };

  return {
    schema_version: manifest.schema_version,
    initiative: manifest.initiative,
    manifest: {
      path: relative(REPO_ROOT, MANIFEST_PATH),
      sha256: manifestHash,
    },
    generated_at: new Date().toISOString(),
    stage: args.stage,
    objective: route.objective,
    story: story
      ? {
          id: story.id,
          phase: story.phase,
          title: story.title,
          acceptance_criteria: story.acceptance_criteria,
          depends_on: story.depends_on,
          blocked_by: story.blocked_by,
          status: story.status,
        }
      : null,
    load_policy: {
      instruction:
        "Load sources in order. Start with orientation, then normative/approved sources. Do not scan the whole repository unless a required fact is missing; record that reason before expanding context.",
      cache_key: createHash("sha256")
        .update(JSON.stringify(cacheMaterial), "utf8")
        .digest("hex"),
    },
    sources,
    missing_sources: missing,
    always_on_invariants: manifest.always_on_invariants,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packet = buildPacket(args);
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  if (args.stdout) {
    process.stdout.write(json);
    if (packet.missing_sources.length) {
      process.stderr.write(
        `Missing required context sources: ${packet.missing_sources.map(({ path }) => path).join(", ")}\n`,
      );
      process.exitCode = 2;
    }
    return;
  }

  const defaultTarget = args.story
    ? join(REPO_ROOT, "pipeline", ".context", args.story, `${args.stage}.json`)
    : join(
        REPO_ROOT,
        "pipeline",
        ".context",
        "initiative",
        `${args.stage}.json`,
      );
  const target = args.output ? resolve(REPO_ROOT, args.output) : defaultTarget;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json);
  process.stdout.write(`${relative(REPO_ROOT, target)}\n`);
  if (packet.missing_sources.length) {
    process.stderr.write(
      `Missing required context sources: ${packet.missing_sources.map(({ path }) => path).join(", ")}\n`,
    );
    process.exitCode = 2;
  }
}

main();
