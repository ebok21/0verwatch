import { z } from "zod";

export const TeamSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  code: z.string(),
});
export type Team = z.infer<typeof TeamSchema>;

export const PlayerSchema = z.object({
  id: z.union([z.number(), z.string()]),
  fullName: z.string(),
  role: z.string().optional(),
  teamId: z.union([z.number(), z.string()]).optional(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const DeliverySchema = z.object({
  id: z.union([z.number(), z.string()]),
  inningNumber: z.number().int().min(1),
  overNumber: z.number().int().min(1), // 1-indexed over number (e.g., Over #15 -> overNumber = 15)
  ballNumber: z.number().int().min(1), // 1..6+ within the over
  ballCoordinate: z.number(), // e.g., 14.1 for 1st ball of Over #15
  batsman: PlayerSchema.optional(),
  bowler: PlayerSchema.optional(),
  runsOffBat: z.number().int().min(0),
  extras: z.object({
    wides: z.number().int().min(0).default(0),
    noBalls: z.number().int().min(0).default(0),
    byes: z.number().int().min(0).default(0),
    legByes: z.number().int().min(0).default(0),
    penalty: z.number().int().min(0).default(0),
    totalExtras: z.number().int().min(0).default(0),
  }),
  totalRuns: z.number().int().min(0), // runsOffBat + totalExtras
  isWicket: z.boolean(),
  wicketType: z.string().nullable().optional(),
  scoreLabel: z.string().optional(),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const OverSchema = z.object({
  inningNumber: z.number().int().min(1),
  overNumber: z.number().int().min(1), // 1-indexed: Over #1 is 1, Over #15 is 15
  totalRuns: z.number().int().min(0),
  totalExtras: z.number().int().min(0),
  wickets: z.number().int().min(0),
  legalBallsBowled: z.number().int().min(0),
  isComplete: z.boolean(),
  deliveries: z.array(DeliverySchema),
});
export type Over = z.infer<typeof OverSchema>;

export const InningsSchema = z.object({
  inningNumber: z.number().int().min(1),
  battingTeam: TeamSchema,
  bowlingTeam: TeamSchema,
  totalRuns: z.number().int().min(0),
  wickets: z.number().int().min(0),
  oversBowled: z.number().min(0), // e.g. 14.2
  runRate: z.number().min(0),
  overs: z.array(OverSchema),
});
export type Innings = z.infer<typeof InningsSchema>;

export const MatchSchema = z.object({
  fixtureId: z.number().int(),
  provider: z.literal("sportmonks"),
  leagueName: z.string(),
  seasonName: z.string().optional(),
  round: z.string().optional(),
  startingAt: z.string(),
  status: z.string(), // e.g., "NS", "1st Innings", "Innings Break", "2nd Innings", "Finished"
  note: z.string().nullable().optional(),
  venue: z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      name: z.string(),
      city: z.string().optional(),
      country: z.string().optional(),
    })
    .nullable()
    .optional(),
  localTeam: TeamSchema,
  visitorTeam: TeamSchema,
  tossWonTeamId: z.union([z.number(), z.string()]).nullable().optional(),
  elected: z.string().nullable().optional(),
  innings: z.array(InningsSchema),
  lineup: z.array(PlayerSchema),
  retrievedAt: z.string().optional(),
  freshness: z.enum(["LIVE", "CACHED", "FINAL", "PRE_MATCH"]).optional(),
});
export type Match = z.infer<typeof MatchSchema>;
