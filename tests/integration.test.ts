import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createToolRegistry } from '../src/tools/index.js';
import { ConversationMemory } from '../src/memory.js';
import { SafetyChecker, requiresConfirmation } from '../src/safety.js';
import { LLMClient } from '../src/llm.js';
import { Agent } from '../src/agent.js';

describe('integration', () => {
  it('tool registry contains all 10 expected tools', async () => {
    const registry = await createToolRegistry();
    const names = registry.list().map(t => t.name).sort();
    expect(names).toEqual([
      'edit_file',
      'format',
      'git_diff',
      'git_status',
      'glob_files',
      'grep_content',
      'list_dir',
      'read_file',
      'run_command',
      'write_file',
    ]);
    expect(names).toHaveLength(10);
  });

  it('confirmation flags match design spec', () => {
    expect(requiresConfirmation('read_file')).toBe(false);
    expect(requiresConfirmation('write_file')).toBe(true);
    expect(requiresConfirmation('edit_file')).toBe(true);
    expect(requiresConfirmation('run_command')).toBe(true);
    expect(requiresConfirmation('format')).toBe(true);
    expect(requiresConfirmation('glob_files')).toBe(false);
    expect(requiresConfirmation('grep_content')).toBe(false);
    expect(requiresConfirmation('list_dir')).toBe(false);
    expect(requiresConfirmation('git_status')).toBe(false);
    expect(requiresConfirmation('git_diff')).toBe(false);
  });

  it('config loads from env vars', () => {
    process.env.OPENAI_API_KEY = 'integration-test-key';
    const config = loadConfig();
    expect(config.apiKey).toBe('integration-test-key');
    expect(config.baseURL).toBe('https://api.openai.com/v1');
    expect(config.model).toBe('gpt-4');
    expect(config.maxSteps).toBe(20);
    expect(config.autoApprove).toEqual([]);
    delete process.env.OPENAI_API_KEY;
  });

  it('safety checker validates paths against project root', () => {
    const checker = new SafetyChecker({ projectRoot: process.cwd() });
    expect(() => checker.checkPath(process.cwd() + '/src/index.ts')).not.toThrow();
    expect(() => checker.checkPath('/etc/passwd')).toThrow('outside project');
  });

  it('safety checker blocks dangerous commands', () => {
    const checker = new SafetyChecker({ projectRoot: process.cwd() });
    expect(() => checker.checkCommand('npm test')).not.toThrow();
    expect(() => checker.checkCommand('rm -rf /')).toThrow('Blocked');
    expect(() => checker.checkCommand('sudo rm something')).toThrow('Blocked');
  });

  it('conversation memory sliding window works', () => {
    const mem = new ConversationMemory(3);
    mem.addMessage('user', '1');
    mem.addMessage('assistant', '2');
    mem.addMessage('user', '3');
    mem.addMessage('assistant', '4');
    expect(mem.getMessages()).toHaveLength(3);
    expect(mem.getMessages()[0].content).toBe('2');
  });

  it('LLM client can be instantiated', () => {
    const client = new LLMClient({
      apiKey: 'test-key',
      baseURL: 'http://localhost:8000/v1',
      model: 'gpt-4',
    });
    expect(client.model).toBe('gpt-4');
  });

  it('Agent can be created with config', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const config = loadConfig();
    const agent = new Agent(config);
    expect(agent).toBeDefined();
    expect(agent.sessionId).toBeTruthy();
    delete process.env.OPENAI_API_KEY;
  });
});
