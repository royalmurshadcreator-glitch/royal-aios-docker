const { createAgentRegistry } = require("./agent-registry.cjs");
const { createJarvisBrain } = require("./jarvis-brain.cjs");
const { createJarvisPlanner } = require("./jarvis-planner.cjs");
const { createPlanExecutor } = require("./jarvis-plan-executor.cjs");
const { createJarvisMemory } = require("./jarvis-memory.cjs");
const { createVoiceLoop } = require("./jarvis-voice-loop.cjs");
const { createVisionLoop } = require("./jarvis-vision-loop.cjs");

// Agents
const compMod = require("./computer-agent.cjs");
const { BrowserAgent } = require("./browser-agent.cjs");
const { FileAgent } = require("./file-agent.cjs");
const { SystemAgent } = require("./system-agent.cjs");
const { VoiceAgent } = require("./voice-agent.cjs");
const { VisionAgent } = require("./vision-agent.cjs");
const { WhatsappAgent } = require("./whatsapp-agent.cjs");
const { VisaAgent } = require("./visa-agent.cjs");
const { TiktokAgent } = require("./tiktok-agent.cjs");
const { PdfAgent } = require("./pdf-agent.cjs");
const { EmailAgent } = require("./email-agent.cjs");
const { CalendarAgent } = require("./calendar-agent.cjs");
const { createBuilderAgent } = require("./jarvis-builder-agent.cjs");
const { createEnhancerAgent } = require("./jarvis-enhancer-agent.cjs");
const { createTemplateForge } = require("./jarvis-template-forge.cjs");
const { createHudSynthesizerAgent } = require("./jarvis-hud-synthesizer-agent.cjs");
const { createCodexAgent } = require("./jarvis-codex-agent.cjs");
const appshotsMod = require("./appshots-agent.cjs");
const { createArchitectAgent } = require("./jarvis-architect-agent.cjs");
const { createRouterAgent } = require("./jarvis-router-agent.cjs");
const { createWorkspaceAgent } = require("./workspace-agent.cjs");
const { createMobileAgent } = require("./jarvis-mobile-agent.cjs");
const { createCronAgent } = require("./cron-agent.cjs");
const { createMediaGenAgent } = require("./media-gen-agent.cjs");
const { createAndroidAgent } = require("./android-agent.cjs");
const { createBankTrackerAgent } = require("./bank-tracker-agent.cjs");
const { createEcommerceAgent } = require("./ecommerce-agent.cjs");
const { Api_wrapperAgent } = require("./api_wrapper-agent.cjs");
const { Cloud_cost_optimizerAgent } = require("./cloud_cost_optimizer-agent.cjs");
const { Boilerplate_forgeAgent } = require("./boilerplate_forge-agent.cjs");
const { Api_doc_forgeAgent } = require("./api_doc_forge-agent.cjs");
const { Contract_auditorAgent } = require("./contract_auditor-agent.cjs");
const { Schema_forgeAgent } = require("./schema_forge-agent.cjs");
const { Uptime_sentinelAgent } = require("./uptime_sentinel-agent.cjs");
const { Serverless_costAgent } = require("./serverless_cost-agent.cjs");
const { Synthetic_factoryAgent } = require("./synthetic_factory-agent.cjs");
const { Vuln_scannerAgent } = require("./vuln_scanner-agent.cjs");

function getComputerAgent(orchestrator) {
  if (typeof compMod.ComputerAgent === "function") return new compMod.ComputerAgent({ orchestrator });
  if (typeof compMod.createComputerAgent === "function") return compMod.createComputerAgent({ orchestrator });
  if (typeof compMod.ComputerAgent === "object" && compMod.ComputerAgent !== null) {
    if (orchestrator) compMod.ComputerAgent.orchestrator = orchestrator;
    return compMod.ComputerAgent;
  }
  return compMod;
}

function getAppshotsAgent(orchestrator) {
  if (typeof appshotsMod.createAppshotsAgent === "function") return appshotsMod.createAppshotsAgent({ orchestrator });
  if (typeof appshotsMod.AppshotsAgent === "function") return new appshotsMod.AppshotsAgent({ orchestrator });
  if (typeof appshotsMod.AppshotsAgent === "object") return appshotsMod.AppshotsAgent;
  return appshotsMod;
}

function createJarvisRuntime(options = {}) {
  const orchestrator = options.orchestrator || null;
  const emergencyStop = options.emergencyStop || null;

  const registry = createAgentRegistry();
  const memory = createJarvisMemory();

  // Core & Specialized Agents
  registry.register(getComputerAgent(orchestrator));
  registry.register(new BrowserAgent({ orchestrator }));
  registry.register(new FileAgent({ orchestrator }));
  registry.register(new SystemAgent({ orchestrator }));
  registry.register(new VoiceAgent({ orchestrator }));
  registry.register(new VisionAgent({ orchestrator }));

  registry.register(new WhatsappAgent({ orchestrator }));
  registry.register(new VisaAgent({ orchestrator }));
  registry.register(new TiktokAgent({ orchestrator }));
  registry.register(new PdfAgent({ orchestrator }));
  registry.register(new EmailAgent({ orchestrator }));
  registry.register(new CalendarAgent({ orchestrator }));

  // Meta-Agents & Engines
  const builder = createBuilderAgent({ registry });
  registry.register(builder);

  const enhancer = createEnhancerAgent({ registry });
  registry.register(enhancer);

  const forge = createTemplateForge({ registry });
  registry.register(forge);

  const synthesizer = createHudSynthesizerAgent({ registry });
  registry.register(synthesizer);

  const codex = createCodexAgent({ registry });
  registry.register(codex);

  const appshots = getAppshotsAgent(orchestrator);
  registry.register(appshots);

  const architect = createArchitectAgent({ registry });
  registry.register(architect);

  const router = createRouterAgent({ registry });
  registry.register(router);

  const workspace = createWorkspaceAgent({ registry });
  registry.register(workspace);

  const mobile = createMobileAgent({ registry });
  registry.register(mobile);

  const cron = createCronAgent({ registry });
  registry.register(cron);

  const mediaGen = createMediaGenAgent({ registry });
  registry.register(mediaGen);

  const android = createAndroidAgent({ registry });
  registry.register(android);

  const bankTracker = createBankTrackerAgent({ registry });
  registry.register(bankTracker);

  const ecommerce = createEcommerceAgent({ registry });
  registry.register(ecommerce);

  // Instantiations requiring dependencies
  const brain = createJarvisBrain({ registry, orchestrator, emergencyStop, memory });
  const planner = createJarvisPlanner({ registry, memory });
  const executor = createPlanExecutor({ registry, brain, memory });
  const voiceLoop = createVoiceLoop();
  const visionLoop = createVisionLoop();

  // Wire brain into cron after brain creation
  cron.brain = brain;

  return { 
    registry, brain, planner, executor, memory, 
    voiceLoop, visionLoop, builder, enhancer, forge, 
    synthesizer, codex, appshots, architect, router, 
    workspace, mobile, cron, mediaGen, android, bankTracker, ecommerce 
  };
}

module.exports = { createJarvisRuntime };
