import { z } from "zod";
import {
  EvidenceRecord,
  EvidenceRecordSchema,
  MarketMetadata,
  ToolDefinition,
  ToolOperationName,
  ToolOperationNameSchema,
} from "@overwatch/shared";
import { getCanonicalMarketMetadata } from "../markets/store";
import { prepareMarketCricketData } from "./cricket-sportmonks";
import { executeSafeWebFetchPage, executeWebSearch } from "./web-tools";

const MarketGetMetadataArgsSchema = z.object({
  marketId: z.string().min(1),
});

const CricketGetFixtureDataArgsSchema = z.object({
  fixtureId: z.number().int().positive(),
  include: z.array(z.string()).optional(),
});

const WebSearchArgsSchema = z.object({
  query: z.string().min(2).max(300),
  maxResults: z.number().int().min(1).max(5).optional(),
});

const WebFetchPageArgsSchema = z.object({
  url: z.string().url(),
});

export const APPROVED_TOOL_DEFINITIONS: Record<
  ToolOperationName,
  ToolDefinition
> = {
  "market.get_metadata": {
    type: "function",
    function: {
      name: "market.get_metadata",
      description:
        "Retrieves canonical cricket market metadata, resolution criteria, opening/resolution times, and verified Sportmonks fixture ID.",
      parameters: {
        type: "object",
        properties: {
          marketId: {
            type: "string",
            description: "The canonical market identifier (e.g. 'ind-nz-over-15').",
          },
        },
        required: ["marketId"],
        additionalProperties: false,
      },
    },
  },
  "cricket.get_fixture_data": {
    type: "function",
    function: {
      name: "cricket.get_fixture_data",
      description:
        "Retrieves normalized real Sportmonks cricket fixture state, innings scorecards, lineups, and ball-by-ball deliveries.",
      parameters: {
        type: "object",
        properties: {
          fixtureId: {
            type: "integer",
            description: "Verified Sportmonks fixture ID from market metadata.",
          },
          include: {
            type: "array",
            items: { type: "string" },
            description:
              "Validated Sportmonks includes (e.g. ['runs','batting','bowling','lineup','balls','venue']).",
          },
        },
        required: ["fixtureId"],
        additionalProperties: false,
      },
    },
  },
  "web.search": {
    type: "function",
    function: {
      name: "web.search",
      description:
        "Searches recent news, pitch conditions, weather updates, and match intelligence via Tavily.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused search query string.",
          },
          maxResults: {
            type: "integer",
            description: "Maximum search results to retrieve (1-5).",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  "web.fetch_page": {
    type: "function",
    function: {
      name: "web.fetch_page",
      description:
        "Safely fetches and extracts readable text from a verified public HTTPS URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Public https:// URL to fetch and extract.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
};

export class EvidenceCollector {
  private counter = 0;
  private readonly records = new Map<string, EvidenceRecord>();

  public constructor(initialEvidence?: Record<string, EvidenceRecord>) {
    if (initialEvidence) {
      for (const [id, rec] of Object.entries(initialEvidence)) {
        this.records.set(id, rec);
        const match = id.match(/^EV-(\d+)$/);
        if (match && match[1]) {
          const num = Number(match[1]);
          if (num > this.counter) {
            this.counter = num;
          }
        }
      }
    }
  }

  public addRecord(params: {
    toolOperation: ToolOperationName;
    sourceUrlOrOrigin: string;
    title?: string;
    summary?: string;
    extractedData: unknown;
  }): EvidenceRecord {
    this.counter += 1;
    const evidenceId = `EV-${String(this.counter).padStart(2, "0")}`;
    const record: EvidenceRecord = EvidenceRecordSchema.parse({
      evidenceId,
      toolOperation: params.toolOperation,
      sourceUrlOrOrigin: params.sourceUrlOrOrigin,
      retrievedAt: new Date().toISOString(),
      title: params.title,
      summary: params.summary,
      extractedData: params.extractedData,
    });
    this.records.set(evidenceId, record);
    return record;
  }

  public has(evidenceId: string): boolean {
    return this.records.has(evidenceId);
  }

  public get(evidenceId: string): EvidenceRecord | undefined {
    return this.records.get(evidenceId);
  }

  public toMap(): Record<string, EvidenceRecord> {
    return Object.fromEntries(this.records.entries());
  }

  public values(): EvidenceRecord[] {
    return Array.from(this.records.values());
  }
}

export interface ToolExecutionOptions {
  activeMarket?: MarketMetadata;
}

export class ToolRegistry {
  public constructor(
    private readonly evidenceCollector: EvidenceCollector,
    private readonly options?: ToolExecutionOptions
  ) {}

  public getToolDefinitions(allowedOperations: ToolOperationName[]): ToolDefinition[] {
    return allowedOperations
      .filter((name) => APPROVED_TOOL_DEFINITIONS[name])
      .map((name) => APPROVED_TOOL_DEFINITIONS[name]);
  }

  public async executeToolCall(
    rawToolName: string,
    rawArgumentsJson: string,
    allowedForCaller?: ToolOperationName[]
  ): Promise<{
    evidenceRecord: EvidenceRecord;
    serializedModelOutput: string;
  }> {
    const normalizedName = rawToolName.replace(/__/g, ".");
    const parsedName = ToolOperationNameSchema.safeParse(normalizedName);
    if (!parsedName.success) {
      throw new Error(`Unapproved or unknown tool operation: "${rawToolName}"`);
    }
    const operation = parsedName.data;

    if (allowedForCaller && !allowedForCaller.includes(operation)) {
      throw new Error(
        `Caller is not permitted to invoke tool "${operation}". Allowed: ${allowedForCaller.join(
          ", "
        )}`
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = rawArgumentsJson ? JSON.parse(rawArgumentsJson) : {};
    } catch {
      throw new Error(
        `Invalid JSON arguments for tool "${operation}": ${rawArgumentsJson}`
      );
    }

    switch (operation) {
      case "market.get_metadata": {
        const args = MarketGetMetadataArgsSchema.parse(parsedJson);
        const metadata =
          this.options?.activeMarket &&
          this.options.activeMarket.marketId === args.marketId
            ? this.options.activeMarket
            : await getCanonicalMarketMetadata(args.marketId);
        if (!metadata) {
          throw new Error(`Market not found for marketId="${args.marketId}"`);
        }
        const summary = `${metadata.question} | Fixture #${metadata.fixtureId} (${metadata.homeTeam} vs ${metadata.awayTeam}) | Format: ${metadata.matchFormat} | Status: ${metadata.status}`;
        const record = this.evidenceCollector.addRecord({
          toolOperation: "market.get_metadata",
          sourceUrlOrOrigin: `overwatch://markets/${metadata.marketId}`,
          title: `Canonical Cricket Market Metadata (${metadata.marketId})`,
          summary,
          extractedData: metadata,
        });
        return {
          evidenceRecord: record,
          serializedModelOutput: JSON.stringify({
            evidenceId: record.evidenceId,
            toolOperation: record.toolOperation,
            sourceUrlOrOrigin: record.sourceUrlOrOrigin,
            data: metadata,
          }),
        };
      }

      case "cricket.get_fixture_data": {
        const args = CricketGetFixtureDataArgsSchema.parse(parsedJson);
        const result = await prepareMarketCricketData({
          fixtureId: args.fixtureId,
          marketType: this.options?.activeMarket?.marketType,
        });

        if (!result.match) {
          const record = this.evidenceCollector.addRecord({
            toolOperation: "cricket.get_fixture_data",
            sourceUrlOrOrigin: result.sourceUrlOrOrigin,
            title: `Sportmonks Fixture #${args.fixtureId} (Unavailable)`,
            summary:
              result.unavailableReason ??
              "Live ball-by-ball match data is currently unavailable from Sportmonks provider.",
            extractedData: {
              status: "DATA_UNAVAILABLE",
              reason: result.unavailableReason,
            },
          });

          return {
            evidenceRecord: record,
            serializedModelOutput: JSON.stringify({
              evidenceId: record.evidenceId,
              toolOperation: record.toolOperation,
              sourceUrlOrOrigin: record.sourceUrlOrOrigin,
              status: "DATA_UNAVAILABLE",
              message: `${
                result.unavailableReason ??
                "Live ball-by-ball delivery data is unavailable for this fixture."
              } Do not invent or assume live scores.`,
            }),
          };
        }

        const firstInnings = result.match.innings[0];
        const summaryText = firstInnings
          ? `${result.match.localTeam.name} vs ${result.match.visitorTeam.name} (${result.match.status}): ${firstInnings.totalRuns}/${firstInnings.wickets} in ${firstInnings.oversBowled} overs (RR ${firstInnings.runRate})`
          : `${result.match.localTeam.name} vs ${result.match.visitorTeam.name} (${result.match.status})`;

        const record = this.evidenceCollector.addRecord({
          toolOperation: "cricket.get_fixture_data",
          sourceUrlOrOrigin: result.sourceUrlOrOrigin,
          title: `Sportmonks Fixture #${args.fixtureId} (${result.match.localTeam.code} vs ${result.match.visitorTeam.code})`,
          summary: summaryText,
          extractedData: result.match,
        });

        const compactInnings = result.match.innings.map((inn) => ({
          inningNumber: inn.inningNumber,
          battingTeam: inn.battingTeam,
          bowlingTeam: inn.bowlingTeam,
          totalRuns: inn.totalRuns,
          wickets: inn.wickets,
          oversBowled: inn.oversBowled,
          runRate: inn.runRate,
          recentOvers: inn.overs.slice(-5),
          totalOversRecorded: inn.overs.length,
        }));

        return {
          evidenceRecord: record,
          serializedModelOutput: JSON.stringify({
            evidenceId: record.evidenceId,
            toolOperation: record.toolOperation,
            sourceUrlOrOrigin: record.sourceUrlOrOrigin,
            freshness: result.freshness,
            retrievedAt: result.retrievedAt,
            data: {
              ...result.match,
              innings: compactInnings,
            },
          }),
        };
      }

      case "web.search": {
        const args = WebSearchArgsSchema.parse(parsedJson);
        const searchRes = await executeWebSearch({
          query: args.query,
          maxResults: args.maxResults,
        });
        const primaryUrl =
          searchRes.results[0]?.url ?? `tavily://search?q=${encodeURIComponent(args.query)}`;
        const record = this.evidenceCollector.addRecord({
          toolOperation: "web.search",
          sourceUrlOrOrigin: primaryUrl,
          title: `Web Search: "${args.query}"`,
          summary: `Retrieved ${searchRes.results.length} web intelligence results via Tavily.`,
          extractedData: searchRes,
        });
        return {
          evidenceRecord: record,
          serializedModelOutput: JSON.stringify({
            evidenceId: record.evidenceId,
            toolOperation: record.toolOperation,
            sourceUrlOrOrigin: record.sourceUrlOrOrigin,
            data: searchRes,
          }),
        };
      }

      case "web.fetch_page": {
        const args = WebFetchPageArgsSchema.parse(parsedJson);
        const pageRes = await executeSafeWebFetchPage({ url: args.url });
        const record = this.evidenceCollector.addRecord({
          toolOperation: "web.fetch_page",
          sourceUrlOrOrigin: pageRes.finalUrl,
          title: pageRes.title,
          summary: `Extracted ${pageRes.byteLength} bytes of readable text from ${pageRes.finalUrl}`,
          extractedData: pageRes,
        });
        return {
          evidenceRecord: record,
          serializedModelOutput: JSON.stringify({
            evidenceId: record.evidenceId,
            toolOperation: record.toolOperation,
            sourceUrlOrOrigin: record.sourceUrlOrOrigin,
            data: pageRes,
          }),
        };
      }
    }
  }
}
