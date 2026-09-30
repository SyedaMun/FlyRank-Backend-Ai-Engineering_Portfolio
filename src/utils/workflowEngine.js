// src/utils/workflowEngine.js

/**
 * Creates and returns the background Inngest workflow runner function.
 * @param {Inngest} inngest - Your active Inngest client instance
 * @param {Pool} dbPool - Your standaloneWorkflowPool instance
 * @returns {InngestFunction}
 */
function createWorkflowEngineFunction(inngest, dbPool) {
  return inngest.createFunction(
    { 
      id: "process-workflow-engine", 
      name: "Execute Workflow Steps Sequentially",
      // This is the updated configuration style matching your error message requirements
      triggers: [{ event: "api/workflow.requested" }],
      retry: 3 
    },
    async ({ event, step }) => {
      const { workflowId, executionPlan } = event.data;

      // 1. Mark entire Workflow state as PROCESSING in the database
      await step.run("update-status-processing", async () => {
        await dbPool.query(
          "UPDATE ai_workflows SET status = \$1, updated_at = NOW() WHERE id = \$2",
          ["PROCESSING", workflowId]
        );
      });

      // 2. Loop through the parsed execution plan steps sequentially
      for (const actionStep of executionPlan) {
        // Use a unique Inngest step ID per iteration using the node's unique ID
        await step.run(`execute-step-${actionStep.nodeId}`, async () => {
          
          console.log(`[CLOCK ENGINE] ⚙️ Processing step [${actionStep.nodeId}]: ${actionStep.label}`);

          // Simulating Phase 3 error recovery behavior if a test node fails
          if (actionStep.type === "fail_test" || actionStep.config?.triggerError === true) {
            console.error(`[CLOCK ENGINE] ❌ Simulated failure triggered at: ${actionStep.label}`);
            
            // Log failure to the database before throwing the error upward
            await dbPool.query(
              "UPDATE ai_workflows SET status = \$1, error_log = \$2, updated_at = NOW() WHERE id = \$3",
              ["FAILED", `Step [${actionStep.label}] explicitly failed.`, workflowId]
            );
            
            throw new Error(`Execution error at step node ${actionStep.nodeId}`);
          }

          // Return mock step metadata upon safe completion
          return { 
            status: "SUCCESS", 
            nodeProcessed: actionStep.nodeId, 
            completedAt: new Date().toISOString() 
          };
        });
      }

      // 3. Mark the workflow status completely as COMPLETED after finishing the loop safely
      await step.run("update-status-completed", async () => {
        await dbPool.query(
          "UPDATE ai_workflows SET status = \$1, updated_at = NOW() WHERE id = \$2",
          ["COMPLETED", workflowId]
        );
        console.log(`[CLOCK ENGINE] 🎉 Workflow #${workflowId} fully finished processing execution plan.`);
      });

      return { message: "Workflow pipeline executed successfully.", workflowId };
    }
  );
}

module.exports = { createWorkflowEngineFunction };
