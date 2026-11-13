import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Test extension for tests/live/fidelity.sh. It puts one marker in each channel an extension can
// use to reach the model. The test asks the model which markers it can see.
// CANARY_FORCE=1 also returns a whole system prompt from before_agent_start.

export default function canary(pi: ExtensionAPI) {
  pi.registerTool({
    name: "canary_tool",
    label: "Canary",
    description: "Test tool. Marker: CANARY-TOOLDESC.",
    promptSnippet: "Test tool. Marker: CANARY-SNIPPET.",
    promptGuidelines: ["Use canary_tool only in tests. Marker: CANARY-GUIDELINE."],
    parameters: { type: "object", properties: {} } as never,
    async execute() {
      return { content: [{ type: "text", text: "Marker: CANARY-TOOLRESULT." }], details: {} };
    },
  });

  pi.on("before_agent_start", async (event) => {
    event.systemPromptOptions.sections ??= {};
    (event.systemPromptOptions.sections as Record<string, string>).canary = "Marker: CANARY-SECTION.";
    return {
      message: { customType: "canary", content: "Marker: CANARY-MESSAGE.", display: false },
      ...(process.env.CANARY_FORCE === "1" ? { systemPrompt: `${event.systemPrompt}\n\nMarker: CANARY-FORCED.` } : {}),
    };
  });
}
