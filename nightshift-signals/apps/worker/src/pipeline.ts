import type { Deps } from "./deps";
import { ALERTS, onDrift, onTriagedForTriggers } from "./stages/alerts";
import { COMMITTER, onBasketSized } from "./stages/commit";
import { DEDUPE, onHeadlineIngested } from "./stages/dedupe";
import { MAPPER, onEventTriaged } from "./stages/map";
import { onBasketCommitted, PUBLISHER } from "./stages/publish";
import { onBasketProposed, SIZER } from "./stages/size";
import { onEventClustered, TRIAGE } from "./stages/triage";

/** Wires every stage to the bus. Each stage is its own consumer group. */
export function registerPipeline(deps: Deps): void {
  deps.bus.subscribe("headline.ingested", { group: DEDUPE }, (e) => onHeadlineIngested(deps, e));
  deps.bus.subscribe("event.clustered", { group: TRIAGE }, (e) => onEventClustered(deps, e));
  deps.bus.subscribe("event.triaged", { group: MAPPER }, (e) => onEventTriaged(deps, e));
  deps.bus.subscribe("basket.proposed", { group: SIZER }, (e) => onBasketProposed(deps, e));
  deps.bus.subscribe("basket.sized", { group: COMMITTER }, (e) => onBasketSized(deps, e));
  deps.bus.subscribe("basket.committed", { group: PUBLISHER }, (e) => onBasketCommitted(deps, e));
  deps.bus.subscribe("event.triaged", { group: ALERTS }, (e) => onTriagedForTriggers(deps, e));
  deps.bus.subscribe("alert.drift", { group: ALERTS }, (e) => onDrift(deps, e));
}
