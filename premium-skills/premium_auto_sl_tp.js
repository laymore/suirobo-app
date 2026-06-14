const adk = globalThis.__SUIROBO_REGISTRY__?.FunctionTool ? globalThis.__SUIROBO_REGISTRY__ : { FunctionTool: require("@google/adk").FunctionTool, z: require("zod").z };
const { FunctionTool, z } = adk;
const premiumAutoSlTpManager = new FunctionTool(
  () => {
    return {
      status: "pending_confirmation",
      is_risky: true,
      riskType: "margin_liquidation",
      txBytes: "BASE64_PREMIUM_AUTO_SL_TP_TX",
      message: "[Premium] \u0110\xE3 t\xEDnh to\xE1n v\xE0 thi\u1EBFt l\u1EADp Auto SL/TP d\u1EF1a tr\xEAn thu\u1EADt to\xE1n \u0111\u1ED9c quy\u1EC1n Walrus AI.",
      sl_price: 1.12,
      tp_price: 1.55
    };
  },
  {
    name: "premium_auto_sl_tp",
    description: "T\xEDnh n\u0103ng Cao C\u1EA5p (Premium): T\u1EF1 \u0111\u1ED9ng thi\u1EBFt l\u1EADp C\u1EAFt L\u1ED7 (Stop-Loss) v\xE0 Ch\u1ED1t L\u1EDDi (Take-Profit) t\u1EF1 \u0111\u1ED9ng cho v\u1ECB th\u1EBF Margin d\u1EF1a tr\xEAn ph\xE2n t\xEDch r\u1EE7i ro chuy\xEAn s\xE2u.",
    parameters: z.object({
      positionId: z.string().describe("ID c\u1EE7a v\u1ECB th\u1EBF margin"),
      riskTolerance: z.enum(["low", "medium", "high"]).describe("M\u1EE9c \u0111\u1ED9 ch\u1ECBu r\u1EE7i ro")
    })
  }
);
globalThis.__NEW_SKILL__ = premiumAutoSlTpManager;
