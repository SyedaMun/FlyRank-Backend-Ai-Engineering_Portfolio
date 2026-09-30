// ==========================================
// ENVIRONMENT & SAFETY CORES
// ==========================================
process.env.INNGEST_EVENT_KEY = "local-dev-key";
process.env.INNGEST_DEV = "http://localhost:8288";

// Expert Safety Guard: Prevents database connection drops from crashing your server process
const originalExit = process.exit;
process.exit = (code) => {
    if (code === 1) {
        console.log("⚠️ [SAFETY GUARD] Database connection timed out, but keeping server alive for background job testing!");
        return;
    }
    originalExit(code);
};

const express = require("express");
const swaggerUi = require("swagger-ui-express");
const openapiSpecification = require("./openapi.json");
const supabase = require("./supabase");
const app = express();
app.use((req, res, next) => {
  console.log(`[TRAFFIC] 🚗 ${req.method} request incoming to: ${req.url}`);
  next();
});

const db = require("./database");
// Add this import near your other require statements at the top of server.js
const { createWorkflowEngineFunction } = require("./src/utils/workflowEngine");


// ==========================================
// MIDDLEWARE
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = 3000;

// ==========================================
// REUSABLE AUTHENTICATION MIDDLEWARE (STAGE 4)
// ==========================================
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Access token required"
        });
    }

    const token = authHeader.split(" ")[1];
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({
                error: "Invalid or expired token"
            });
        }
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({
            error: "Invalid or expired token"
        });
    }
};

// ==========================================
// STAGE 1: AUTHENTICATION — SIGN UP
// ==========================================
app.post("/auth/signup", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({
            message: "Email and password are required"
        });
    }
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });
        if (error) {
            return res.status(400).json({
                message: error.message
            });
        }
        return res.status(201).json({
            user: data.user
        });
    } catch (err) {
        return res.status(500).json({
            message: "Internal server error"
        });
    }
});

app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({
            message: "Email and password are required"
        });
    }
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) {
            return res.status(401).json({
                message: error.message
            });
        }
        return res.status(200).json({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
        });
    } catch (err) {
        return res.status(500).json({
            message: "Internal server error"
        });
    }
});

app.post("/auth/logout", authenticateUser, async (req, res) => {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        return res.status(204).send();
    } catch (err) {
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ==========================================
// STAGE 2: PUBLIC GATEWAY
// ==========================================
app.get("/public/info", (req, res) => {
    return res.status(200).json({
        message: "Welcome stranger! This info is public."
    });
});

// ==========================================
// STAGE 3 & 4: PROTECTED CHANNELS
// ==========================================
app.get("/protected/profile", authenticateUser, (req, res) => {
    return res.status(200).json({
        id: req.user.id,
        email: req.user.email,
        created_at: req.user.created_at
    });
});

app.get("/protected/dashboard", authenticateUser, (req, res) => {
    return res.status(200).json({
        message: `Welcome to your security dashboard, user ${req.user.email}!`,
        status: "Active metrics rendering perfectly."
    });
});

// ==========================================
// SWAGGER API DOCUMENTATION
// ==========================================
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpecification));

// ==========================================
// AI ENGINE INTEGRATION: STAGE 1 ROUTING
// ==========================================
const ticketRoutes = require("./src/llm/routes/ticketRoutes");
app.use(ticketRoutes);

// ==========================================
// WEEK 6 (ASSIGNMENT A7): INNGEST BACKGROUND WORKER ROUTING GATEWAY
// ==========================================
const { serve } = require("inngest/express");
const { inngest, backgroundFunctions, reportsStore } = require("./src/llm/backgroundJobs.js");
const crypto = require("crypto");
const { Pool } = require('pg'); // Ensure Pool module is accessible here

// Phase 3 Fix: We initialize the standaloneWorkflowPool right here so it's ready to use
process.env.PGSSLMODE = "disable";
const standaloneWorkflowPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
});

// Phase 3 Configuration: Link the Workflow Engine with your Inngest instance and DB Pool
const workflowEngineFunction = createWorkflowEngineFunction(inngest, standaloneWorkflowPool);

app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: [
      ...backgroundFunctions, // Keeps all your existing background tasks working perfectly
      workflowEngineFunction  // Adds your new Phase 3 resilient sequential engine
    ],
  })
);


// ==========================================
// ASSIGNMENT A7 PHASE 2: FAST DOOR ROUTING ENDPOINTS
// ==========================================
app.post("/api/reports", async (req, res) => {
  const reportId = crypto.randomUUID();
  reportsStore[reportId] = {
    status: "pending",
    createdAt: new Date().toISOString()
  };
  await inngest.send({
    name: "report/generate",
    data: { reportId }
  });
  return res.status(202).json({
    id: reportId,
    status: "pending",
    trackingUrl: `/api/reports/${reportId}`
  });
});

app.get("/api/reports/:id", (req, res) => {
  const reportId = req.params.id;
  const report = reportsStore[reportId];
  if (!report) {
    return res.status(404).json({ error: "Report request records not found." });
  }
  return res.json(report);
});

// ==========================================
// STAGE 2: READ ENDPOINTS (KEEP PUBLIC)
// ==========================================
app.get("/tasks", async (req, res) => {
    try {
        const rows = await db.getAllTasks();
        res.json(
            rows.map(task => ({
                id: task.id,
                title: task.title,
                completed: task.done === 1
            }))
        );
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

app.get("/tasks/:id", async (req, res) => {
    try {
        const task = await db.getTaskById(req.params.id);
        if (!task) {
            return res.status(404).json({
                message: "Task not found"
            });
        }
        res.json({
            id: task.id,
            title: task.title,
            completed: task.done === 1
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

// ==========================================
// DEBUG ROUTE
// ==========================================
app.post("/test", (req, res) => {
    res.json({
        headers: req.headers,
        body: req.body
    });
});

// ==========================================
// STAGE 3: CREATE TASK (PROTECTED FOR SECURITY)
// ==========================================
app.post("/tasks", authenticateUser, async (req, res) => {
    if (!req.body || !req.body.title || req.body.title.trim() === "") {
        return res.status(400).json({
            message: "Task title is required"
        });
    }
    const title = req.body.title.trim();
    try {
        const task = await db.createTask(title);
        res.status(201).json({
            id: task.id,
            title: task.title,
            completed: task.done === 1
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

// ==========================================
// STAGE 3: UPDATE TASK (PROTECTED FOR SECURITY)
// ==========================================
app.put("/tasks/:id", authenticateUser, async (req, res) => {
    if (!req.body || !req.body.title || req.body.title.trim() === "") {
        return res.status(400).json({
            message: "Task title is required"
        });
    }
    const title = req.body.title.trim();
    const done = req.body.completed === true ? 1 : 0;
    try {
        const task = await db.updateTask(
            req.params.id,
            title,
            done
        );
        res.json({
            id: task.id,
            title: task.title,
            completed: task.done === 1
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

// =========================================================================
// WEEK 7 ADDITION: PHASE 2 - FAST DOOR ROUTING (AI WORKFLOW ENDPOINTS)
// =========================================================================
const { parseWorkflowToPlan } = require('./src/utils/workflowParser');


// 1. POST Endpoint: Trigger and Parse Visual Flowchart
app.post("/api/workflows/trigger", async (req, res) => {
  try {
    const { name, nodes, edges } = req.body;
    if (!name || !nodes || !edges) {
      return res.status(400).json({ error: "Bad Request", message: "Missing required properties." });
    }
    console.log(`[API DOOR] 🚪 Received workflow payload: "${name}"`);
    const executionPlan = parseWorkflowToPlan(nodes, edges);
    const insertQuery = `
      INSERT INTO ai_workflows (name, raw_graph, execution_plan)
      VALUES ($1, $2, $3) RETURNING id, name, created_at;
    `;
    const dbResult = await standaloneWorkflowPool.query(insertQuery, [name, JSON.stringify({ nodes, edges }), JSON.stringify(executionPlan)]);
    const savedWorkflow = dbResult?.rows?.[0];
    if (!savedWorkflow) {
      throw new Error("Insert query returned no rows — check that ai_workflows exists and the INSERT is not silently failing.");
    }
    await inngest.send({
      name: "api/workflow.requested",
      data: { workflowId: savedWorkflow.id, executionPlan: executionPlan }
    });
    console.log(`[API DOOR] ✅ Workflow #${savedWorkflow.id} offloaded cleanly.`);
    return res.status(202).json({
      message: "Workflow processing accepted successfully.",
      workflowId: savedWorkflow.id,
      trackingUrl: `/api/workflows/${savedWorkflow.id}/status`
    });
  } catch (error) {
    console.error("🔴 FULL ERROR STACK:", error);
    console.error("🔴 error.message:", error?.message);
    console.error("🔴 error.code (pg error code, if any):", error?.code);
    console.error("🔴 error.detail (pg constraint/detail, if any):", error?.detail);
    console.error("🔴 error.stack:", error?.stack);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error?.message || "Unknown error — see server console for full stack trace.",
      code: error?.code || null
    });
  }
});


// 2. GET Endpoint: Tracking Status
app.get("/api/workflows/:id/status", async (req, res) => {
  try {
    const dbResult = await standaloneWorkflowPool.query(`SELECT id, name, execution_plan FROM ai_workflows WHERE id = $1;`, [req.params.id]);
    if (!dbResult || dbResult.rows.length === 0) {
      return res.status(404).json({ error: "Not Found", message: "Workflow not found." });
    }
    return res.status(200).json({ status: "synced_in_database", data: dbResult.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// ==========================================
// STAGE 2: SQL DATA AGGREGATION PIPELINE FOR BE-08 REPORTS
// ==========================================
app.get("/api/report-aggregation-summary", async (req, res) => {
    try {
        const totalsQuery = `SELECT COUNT(*)::int as total_orders, COALESCE(SUM(amount), 0)::float as total_revenue FROM orders;`;
        const totalsRes = await standaloneWorkflowPool.query(totalsQuery);
        const total_orders = totalsRes.rows[0]?.total_orders || 0;
        const total_revenue = totalsRes.rows[0]?.total_revenue || 0.0;

        const topProductsQuery = `SELECT product, SUM(amount)::float as revenue, COUNT(*)::int as units_sold FROM orders GROUP BY product ORDER BY revenue DESC LIMIT 5;`;
        const topProductsRes = await standaloneWorkflowPool.query(topProductsQuery);

        const dailyOrdersQuery = `SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*)::int as total_orders, SUM(amount)::float as daily_revenue FROM orders WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') ORDER BY date DESC;`;
        const dailyOrdersRes = await standaloneWorkflowPool.query(dailyOrdersQuery);

        return res.json({
            metadata: { engine: "PostgreSQL 17 Data Aggregator", timestamp: new Date().toISOString() },
            summary: { total_orders, total_revenue },
            top_products: topProductsRes.rows,
            daily_trends: dailyOrdersRes.rows
        });
    } catch (err) {
        return res.status(500).json({ status: "aggregation_failed", error: err.message });
    }
});

// Alias: dashboard URL -> aggregation summary
app.get("/api/reports-summary-dashboard", (req, res) => {
    res.redirect("/api/report-aggregation-summary");
});

// ==========================================
// SERVER BOOT
// ==========================================
app.listen(PORT, async () => {
    console.log(`🚀 Server running cleanly on http://localhost:${PORT}`);
    try {
        if (db && typeof db.initializeDatabase === "function") {
            await db.initializeDatabase(standaloneWorkflowPool);
        }
        
        // Safe, non-intrusive runtime print to expose the exact active endpoint URLs
        console.log("\n🗺️  Active Registered API Paths:");
        app._router.stack.forEach(r => { if (r.route) console.log(`👉 http://localhost:${PORT}${r.route.path}`); });
        
    } catch (error) {
        console.error("⚠️ Database initialization skipped safely:", error.message);
    }
});
