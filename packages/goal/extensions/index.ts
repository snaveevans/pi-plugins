import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import goalExtension from "./goal.ts";

export default function (pi: ExtensionAPI) {
	goalExtension(pi);
}
