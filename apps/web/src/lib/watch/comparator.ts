import {
  CandidateChange,
  SnapshotComparisonResult,
  SnapshotComparisonResultSchema,
} from "@overwatch/shared";

function getValueAtPath(obj: Record<string, unknown>, pathStr: string): unknown {
  const segments = pathStr
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = Number(seg);
      current = Number.isInteger(idx) ? current[idx] : undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Generic Snapshot Comparator:
 * Compares previous vs. current normalized snapshots across monitored field paths
 * without category-specific conclusions.
 * Identifies numeric shifts, new array items (deliveries/events), status changes,
 * missing/stale fields, and general field mutations.
 */
export function compareNormalizedSnapshots(params: {
  previousState: Record<string, unknown> | null;
  currentState: Record<string, unknown>;
  watchedFields?: string[];
}): SnapshotComparisonResult {
  const comparedAt = new Date().toISOString();

  if (!params.previousState) {
    return SnapshotComparisonResultSchema.parse({
      hasMeaningfulChanges: false,
      changes: [],
      comparedAt,
    });
  }

  const fieldsToInspect =
    params.watchedFields && params.watchedFields.length > 0
      ? params.watchedFields
      : Array.from(
          new Set([
            ...Object.keys(params.previousState),
            ...Object.keys(params.currentState),
          ])
        );

  const changes: CandidateChange[] = [];

  for (const fieldPath of fieldsToInspect) {
    const prevVal = getValueAtPath(params.previousState, fieldPath);
    const currVal = getValueAtPath(params.currentState, fieldPath);

    if (prevVal !== undefined && currVal === undefined) {
      changes.push({
        fieldPath,
        changeType: "MISSING_OR_STALE_DATA",
        previousValue: prevVal,
        currentValue: null,
        description: `Monitored field "${fieldPath}" became missing or undefined.`,
      });
      continue;
    }

    if (typeof prevVal === "number" && typeof currVal === "number") {
      if (Math.abs(currVal - prevVal) > 1e-6) {
        const delta = Number((currVal - prevVal).toFixed(4));
        changes.push({
          fieldPath,
          changeType: "NUMERIC_SHIFT",
          previousValue: prevVal,
          currentValue: currVal,
          description: `Numeric shift on "${fieldPath}": ${prevVal} -> ${currVal} (delta ${
            delta > 0 ? `+${delta}` : delta
          }).`,
        });
      }
      continue;
    }

    if (Array.isArray(prevVal) && Array.isArray(currVal)) {
      const prevJson = JSON.stringify(prevVal);
      const currJson = JSON.stringify(currVal);
      if (prevJson !== currJson) {
        const countDelta = currVal.length - prevVal.length;
        changes.push({
          fieldPath,
          changeType: "NEW_EVENT_OR_DELIVERY",
          previousValue: { count: prevVal.length, tail: prevVal.slice(-2) },
          currentValue: { count: currVal.length, tail: currVal.slice(-2) },
          description:
            countDelta > 0
              ? `${countDelta} new item(s) appended to "${fieldPath}" (total ${currVal.length}).`
              : `Collection "${fieldPath}" modified (previous count ${prevVal.length}, current count ${currVal.length}).`,
        });
      }
      continue;
    }

    if (typeof prevVal === "string" && typeof currVal === "string") {
      if (prevVal !== currVal) {
        const isStatusField = /status|state|phase/i.test(fieldPath);
        changes.push({
          fieldPath,
          changeType: isStatusField ? "STATUS_CHANGE" : "FIELD_MUTATION",
          previousValue: prevVal,
          currentValue: currVal,
          description: `${
            isStatusField ? "Status change" : "Field update"
          } on "${fieldPath}": "${prevVal}" -> "${currVal}".`,
        });
      }
      continue;
    }

    if (JSON.stringify(prevVal) !== JSON.stringify(currVal)) {
      changes.push({
        fieldPath,
        changeType: "FIELD_MUTATION",
        previousValue: prevVal ?? null,
        currentValue: currVal ?? null,
        description: `Structured field "${fieldPath}" changed.`,
      });
    }
  }

  return SnapshotComparisonResultSchema.parse({
    hasMeaningfulChanges: changes.length > 0,
    changes,
    comparedAt,
  });
}

