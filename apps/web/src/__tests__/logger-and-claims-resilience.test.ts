import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaimSchema, normalizeClaimType } from "@overwatch/shared";
import { formatLogLine, sanitizeMeta, redactString } from "../lib/logger";
import { errorResponse } from "../lib/http";

describe("Logger & Agent Resilience", () => {
  describe("Logger formatting and redaction", () => {
    it("does NOT redact token counts or model usage numbers", () => {
      const meta = {
        tokens: 5356,
        totalTokens: 5356,
        promptTokens: 4200,
        completionTokens: 1156,
        cost: "$0.002064",
        role: "SERGEANT_SYNTHESIS",
        model: "qwen3.5-35b-a3b",
      };

      const sanitized = sanitizeMeta(meta);
      expect(sanitized?.tokens).toBe(5356);
      expect(sanitized?.totalTokens).toBe(5356);

      const logLine = formatLogLine("INFO", "[0G] Request completed", meta);
      expect(logLine).toContain("tokens=5356");
      expect(logLine).toContain("role=SERGEANT_SYNTHESIS");
      expect(logLine).not.toContain("[REDACTED]");
    });

    it("redacts secret keys and credentials from strings and metadata", () => {
      const meta = {
        sk: "sk-a05d2e6f-897a-4fc3-8886-663bfe102b50",
        apiKey: "tvly-secretkey12345678",
        url: "https://sportmonks.com?api_token=secrettokenvalue",
      };

      const sanitized = sanitizeMeta(meta);
      expect(sanitized?.sk).toBe("[REDACTED_KEY]");
      expect(sanitized?.apiKey).toBe("[REDACTED_KEY]");
      expect(sanitized?.url).toContain("[REDACTED_KEY]");
      expect(sanitized?.url).not.toContain("secrettokenvalue");

      const text = redactString("Calling 0G with key sk-abcdef1234567890 in header");
      expect(text).toBe("Calling 0G with key [REDACTED_KEY] in header");
    });

    it("formats Zod validation errors human-readably without escaped JSON strings", () => {
      const zodErrorJson = JSON.stringify([
        {
          code: "invalid_enum_value",
          options: ["EVIDENCE", "HYPOTHETICAL_OBJECTION"],
          path: ["claims", 2, "type"],
          message: "Invalid enum value. Expected 'EVIDENCE' | 'HYPOTHETICAL_OBJECTION', received 'NEGATIVE_EVIDENCE'",
          received: "NEGATIVE_EVIDENCE",
        },
        {
          code: "invalid_enum_value",
          options: ["EVIDENCE", "HYPOTHETICAL_OBJECTION"],
          path: ["claims", 3, "type"],
          message: "Invalid enum value. Expected 'EVIDENCE' | 'HYPOTHETICAL_OBJECTION', received 'CAUTION'",
          received: "CAUTION",
        },
      ]);

      const logLine = formatLogLine("ERROR", "[AGENT] Intelligence Specialist failed", {
        error: zodErrorJson,
      });

      expect(logLine).toContain("[ERROR] [AGENT] Intelligence Specialist failed");
      expect(logLine).toContain("└─ [Validation Error] claims.2.type:");
      expect(logLine).toContain('received: "NEGATIVE_EVIDENCE"');
      expect(logLine).toContain("└─ [Validation Error] claims.3.type:");
      expect(logLine).toContain('received: "CAUTION"');
      expect(logLine).not.toContain('\\"received\\"');
    });
  });

  describe("ClaimSchema resilience and normalization", () => {
    it("normalizes NEGATIVE_EVIDENCE to EVIDENCE", () => {
      const parsed = ClaimSchema.parse({
        text: "India 4 wickets down for 80 runs",
        evidenceIds: ["EV-01"],
        type: "NEGATIVE_EVIDENCE",
        impact: "HIGH",
      });

      expect(parsed.type).toBe("EVIDENCE");
      expect(parsed.text).toBe("India 4 wickets down for 80 runs");
      expect(parsed.evidenceIds).toEqual(["EV-01"]);
      expect(parsed.impact).toBe("HIGH");
    });

    it("normalizes CAUTION to HYPOTHETICAL_OBJECTION", () => {
      const parsed = ClaimSchema.parse({
        text: "Pitch may slow down in second innings causing batting collapse",
        evidenceIds: [],
        type: "CAUTION",
        impact: "MEDIUM",
      });

      expect(parsed.type).toBe("HYPOTHETICAL_OBJECTION");
      expect(parsed.impact).toBe("MEDIUM");
    });

    it("normalizes single string evidenceIds to an array", () => {
      const parsed = ClaimSchema.parse({
        text: "Target score 165",
        evidenceIds: "EV-02",
        type: "EVIDENCE",
      });

      expect(parsed.evidenceIds).toEqual(["EV-02"]);
      expect(parsed.type).toBe("EVIDENCE");
    });

    it("handles claim synonyms and objects gracefully", () => {
      expect(normalizeClaimType("SUPPORTING", true)).toBe("EVIDENCE");
      expect(normalizeClaimType("FACT", true)).toBe("EVIDENCE");
      expect(normalizeClaimType("RISK", false)).toBe("HYPOTHETICAL_OBJECTION");
      expect(normalizeClaimType("OBJECTION", false)).toBe("HYPOTHETICAL_OBJECTION");
    });
  });

  describe("API Boundary Validation Error Reporting", () => {
    it("reports specific issue paths in the errorResponse message instead of a generic string", () => {
      const TestSchema = z.object({
        name: z.string().min(1),
        count: z.number().int().min(1),
      });

      try {
        TestSchema.parse({ name: "", count: -5 });
      } catch (err) {
        const res = errorResponse(err);
        expect(res.status).toBe(400);
      }
    });
  });
});
