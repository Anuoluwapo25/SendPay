import { z } from "zod";

export const paymentActionSchema = z.enum([
  "SEND_SINGLE",
  "SPLIT_EQUAL",
  "SEND_TO_GROUP",
  /** Total USDC split across group members via SendrPay.payGroupSplit */
  "GROUP_SPLIT_TOTAL",
]);

export type PaymentAction = z.infer<typeof paymentActionSchema>;

export const adminActionSchema = z.enum([
  "REGISTER_USERNAME",
  "APPROVE_USDC",
  "CREATE_GROUP",
  "ADD_MEMBERS",
  "REMOVE_MEMBERS",
  "CANCEL_GROUP",
  "LIST_GROUPS",
  "HELP",
  "CHAT",
]);

export type AdminAction = z.infer<typeof adminActionSchema>;

export const parsedIntentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("payment"),
    action: paymentActionSchema,
    amount: z.number().positive().optional(),
    perRecipientAmount: z.number().positive().optional(),
    recipient: z.string().optional(),
    splitCount: z.number().int().positive().optional(),
    members: z.array(z.string()).optional(),
    groupName: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("admin"),
    action: adminActionSchema,
    /** REGISTER_USERNAME: on-chain name (a–z, 0–9, 3–32), no @ */
    username: z.string().optional(),
    /** APPROVE_USDC: human USDC amount to approve for SendrPay */
    amount: z.number().positive().optional(),
    groupName: z.string().optional(),
    /** ADD_MEMBERS / REMOVE_MEMBERS / CANCEL_GROUP */
    groupId: z.union([z.string(), z.number()]).optional(),
    members: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("unknown"),
    rawSummary: z.string(),
  }),
]);

export type ParsedIntent = z.infer<typeof parsedIntentSchema>;

export const draftTxPlanSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("pay"),
    to: z.string(),
    amountHuman: z.number(),
    amountBaseUnits: z.string(),
  }),
  z.object({
    mode: z.literal("payGroupEqual"),
    groupId: z.string(),
    amountPerMemberHuman: z.number(),
    amountPerMemberBaseUnits: z.string(),
    memberCount: z.number(),
  }),
  z.object({
    mode: z.literal("payMany"),
    items: z.array(
      z.object({
        to: z.string(),
        amountHuman: z.number(),
        amountBaseUnits: z.string(),
      }),
    ),
  }),
  z.object({
    mode: z.literal("payGroupSplit"),
    groupId: z.string(),
    totalHuman: z.number(),
    totalBaseUnits: z.string(),
    memberCount: z.number(),
  }),
]);

export type DraftTxPlan = z.infer<typeof draftTxPlanSchema>;

export const draftRecordSchema = z.object({
  draftId: z.string(),
  sessionId: z.string(),
  createdAt: z.number(),
  action: paymentActionSchema,
  recipients: z.array(
    z.object({
      username: z.string(),
      address: z.string(),
      amount: z.number(),
    }),
  ),
  totalAmount: z.number(),
  preview: z.string(),
  txPlan: draftTxPlanSchema,
});

export type DraftRecord = z.infer<typeof draftRecordSchema>;
