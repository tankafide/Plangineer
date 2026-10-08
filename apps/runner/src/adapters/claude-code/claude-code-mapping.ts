import {
  AGENT_NAME_MAX,
  AGENT_TEXT_MAX,
  FAILURE_MESSAGE_MAX,
  RateLimitStatus,
  RunnerRunEventBody,
  SKILL_NAME_MAX,
  SKILLS_MAX,
} from '@plangineer/contracts';
import { z } from 'zod';

type RunFailed = Extract<RunnerRunEventBody, { type: 'run.failed' }>;
type MappedLine = { ok: true; events: RunnerRunEventBody[] } | { ok: false; event: RunFailed };

const VENDOR_TYPE_MAX = 100;
const CLI_VERSION_MAX = 50;

const Line = z.looseObject({ type: z.string().min(1), subtype: z.string().optional() });
const Block = z.looseObject({ type: z.string() });
const ParentToolUseId = z.string().nullable();

const InitLine = z.looseObject({
  model: z.string(),
  claude_code_version: z.string(),
  skills: z.array(z.string()),
});
const AssistantLine = z.looseObject({
  message: z.looseObject({ content: z.array(Block) }),
  parent_tool_use_id: ParentToolUseId,
});
const UserLine = z.looseObject({
  message: z.looseObject({ content: z.union([z.string(), z.array(Block)]) }),
});
const TextBlock = z.looseObject({ text: z.string() });
const ToolUseBlock = z.looseObject({ id: z.string(), name: z.string(), input: z.unknown() });
const ToolResultBlock = z.looseObject({
  tool_use_id: z.string(),
  is_error: z.boolean().default(false),
  content: z.union([z.string(), z.array(Block)]).default(''),
});
const RateLimitLine = z.looseObject({
  rate_limit_info: z.looseObject({ status: RateLimitStatus, resetsAt: z.number().nullish() }),
});
const ResultLine = z.looseObject({
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.int().min(0),
  num_turns: z.int().min(0),
});
type ResultLine = z.infer<typeof ResultLine>;

/** Cuts text to `max` characters without splitting a surrogate pair. */
function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return { text: text.slice(0, end), truncated: true };
}

const cut = (text: string, max: number) => truncate(text, max).text;

function failure(
  reason: RunFailed['reason'],
  message: string,
  exitCode: number | null,
  stderrTail: string[],
): RunFailed {
  return {
    type: 'run.failed',
    reason,
    message: cut(message, FAILURE_MESSAGE_MAX),
    exitCode,
    stderrTail,
  };
}

function other(vendorType: string, json: string): RunnerRunEventBody {
  const { text, truncated } = truncate(json, AGENT_TEXT_MAX);
  return {
    type: 'agent.other',
    vendorType: cut(vendorType, VENDOR_TYPE_MAX),
    json: text,
    truncated,
  };
}

function lineVendorType(line: z.infer<typeof Line>): string {
  return line.subtype === undefined ? line.type : `${line.type}/${line.subtype}`;
}

function parentId(id: string | null): string | null {
  return id === null ? null : cut(id, AGENT_NAME_MAX);
}

function mapInit(value: unknown): RunnerRunEventBody {
  const init = InitLine.parse(value);
  return {
    type: 'agent.session',
    model: cut(init.model, AGENT_NAME_MAX),
    cliVersion: cut(init.claude_code_version, CLI_VERSION_MAX),
    skills: init.skills.slice(0, SKILLS_MAX).map((skill) => cut(skill, SKILL_NAME_MAX)),
  };
}

function mapAssistantBlock(
  block: z.infer<typeof Block>,
  parent: string | null,
): RunnerRunEventBody {
  if (block.type === 'text') {
    const { text, truncated } = truncate(TextBlock.parse(block).text, AGENT_TEXT_MAX);
    return { type: 'agent.message', text, truncated, parentToolUseId: parent };
  }
  if (block.type === 'tool_use') {
    const toolUse = ToolUseBlock.parse(block);
    const input = truncate(JSON.stringify(toolUse.input), AGENT_TEXT_MAX);
    return {
      type: 'agent.tool_use',
      toolUseId: cut(toolUse.id, AGENT_NAME_MAX),
      name: cut(toolUse.name, AGENT_NAME_MAX),
      inputJson: input.text,
      truncated: input.truncated,
      parentToolUseId: parent,
    };
  }
  return other(`assistant/${block.type}`, JSON.stringify(block));
}

function toolResultText(content: string | z.infer<typeof Block>[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? TextBlock.parse(block).text : JSON.stringify(block)))
    .join('\n');
}

function mapUserBlock(block: z.infer<typeof Block>): RunnerRunEventBody {
  if (block.type !== 'tool_result') return other(`user/${block.type}`, JSON.stringify(block));
  const result = ToolResultBlock.parse(block);
  const { text, truncated } = truncate(toolResultText(result.content), AGENT_TEXT_MAX);
  return {
    type: 'agent.tool_result',
    toolUseId: cut(result.tool_use_id, AGENT_NAME_MAX),
    isError: result.is_error,
    text,
    truncated,
  };
}

function resetTime(seconds: number | null | undefined): string | null {
  return seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString();
}

/** Maps one Claude Code stream-json run, line by line, to run events within their bounds. */
export function createClaudeMapping() {
  let result: ResultLine | null = null;
  let planLimitReached = false;

  function mapParsed(value: unknown, rawLine: string): RunnerRunEventBody[] {
    const line = Line.parse(value);
    if (line.type === 'system' && line.subtype === 'init') return [mapInit(value)];
    if (line.type === 'assistant') {
      const assistant = AssistantLine.parse(value);
      const parent = parentId(assistant.parent_tool_use_id);
      return assistant.message.content.map((block) => mapAssistantBlock(block, parent));
    }
    if (line.type === 'user') {
      const { content } = UserLine.parse(value).message;
      return typeof content === 'string' ? [other('user', rawLine)] : content.map(mapUserBlock);
    }
    if (line.type === 'rate_limit_event') {
      const info = RateLimitLine.parse(value).rate_limit_info;
      if (info.status === 'rejected') planLimitReached = true;
      return [
        { type: 'agent.rate_limit', status: info.status, resetsAt: resetTime(info.resetsAt) },
      ];
    }
    if (line.type === 'result') {
      result = ResultLine.parse(value);
      return [];
    }
    return [other(lineVendorType(line), rawLine)];
  }

  return {
    /** Maps one stdout line. A line that is not JSON or not a valid event fails the run. */
    mapLine(rawLine: string): MappedLine {
      let value: unknown;
      try {
        value = JSON.parse(rawLine);
      } catch {
        return {
          ok: false,
          event: failure(
            'invalid_output',
            `Claude Code wrote a line that is not JSON: ${cut(rawLine, 200)}`,
            null,
            [],
          ),
        };
      }
      try {
        return { ok: true, events: z.array(RunnerRunEventBody).parse(mapParsed(value, rawLine)) };
      } catch (error) {
        if (error instanceof z.ZodError) return invalidEvent(error);
        throw error;
      }
    },

    /** The one terminal event, once the child has exited. */
    finish(
      exitCode: number | null,
      stderrTail: string[],
    ): RunFailed | Extract<RunnerRunEventBody, { type: 'run.succeeded' }> {
      if (result === null) {
        return failure(
          'exit_code',
          `Claude Code ${describeExit(exitCode)} before its result.`,
          exitCode,
          stderrTail,
        );
      }
      if (result.is_error) {
        const message =
          result.result === undefined || result.result === ''
            ? `Claude Code reported ${result.subtype}.`
            : result.result;
        return failure(
          planLimitReached ? 'plan_limit' : 'agent_error',
          message,
          exitCode,
          stderrTail,
        );
      }
      if (exitCode !== 0) {
        return failure(
          'exit_code',
          `Claude Code ${describeExit(exitCode)} after its result.`,
          exitCode,
          stderrTail,
        );
      }
      const { text, truncated } = truncate(result.result ?? '', AGENT_TEXT_MAX);
      return {
        type: 'run.succeeded',
        resultText: text,
        truncated,
        costUsd: result.total_cost_usd ?? null,
        durationMs: result.duration_ms,
        numTurns: result.num_turns,
      };
    },
  };
}

function describeExit(exitCode: number | null): string {
  return exitCode === null ? 'was stopped by a signal' : `exited with code ${exitCode}`;
}

function invalidEvent(error: z.ZodError): MappedLine {
  const issue = error.issues[0];
  const detail = issue === undefined ? error.message : `${issue.path.join('.')}: ${issue.message}`;
  return {
    ok: false,
    event: failure(
      'invalid_output',
      `Claude Code output did not map to a valid event: ${detail}`,
      null,
      [],
    ),
  };
}
