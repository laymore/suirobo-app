const { FunctionTool, z } = globalThis.__SUIROBO_REGISTRY__;
export const skill = new FunctionTool({name: 'test_macd_signal', description: 'MACD', parameters: z.object({})}, async () => {return {status: 'active'}});
export default skill;