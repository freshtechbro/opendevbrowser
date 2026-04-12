import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { createLaunchTool } from "./launch";
import { createConnectTool } from "./connect";
import { createDisconnectTool } from "./disconnect";
import { createStatusTool } from "./status";
import { createSessionInspectorTool } from "./session_inspector";
import { createTargetsListTool } from "./targets_list";
import { createTargetUseTool } from "./target_use";
import { createTargetNewTool } from "./target_new";
import { createTargetCloseTool } from "./target_close";
import { createPageTool } from "./page";
import { createListTool } from "./list";
import { createCloseTool } from "./close";
import { createGotoTool } from "./goto";
import { createWaitTool } from "./wait";
import { createSnapshotTool } from "./snapshot";
import { createReviewTool } from "./review";
import { createClickTool } from "./click";
import { createHoverTool } from "./hover";
import { createPressTool } from "./press";
import { createCheckTool } from "./check";
import { createUncheckTool } from "./uncheck";
import { createTypeTool } from "./type";
import { createSelectTool } from "./select";
import { createScrollTool } from "./scroll";
import { createScrollIntoViewTool } from "./scroll_into_view";
import { createUploadTool } from "./upload";
import { createPointerMoveTool } from "./pointer_move";
import { createPointerDownTool } from "./pointer_down";
import { createPointerUpTool } from "./pointer_up";
import { createPointerDragTool } from "./pointer_drag";
import { createDomGetHtmlTool } from "./dom_get_html";
import { createDomGetTextTool } from "./dom_get_text";
import { createGetAttrTool } from "./get_attr";
import { createGetValueTool } from "./get_value";
import { createIsVisibleTool } from "./is_visible";
import { createIsEnabledTool } from "./is_enabled";
import { createIsCheckedTool } from "./is_checked";
import { createRunTool } from "./run";
import { createPromptingGuideTool } from "./prompting_guide";
import { createConsolePollTool } from "./console_poll";
import { createNetworkPollTool } from "./network_poll";
import { createDebugTraceSnapshotTool } from "./debug_trace_snapshot";
import { createCookieImportTool } from "./cookie_import";
import { createCookieListTool } from "./cookie_list";
import { createMacroResolveTool } from "./macro_resolve";
import { createClonePageTool } from "./clone_page";
import { createCloneComponentTool } from "./clone_component";
import { createPerfTool } from "./perf";
import { createScreenshotTool } from "./screenshot";
import { createScreencastStartTool } from "./screencast_start";
import { createScreencastStopTool } from "./screencast_stop";
import { createDialogTool } from "./dialog";
import { createDesktopStatusTool } from "./desktop_status";
import { createDesktopWindowsTool } from "./desktop_windows";
import { createDesktopActiveWindowTool } from "./desktop_active_window";
import { createDesktopCaptureDesktopTool } from "./desktop_capture_desktop";
import { createDesktopCaptureWindowTool } from "./desktop_capture_window";
import { createDesktopAccessibilitySnapshotTool } from "./desktop_accessibility_snapshot";
import { createAnnotateTool } from "./annotate";
import { createResearchRunTool } from "./research_run";
import { createShoppingRunTool } from "./shopping_run";
import { createProductVideoRunTool } from "./product_video_run";
import { createCanvasTool } from "./canvas";
import { createSkillListTool } from "./skill_list";
import { createSkillLoadTool } from "./skill_load";
import onboardingMetadata from "../cli/onboarding-metadata.json";
export type { ToolSurfaceEntry } from "../public-surface/source";
export { TOOL_SURFACE_ENTRIES } from "../public-surface/generated-manifest";

export const LOCAL_ONLY_TOOL_NAMES = new Set(onboardingMetadata.localOnlyToolNames);

export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
  const wrap = (name: string, definition: ToolDefinition): ToolDefinition => {
    if (!deps.ensureHub || LOCAL_ONLY_TOOL_NAMES.has(name)) return definition;
    return {
      ...definition,
      execute: async (args, context) => {
        try {
          await deps.ensureHub?.();
        } catch {
          // Fall through to tool execution; tool-level error handling will surface issues.
        }
        return definition.execute(args, context);
      }
    };
  };

  return {
    opendevbrowser_launch: wrap("opendevbrowser_launch", createLaunchTool(deps)),
    opendevbrowser_connect: wrap("opendevbrowser_connect", createConnectTool(deps)),
    opendevbrowser_disconnect: wrap("opendevbrowser_disconnect", createDisconnectTool(deps)),
    opendevbrowser_status: wrap("opendevbrowser_status", createStatusTool(deps)),
    opendevbrowser_session_inspector: wrap("opendevbrowser_session_inspector", createSessionInspectorTool(deps)),
    opendevbrowser_targets_list: wrap("opendevbrowser_targets_list", createTargetsListTool(deps)),
    opendevbrowser_target_use: wrap("opendevbrowser_target_use", createTargetUseTool(deps)),
    opendevbrowser_target_new: wrap("opendevbrowser_target_new", createTargetNewTool(deps)),
    opendevbrowser_target_close: wrap("opendevbrowser_target_close", createTargetCloseTool(deps)),
    opendevbrowser_page: wrap("opendevbrowser_page", createPageTool(deps)),
    opendevbrowser_list: wrap("opendevbrowser_list", createListTool(deps)),
    opendevbrowser_close: wrap("opendevbrowser_close", createCloseTool(deps)),
    opendevbrowser_goto: wrap("opendevbrowser_goto", createGotoTool(deps)),
    opendevbrowser_wait: wrap("opendevbrowser_wait", createWaitTool(deps)),
    opendevbrowser_snapshot: wrap("opendevbrowser_snapshot", createSnapshotTool(deps)),
    opendevbrowser_review: wrap("opendevbrowser_review", createReviewTool(deps)),
    opendevbrowser_click: wrap("opendevbrowser_click", createClickTool(deps)),
    opendevbrowser_hover: wrap("opendevbrowser_hover", createHoverTool(deps)),
    opendevbrowser_press: wrap("opendevbrowser_press", createPressTool(deps)),
    opendevbrowser_check: wrap("opendevbrowser_check", createCheckTool(deps)),
    opendevbrowser_uncheck: wrap("opendevbrowser_uncheck", createUncheckTool(deps)),
    opendevbrowser_type: wrap("opendevbrowser_type", createTypeTool(deps)),
    opendevbrowser_select: wrap("opendevbrowser_select", createSelectTool(deps)),
    opendevbrowser_scroll: wrap("opendevbrowser_scroll", createScrollTool(deps)),
    opendevbrowser_scroll_into_view: wrap("opendevbrowser_scroll_into_view", createScrollIntoViewTool(deps)),
    opendevbrowser_upload: wrap("opendevbrowser_upload", createUploadTool(deps)),
    opendevbrowser_pointer_move: wrap("opendevbrowser_pointer_move", createPointerMoveTool(deps)),
    opendevbrowser_pointer_down: wrap("opendevbrowser_pointer_down", createPointerDownTool(deps)),
    opendevbrowser_pointer_up: wrap("opendevbrowser_pointer_up", createPointerUpTool(deps)),
    opendevbrowser_pointer_drag: wrap("opendevbrowser_pointer_drag", createPointerDragTool(deps)),
    opendevbrowser_dom_get_html: wrap("opendevbrowser_dom_get_html", createDomGetHtmlTool(deps)),
    opendevbrowser_dom_get_text: wrap("opendevbrowser_dom_get_text", createDomGetTextTool(deps)),
    opendevbrowser_get_attr: wrap("opendevbrowser_get_attr", createGetAttrTool(deps)),
    opendevbrowser_get_value: wrap("opendevbrowser_get_value", createGetValueTool(deps)),
    opendevbrowser_is_visible: wrap("opendevbrowser_is_visible", createIsVisibleTool(deps)),
    opendevbrowser_is_enabled: wrap("opendevbrowser_is_enabled", createIsEnabledTool(deps)),
    opendevbrowser_is_checked: wrap("opendevbrowser_is_checked", createIsCheckedTool(deps)),
    opendevbrowser_run: wrap("opendevbrowser_run", createRunTool(deps)),
    opendevbrowser_prompting_guide: wrap("opendevbrowser_prompting_guide", createPromptingGuideTool(deps)),
    opendevbrowser_console_poll: wrap("opendevbrowser_console_poll", createConsolePollTool(deps)),
    opendevbrowser_network_poll: wrap("opendevbrowser_network_poll", createNetworkPollTool(deps)),
    opendevbrowser_debug_trace_snapshot: wrap("opendevbrowser_debug_trace_snapshot", createDebugTraceSnapshotTool(deps)),
    opendevbrowser_cookie_import: wrap("opendevbrowser_cookie_import", createCookieImportTool(deps)),
    opendevbrowser_cookie_list: wrap("opendevbrowser_cookie_list", createCookieListTool(deps)),
    opendevbrowser_macro_resolve: wrap("opendevbrowser_macro_resolve", createMacroResolveTool(deps)),
    opendevbrowser_research_run: wrap("opendevbrowser_research_run", createResearchRunTool(deps)),
    opendevbrowser_shopping_run: wrap("opendevbrowser_shopping_run", createShoppingRunTool(deps)),
    opendevbrowser_product_video_run: wrap("opendevbrowser_product_video_run", createProductVideoRunTool(deps)),
    opendevbrowser_canvas: wrap("opendevbrowser_canvas", createCanvasTool(deps)),
    opendevbrowser_clone_page: wrap("opendevbrowser_clone_page", createClonePageTool(deps)),
    opendevbrowser_clone_component: wrap("opendevbrowser_clone_component", createCloneComponentTool(deps)),
    opendevbrowser_perf: wrap("opendevbrowser_perf", createPerfTool(deps)),
    opendevbrowser_screenshot: wrap("opendevbrowser_screenshot", createScreenshotTool(deps)),
    opendevbrowser_screencast_start: wrap("opendevbrowser_screencast_start", createScreencastStartTool(deps)),
    opendevbrowser_screencast_stop: wrap("opendevbrowser_screencast_stop", createScreencastStopTool(deps)),
    opendevbrowser_dialog: wrap("opendevbrowser_dialog", createDialogTool(deps)),
    opendevbrowser_desktop_status: wrap("opendevbrowser_desktop_status", createDesktopStatusTool(deps)),
    opendevbrowser_desktop_windows: wrap("opendevbrowser_desktop_windows", createDesktopWindowsTool(deps)),
    opendevbrowser_desktop_active_window: wrap("opendevbrowser_desktop_active_window", createDesktopActiveWindowTool(deps)),
    opendevbrowser_desktop_capture_desktop: wrap("opendevbrowser_desktop_capture_desktop", createDesktopCaptureDesktopTool(deps)),
    opendevbrowser_desktop_capture_window: wrap("opendevbrowser_desktop_capture_window", createDesktopCaptureWindowTool(deps)),
    opendevbrowser_desktop_accessibility_snapshot: wrap(
      "opendevbrowser_desktop_accessibility_snapshot",
      createDesktopAccessibilitySnapshotTool(deps)
    ),
    opendevbrowser_annotate: wrap("opendevbrowser_annotate", createAnnotateTool(deps)),
    opendevbrowser_skill_list: wrap("opendevbrowser_skill_list", createSkillListTool(deps)),
    opendevbrowser_skill_load: wrap("opendevbrowser_skill_load", createSkillLoadTool(deps))
  };
}
