import type { CanvasParityArtifact } from "../canvas/types";

type RuntimePreviewPageLike = {
  evaluate: <TArg, TResult>(pageFunction: (arg: TArg) => TResult | Promise<TResult>, arg: TArg) => Promise<TResult>;
};

export type RuntimePreviewBridgeInput = {
  bindingId: string;
  rootSelector: string;
  html: string;
};

export type RuntimePreviewBridgeResult =
  | {
    ok: true;
    artifact: CanvasParityArtifact;
  }
  | {
    ok: false;
    fallbackReason:
      | "runtime_bridge_unavailable"
      | "runtime_projection_unsupported"
      | "runtime_projection_failed"
      | "runtime_instrumentation_missing"
      | "fallback_canvas_html";
    message: string;
  };

export async function applyRuntimePreviewBridge(
  page: RuntimePreviewPageLike,
  input: RuntimePreviewBridgeInput
): Promise<RuntimePreviewBridgeResult> {
  return await page.evaluate((payload) => {
    const root = document.querySelector(payload.rootSelector);
    if (!(root instanceof HTMLElement)) {
      return {
        ok: false,
        fallbackReason: "runtime_projection_unsupported",
        message: `Runtime root not found for selector ${payload.rootSelector}.`
      } satisfies RuntimePreviewBridgeResult;
    }
    const existingBindingId = root.getAttribute("data-binding-id");
    if (existingBindingId !== payload.bindingId) {
      return {
        ok: false,
        fallbackReason: "runtime_instrumentation_missing",
        message: "Runtime root is missing the expected data-binding-id instrumentation."
      } satisfies RuntimePreviewBridgeResult;
    }
    root.innerHTML = payload.html;
    const nodes = [root, ...Array.from(root.querySelectorAll("[data-node-id]"))]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element.hasAttribute("data-node-id"))
      .map((element) => {
        const computed = window.getComputedStyle(element);
        const childOrder = Array.from(element.children)
          .map((child) => child instanceof HTMLElement ? child.getAttribute("data-node-id") ?? child.tagName.toLowerCase() : "")
          .join("|");
        return {
          nodeId: element.getAttribute("data-node-id") ?? "",
          bindingId: element.getAttribute("data-binding-id") ?? payload.bindingId,
          text: (element.innerText || "").trim(),
          childOrderHash: childOrder,
          attributes: {
            "data-node-id": element.getAttribute("data-node-id") ?? "",
            ...(element.hasAttribute("data-binding-id") ? { "data-binding-id": element.getAttribute("data-binding-id") ?? "" } : {})
          },
          styleProjection: {
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize,
            fontWeight: computed.fontWeight,
            borderRadius: computed.borderRadius,
            display: computed.display
          }
        };
      });
    return {
      ok: true,
      artifact: {
        projection: "bound_app_runtime",
        rootBindingId: payload.bindingId,
        capturedAt: new Date().toISOString(),
        hierarchyHash: nodes.map((node) => `${node.nodeId}:${node.childOrderHash}`).join("|"),
        nodes
      }
    } satisfies RuntimePreviewBridgeResult;
  }, input);
}
