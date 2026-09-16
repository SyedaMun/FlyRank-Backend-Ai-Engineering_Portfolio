process.env.INNGEST_EVENT_KEY = "local-dev-key"; // Forces the SDK to see an event key locally
const { Inngest } = require("inngest");

// Initialize the universal Inngest client profile identifier with local dev flags forced
const inngest = new Inngest({ 
  id: "navigant-task-engine",
  isDev: true,
  eventKey: "local-dev-key"
});

// Phase 2 Tracker: An in-memory store object to track report processing status
const reportsStore = {};

/**
 * Phase 1 Test Function: say-hello
 */
const sayHelloJob = inngest.createFunction(
  { 
    id: "say-hello",
    triggers: [{ event: "test/hello" }] 
  },
  async ({ event, step }) => {
    await step.sleep("simulate-slow-baking", "8s");
    console.log("🔔 [WORKER CORE] Background task processing completed successfully!");
    return { status: "complete", message: "Hello from the background room!" };
  }
);

/**
 * Phase 2 Core Function: generate-report
 */
const generateReportJob = inngest.createFunction(
  {
    id: "generate-report",
    triggers: [{ event: "report/generate" }]
  },
  async ({ event, step }) => {
    const { reportId } = event.data;

    await step.sleep("simulate-slow-report-baking", "8s");

    reportsStore[reportId] = {
      status: "complete",
      completedAt: new Date().toISOString(),
      result: `🚀 Report #${reportId} compilation complete! Here is your clean data matrix asset.`
    };

    console.log(`🔔 [WORKER CORE] Report ${reportId} processing completed successfully!`);
    return { status: "complete", reportId };
  }
);

/**
 * =========================================================================
 * PHASE 3: RESILIENT CLOCK ENGINE JOBS
 * =========================================================================
 */

/**
 * 1. Chronological Cron Heartbeat Job
 * Triggers automatically on a clock schedule every single minute (* * * * *)
 */
const cronHeartbeatJob = inngest.createFunction(
  { 
    id: "cron-heartbeat", 
    triggers: [{ cron: "* * * * *" }] // Classic Unix cron format for "Every Minute"
  },
  async ({ step }) => {
    const timestamp = new Date().toISOString();
    console.log(`⏱️ [CRON ENGINE] Heartbeat pulse recorded cleanly at ${timestamp}`);
    return { heartbeat: "alive", firedAt: timestamp };
  }
);

/**
 * 2. Resilient Error Backoff Retry Simulation Job
 * Set to explicitly retry up to 3 times on failure so we can view the graph progression
 */
const retrySimulationJob = inngest.createFunction(
  { 
    id: "retry-simulation", 
    triggers: [{ event: "test/simulate-retry" }],
    retries: 3 // Restricts the engine to exactly 3 recovery loops
  },
  async ({ event, step, attempt }) => {
    // attempt is 0-indexed. Let's force an error for the first 2 attempts!
    if (attempt < 2) {
      console.log(`⚠️ [RETRY ENGINE] Attempt #${attempt + 1} encountered a simulated network blip. Backing off...`);
      throw new Error(`Simulated connection drop on attempt number ${attempt + 1}`);
    }

    // Success loop runs smoothly on attempt #3!
    console.log(`✅ [RETRY ENGINE] Attempt #${attempt + 1} connected successfully! Workflow recovered.`);
    return { status: "recovered", finalAttempt: attempt + 1 };
  }
);

// Export the expanded client instance, functions, and tracking store database cleanly
module.exports = { 
  inngest, 
  backgroundFunctions: [sayHelloJob, generateReportJob, cronHeartbeatJob, retrySimulationJob],
  reportsStore 
};
