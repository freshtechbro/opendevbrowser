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
  const wrap = (definition: ToolDefinition): ToolDefinition => {
    if (!deps.ensureHub) return definition;
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
    opendevbrowser_launch: wrap(createLaunchTool(deps)),
    opendevbrowser_connect: wrap(createConnectTool(deps)),
    opendevbrowser_disconnect: wrap(createDisconnectTool(deps)),
    opendevbrowser_status: wrap(createStatusTool(deps)),
    opendevbrowser_targets_list: wrap(createTargetsListTool(deps)),
    opendevbrowser_target_use: wrap(createTargetUseTool(deps)),
    opendevbrowser_target_new: wrap(createTargetNewTool(deps)),
    opendevbrowser_target_close: wrap(createTargetCloseTool(deps)),
    opendevbrowser_page: wrap(createPageTool(deps)),
    opendevbrowser_list: wrap(createListTool(deps)),
    opendevbrowser_close: wrap(createCloseTool(deps)),
    opendevbrowser_goto: wrap(createGotoTool(deps)),
    opendevbrowser_wait: wrap(createWaitTool(deps)),
    opendevbrowser_snapshot: wrap(createSnapshotTool(deps)),
    opendevbrowser_click: wrap(createClickTool(deps)),
    opendevbrowser_type: wrap(createTypeTool(deps)),
    opendevbrowser_select: wrap(createSelectTool(deps)),
    opendevbrowser_scroll: wrap(createScrollTool(deps)),
    opendevbrowser_dom_get_html: wrap(createDomGetHtmlTool(deps)),
    opendevbrowser_dom_get_text: wrap(createDomGetTextTool(deps)),
    opendevbrowser_run: wrap(createRunTool(deps)),
    opendevbrowser_prompting_guide: wrap(createPromptingGuideTool(deps)),
    opendevbrowser_console_poll: wrap(createConsolePollTool(deps)),
    opendevbrowser_network_poll: wrap(createNetworkPollTool(deps)),
    opendevbrowser_clone_page: wrap(createClonePageTool(deps)),
    opendevbrowser_clone_component: wrap(createCloneComponentTool(deps)),
    opendevbrowser_perf: wrap(createPerfTool(deps)),
    opendevbrowser_screenshot: wrap(createScreenshotTool(deps)),
    opendevbrowser_skill_list: wrap(createSkillListTool(deps)),
    opendevbrowser_skill_load: wrap(createSkillLoadTool(deps))
  };
}
