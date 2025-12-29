import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { createLaunchTool } from "./launch";
import { createConnectTool } from "./connect";
import { createDisconnectTool } from "./disconnect";
import { createStatusTool } from "./status";
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
import { createClickTool } from "./click";
import { createTypeTool } from "./type";
import { createSelectTool } from "./select";
import { createScrollTool } from "./scroll";
import { createDomGetHtmlTool } from "./dom_get_html";
import { createDomGetTextTool } from "./dom_get_text";
import { createRunTool } from "./run";
import { createPromptingGuideTool } from "./prompting_guide";
import { createConsolePollTool } from "./console_poll";
import { createNetworkPollTool } from "./network_poll";
import { createClonePageTool } from "./clone_page";
import { createCloneComponentTool } from "./clone_component";
import { createPerfTool } from "./perf";
import { createScreenshotTool } from "./screenshot";
import { createSkillListTool } from "./skill_list";
import { createSkillLoadTool } from "./skill_load";

export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
  return {
    opendevbrowser_launch: createLaunchTool(deps),
    opendevbrowser_connect: createConnectTool(deps),
    opendevbrowser_disconnect: createDisconnectTool(deps),
    opendevbrowser_status: createStatusTool(deps),
    opendevbrowser_targets_list: createTargetsListTool(deps),
    opendevbrowser_target_use: createTargetUseTool(deps),
    opendevbrowser_target_new: createTargetNewTool(deps),
    opendevbrowser_target_close: createTargetCloseTool(deps),
    opendevbrowser_page: createPageTool(deps),
    opendevbrowser_list: createListTool(deps),
    opendevbrowser_close: createCloseTool(deps),
    opendevbrowser_goto: createGotoTool(deps),
    opendevbrowser_wait: createWaitTool(deps),
    opendevbrowser_snapshot: createSnapshotTool(deps),
    opendevbrowser_click: createClickTool(deps),
    opendevbrowser_type: createTypeTool(deps),
    opendevbrowser_select: createSelectTool(deps),
    opendevbrowser_scroll: createScrollTool(deps),
    opendevbrowser_dom_get_html: createDomGetHtmlTool(deps),
    opendevbrowser_dom_get_text: createDomGetTextTool(deps),
    opendevbrowser_run: createRunTool(deps),
    opendevbrowser_prompting_guide: createPromptingGuideTool(deps),
    opendevbrowser_console_poll: createConsolePollTool(deps),
    opendevbrowser_network_poll: createNetworkPollTool(deps),
    opendevbrowser_clone_page: createClonePageTool(deps),
    opendevbrowser_clone_component: createCloneComponentTool(deps),
    opendevbrowser_perf: createPerfTool(deps),
    opendevbrowser_screenshot: createScreenshotTool(deps),
    opendevbrowser_skill_list: createSkillListTool(deps),
    opendevbrowser_skill_load: createSkillLoadTool(deps)
  };
}
