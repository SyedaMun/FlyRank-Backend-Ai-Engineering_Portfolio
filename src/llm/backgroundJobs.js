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

 * Phase 2 Core Function: generate-report (BE-08 Playwright Integration)
 */
const generateReportJob = inngest.createFunction(
  {
    id: "generate-report",
    triggers: [{ event: "report/generate" }]
  },
  async ({ event, step }) => {
    const { reportId } = event.data;
    const fs = require("fs");
    const path = require("path");
    const { chromium } = require("playwright");
    const { Pool } = require("pg");

    // Re-instantiate the database configuration mapping cleanly inside the worker process context
    const workerPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: false
    });

    try {
      // 1. Data Aggregation Step via Inngest step processing engine wrapper layers
      const reportData = await step.run("query-database-metrics", async () => {
        const totalsRes = await workerPool.query(`
          SELECT COUNT(*)::int as total_orders, COALESCE(SUM(amount), 0)::float as total_revenue FROM orders;
        `);
        const topRes = await workerPool.query(`
          SELECT product, SUM(amount)::float as revenue, COUNT(*)::int as units_sold 
          FROM orders GROUP BY product ORDER BY revenue DESC LIMIT 5;
        `);
        const allOrdersRes = await workerPool.query(`
          SELECT id, customer, product, amount::float as amount, TO_CHAR(created_at, 'YYYY-MM-DD') as date 
          FROM orders ORDER BY id ASC;
        `);

        return {
          totalOrders: totalsRes.rows[0]?.total_orders || 0,
          totalRevenue: totalsRes.rows[0]?.total_revenue || 0.0,
          topProducts: topRes.rows,
          allOrders: allOrdersRes.rows
        };
      });

      // 2. HTML Blueprint Generation Step
      const htmlContent = await step.run("compile-html-layout", async () => {
        const today = new Date().toISOString().split("T")[0];
        
        let topProductsRows = reportData.topProducts.map(p => `
          <tr><td>${p.product}</td><td>${p.units_sold}</td><td>$${p.revenue.toFixed(2)}</td></tr>
        `).join("");

        let allOrdersRows = reportData.allOrders.map(o => `
          <tr><td>${o.id}</td><td>${o.customer}</td><td>${o.product}</td><td>$${o.amount.toFixed(2)}</td><td>${o.date}</td></tr>
        `).join("");

        return `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; margin: 30px; color: #333; }
              h1 { color: #2c3e50; margin-bottom: 5px; }
              .meta { font-size: 14px; color: #7f8c8d; margin-bottom: 25px; }
              .metrics { display: flex; gap: 20px; margin-bottom: 30px; }
              .card { border: 1px solid #e2e8f0; padding: 15px 25px; border-radius: 6px; background: #f8fafc; min-width: 15px; }
              .card h3 { margin: 0; font-size: 14px; color: #64748b; text-transform: uppercase; }
              .card p { margin: 5px 0 0; font-size: 24px; font-weight: bold; color: #0f172a; }
              table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
              th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
              th { background-color: #f1f5f9; font-weight: bold; }
              thead { display: table-header-group; }
              tr { break-inside: avoid; }
              .page-num { text-align: right; font-size: 12px; color: #94a3b8; margin-top: 20px; }
            </style>
          </head>
          <body>
            <h1>Sales Report</h1>
            <div class="meta">Generated: ${today} | Tracking ID: ${reportId}</div>
            
            <div class="metrics">
              <div class="card"><h3>Total Orders</h3><p>${reportData.totalOrders}</p></div>
              <div class="card"><h3>Total Revenue</h3><p>$${reportData.totalRevenue.toFixed(2)}</p></div>
            </div>

            <h2>Top 5 Products by Revenue</h2>
            <table>
              <thead><tr><th>Product</th><th>Orders</th><th>Revenue</th></tr></thead>
              <tbody>${topProductsRows}</tbody>
            </table>

            <h2 style="page-break-before: always;">All Orders Breakdown</h2>
            <table>
              <thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Date</th></tr></thead>
              <tbody>${allOrdersRows}</tbody>
            </table>
          </body>
          </html>
        `;
      });

      // 3. Playwright PDF Printing Execution Step (Utilizing existing local Edge installation channel)
      await step.run("render-and-store-pdf-artifact", async () => {
        const reportsDir = path.join(process.cwd(), "reports");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        const artifactPath = path.join(reportsDir, `report-${reportId}.pdf`);
        const browser = await chromium.launch({ channel: "msedge", headless: true });
        const page = await browser.newPage();
        
        await page.setContent(htmlContent);
        await page.pdf({ path: artifactPath, format: "A4", printBackground: true });
        await browser.close();

        // Push structural log records tracking the artifact path metadata location inside PostgreSQL
        await workerPool.query("INSERT INTO reports (path) VALUES (\$1)", [artifactPath]);

        // Mark memory state active so your status routing endpoints respond cleanly
        reportsStore[reportId] = {
          status: "complete",
          completedAt: new Date().toISOString(),
          downloadUrl: `/api/reports/${reportId}/file`,
          filePath: artifactPath
        };
      });

      console.log(`✅ [INNGEST WORKER] Successfully compiled automated PDF artifact for Report #${reportId}`);
      return { status: "success", reportId };

    } catch (err) {
      console.error(`🔴 [INNGEST WORKER ERROR] Processing failed for Report #${reportId}:`, err.message);
      reportsStore[reportId] = { status: "failed", error: err.message, failedAt: new Date().toISOString() };
      throw err;
    } finally {
      await workerPool.end(); // Safely shut down connection thread allocations
    }
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
    if (attempt < 2) {
      console.log(`⚠️ [RETRY ENGINE] Attempt #${attempt + 1} encountered a simulated network blip. Backing off...`);
      throw new Error(`Simulated connection drop on attempt number ${attempt + 1}`);
    }

    console.log(`✅ [RETRY ENGINE] Attempt #${attempt + 1} connected successfully! Workflow recovered.`);
    return { status: "recovered", finalAttempt: attempt + 1 };
  }
);

/**
 * =========================================================================
 * WEEK 7 ADDITION: Phase 1 Worker Core - AI Workflow Execution Engine
 * =========================================================================
 */
const processAIWorkflow = inngest.createFunction(
  { 
    id: "process-ai-workflow", 
    name: "Process AI Workflow Flowchart",
    triggers: [
      { event: "api/workflow.requested" }
    ]
  },
  async ({ event, step }) => {
    const { workflowId, executionPlan } = event.data;

    for (const task of executionPlan) {
      await step.run(`execute-step-${task.nodeId}`, async () => {
        console.log(`[FLOW WORKER] ⚙️ Processing: ${task.label} (Type: ${task.type})`);
        
        if (task.type === 'aiPrompt') {
          return { status: "success", message: "AI Prompt completed with parameters." };
        }
        
        return { status: "success", message: "Step executed successfully." };
      });
    }

    return { success: true, completedWorkflowId: workflowId };
  }
);

// =========================================================================
// EXPORTS SECTION (At the absolute bottom, below all definitions)
// =========================================================================
module.exports = { 
  inngest, 
  backgroundFunctions: [
    sayHelloJob, 
    generateReportJob, 
    cronHeartbeatJob, 
    retrySimulationJob,
    processAIWorkflow // Now it can find it perfectly without any errors!
  ],
  reportsStore 
};
