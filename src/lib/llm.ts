import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

export function getModel() {
  if (process.env.LLM_PROVIDER === 'openai') {
    const id = process.env.OPENAI_MODEL ?? 'gpt-5';
    return { model: openai(id), id: `openai:${id}` };
  }
  const id = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
  return { model: anthropic(id), id: `anthropic:${id}` };
}
