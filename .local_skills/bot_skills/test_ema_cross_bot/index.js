const { FunctionTool, z } = globalThis.__SUIROBO_REGISTRY__;
export const skill = new FunctionTool({
  name: 'test_ema_cross_bot',
  description: 'Test EMA Cross bot',
  parameters: z.object({ close: z.number(), prev_close: z.number().optional() })
}, async function test_ema_cross_bot(params) {
  return { signal: 'HOLD', note: 'Test OK', input: params };
});
export default skill;