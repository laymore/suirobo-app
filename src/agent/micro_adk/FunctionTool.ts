import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface FunctionToolConfig<T extends z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.infer<T>) => Promise<any> | any;
}

export class FunctionTool<T extends z.ZodTypeAny = any> {
  name: string;
  description: string;
  parameters: T;
  executeFn: (args: z.infer<T>) => Promise<any> | any;
  
  constructor(config: FunctionToolConfig<T>) {
    this.name = config.name;
    this.description = config.description;
    this.parameters = config.parameters;
    this.executeFn = config.execute;
  }

  async execute(args: any) {
    // Validate arguments if needed
    const parsedArgs = this.parameters.parse(args);
    return await this.executeFn(parsedArgs);
  }

  // Khớp với định dạng FunctionDeclaration của Gemini REST API
  get definition() {
    const jsonSchema = zodToJsonSchema(this.parameters, { target: 'openApi3' });
    
    // Convert zodToJsonSchema OpenAPI 3 output to Gemini supported schema if needed
    // Typically Gemini accepts standard JSON schema for type, properties, required
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: (jsonSchema as any).type || 'object',
        properties: (jsonSchema as any).properties || {},
        required: (jsonSchema as any).required || [],
      }
    };
  }
}
