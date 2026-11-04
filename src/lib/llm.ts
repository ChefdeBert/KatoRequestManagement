import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

/** `override` lets a task (e.g. the assessment) use a different model id than chat. */
export function getModel(override?: string) {
  if (process.env.LLM_PROVIDER === 'openai') {
    const id = override || process.env.OPENAI_MODEL || 'gpt-5';
    return { model: openai(id), id: `openai:${id}` };
  }
  const id = override || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  return { model: anthropic(id), id: `anthropic:${id}` };
}
