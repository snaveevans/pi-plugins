import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import draftStash from "./draft-stash.ts";
import minimalMode from "./minimal-mode.ts";

export default function (pi: ExtensionAPI) {
	draftStash(pi);
	minimalMode(pi);
}
