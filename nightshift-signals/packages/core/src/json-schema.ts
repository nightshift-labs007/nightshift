import { z } from "zod";
import { Basket, BasketLeg } from "./schemas/basket";
import { Grade } from "./schemas/grade";
import { Commit, PriceBar1m, Token } from "./schemas/market";
import { Event, Headline, Source, Triage } from "./schemas/news";
import { Delivery, Position, Trigger, TriggerRule, User } from "./schemas/user";

/** Public object schemas, exported as JSON Schema for agents and API docs. */
export const PUBLIC_SCHEMAS = {
  Source,
  Headline,
  Triage,
  Event,
  BasketLeg,
  Basket,
  Token,
  PriceBar1m,
  Commit,
  Grade,
  User,
  TriggerRule,
  Trigger,
  Position,
  Delivery,
} as const;

export function toJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(PUBLIC_SCHEMAS).map(([name, schema]) => [name, z.toJSONSchema(schema, { unrepresentable: "any" })]),
  );
}
