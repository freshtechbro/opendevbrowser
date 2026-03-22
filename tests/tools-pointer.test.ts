import { describe, expect, it, vi } from "vitest";
import { createPointerDownTool } from "../src/tools/pointer_down";
import { createPointerDragTool } from "../src/tools/pointer_drag";
import { createPointerMoveTool } from "../src/tools/pointer_move";
import { createPointerUpTool } from "../src/tools/pointer_up";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const parse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

describe("pointer tools", () => {
  it("moves the pointer and returns timing metadata", async () => {
    const pointerMove = vi.fn().mockResolvedValue({ timingMs: 11 });
    const tool = createPointerMoveTool({ manager: { pointerMove } } as never);

    const result = parse(await tool.execute({
      sessionId: "session-1",
      targetId: "target-1",
      x: 120,
      y: 240,
      steps: 4
    } as never));

    expect(pointerMove).toHaveBeenCalledWith("session-1", 120, 240, "target-1", 4);
    expect(result).toEqual({ ok: true, timingMs: 11 });
  });

  it("surfaces pointer move failures", async () => {
    const tool = createPointerMoveTool({
      manager: {
        pointerMove: vi.fn().mockRejectedValue(new Error("move failed"))
      }
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-1",
      x: 10,
      y: 20
    } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "move failed",
        code: "pointer_move_failed"
      }
    });
  });

  it("presses a mouse button at viewport coordinates", async () => {
    const pointerDown = vi.fn().mockResolvedValue({ timingMs: 7 });
    const tool = createPointerDownTool({ manager: { pointerDown } } as never);

    const result = parse(await tool.execute({
      sessionId: "session-2",
      targetId: "target-2",
      x: 15,
      y: 30,
      button: "right",
      clickCount: 2
    } as never));

    expect(pointerDown).toHaveBeenCalledWith("session-2", 15, 30, "target-2", "right", 2);
    expect(result).toEqual({ ok: true, timingMs: 7 });
  });

  it("surfaces pointer down failures", async () => {
    const tool = createPointerDownTool({
      manager: {
        pointerDown: vi.fn().mockRejectedValue(new Error("down failed"))
      }
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-2",
      x: 15,
      y: 30
    } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "down failed",
        code: "pointer_down_failed"
      }
    });
  });

  it("releases a mouse button at viewport coordinates", async () => {
    const pointerUp = vi.fn().mockResolvedValue({ timingMs: 9 });
    const tool = createPointerUpTool({ manager: { pointerUp } } as never);

    const result = parse(await tool.execute({
      sessionId: "session-3",
      targetId: "target-3",
      x: 21,
      y: 42,
      button: "middle",
      clickCount: 1
    } as never));

    expect(pointerUp).toHaveBeenCalledWith("session-3", 21, 42, "target-3", "middle", 1);
    expect(result).toEqual({ ok: true, timingMs: 9 });
  });

  it("surfaces pointer up failures", async () => {
    const tool = createPointerUpTool({
      manager: {
        pointerUp: vi.fn().mockRejectedValue(new Error("up failed"))
      }
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-3",
      x: 21,
      y: 42
    } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "up failed",
        code: "pointer_up_failed"
      }
    });
  });

  it("drags between viewport coordinates", async () => {
    const drag = vi.fn().mockResolvedValue({ timingMs: 13 });
    const tool = createPointerDragTool({ manager: { drag } } as never);

    const result = parse(await tool.execute({
      sessionId: "session-4",
      targetId: "target-4",
      fromX: 5,
      fromY: 10,
      toX: 50,
      toY: 60,
      steps: 6
    } as never));

    expect(drag).toHaveBeenCalledWith(
      "session-4",
      { x: 5, y: 10 },
      { x: 50, y: 60 },
      "target-4",
      6
    );
    expect(result).toEqual({ ok: true, timingMs: 13 });
  });

  it("surfaces pointer drag failures", async () => {
    const tool = createPointerDragTool({
      manager: {
        drag: vi.fn().mockRejectedValue(new Error("drag failed"))
      }
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-4",
      fromX: 5,
      fromY: 10,
      toX: 50,
      toY: 60
    } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "drag failed",
        code: "pointer_drag_failed"
      }
    });
  });
});
