import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import draftStash from "./draft-stash.ts";
import minimalMode from "./minimal-mode.ts";
import openaiContextWindow from "./openai-context-window.ts";

export default function (pi: ExtensionAPI) {
	draftStash(pi);
	minimalMode(pi);
	openaiContextWindow(pi);
}
