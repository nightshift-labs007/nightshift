// Single source of truth for schemas, ids, enums and canonical JSON.

export * from "./enums";
export * from "./ids";
export * from "./primitives";
export * from "./canonical";
export * from "./events";
export * from "./bus";
export * from "./constants";
export * from "./market";
export * from "./fairvalue";
export * from "./weights";
export * from "./prices";
export * from "./grading";
export * from "./links";
export * from "./triggers";
export * from "./social";
export * from "./push";
export * from "./json-schema";
export * from "./schemas/news";
export * from "./schemas/basket";
export * from "./schemas/market";
export * from "./schemas/grade";
export * from "./schemas/user";

export const SERVICES = [
  "ingest",
  "dedupe",
  "triage",
  "mapper",
  "sizer",
  "committer",
  "publisher",
  "grader",
] as const;
export type Service = (typeof SERVICES)[number];
