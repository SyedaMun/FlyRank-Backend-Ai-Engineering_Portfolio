const { Pool } = require("pg");
require("dotenv").config();

// 🔍 DEBUG CHECK: Confirms if dotenvx or dotenv loaded your keys successfully
console.log("👉 [DEBUG] DATABASE_URL present:", !!process.env.DATABASE_URL);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// 👇 CLUADE'S FIX — Captures connection errors so they never crash your process
pool.on("error", (err) => {
    console.error("⚠️ [POOL GUARD] Unexpected idle client error handled safely:", err.message);
});

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                done INTEGER DEFAULT 0
            )
        `);

        console.log("✅ PostgreSQL tasks table ready.");

        await seedDefaultTasks();

    } catch (err) {
        console.error("❌ Database initialization failed safely:", err.message);
    }
}

// ==========================================
// SEED DEFAULT TASKS
// ==========================================

async function seedDefaultTasks() {
    try {
        const result = await pool.query(
            "SELECT COUNT(*) AS count FROM tasks"
        );

        const taskCount = Number(result.rows[0].count);

        if (taskCount > 0) {
            console.log("✅ Existing data found. Skipping seed.");
            return;
        }

        console.log("🌱 Seeding default Navigant project tasks...");

        await pool.query(
            "INSERT INTO tasks (title, done) VALUES ($1, $2)",
            ["Prepare SDG 4 education workshop materials", 0]
        );

        await pool.query(
            "INSERT INTO tasks (title, done) VALUES ($1, $2)",
            ["Schedule meeting with women mentors for the LeadHer initiative", 0]
        );

        await pool.query(
            "INSERT INTO tasks (title, done) VALUES ($1, $2)",
            ["Publish Navigant Education Consultants website update", 1]
        );

        console.log("✅ Three default tasks seeded successfully!");

    } catch (err) {
        console.error("❌ Seed failed safely:", err.message);
    }
}

// ==========================================
// READ OPERATIONS
// ==========================================

async function getAllTasks() {
    const result = await pool.query("SELECT * FROM tasks ORDER BY id");
    return result.rows;
}

async function getTaskById(id) {
    const result = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    return result.rows[0];
}

// ==========================================
// CREATE OPERATION
// ==========================================

async function createTask(title) {
    const result = await pool.query(
        `INSERT INTO tasks (title, done) VALUES ($1, $2) RETURNING *`,
        [title, 0]
    );
    return result.rows[0];
}

// ==========================================
// UPDATE OPERATION
// ==========================================

async function updateTask(id, title, done) {
    const result = await pool.query(
        `UPDATE tasks SET title = $1, done = $2 WHERE id = $3 RETURNING *`,
        [title, done, id]
    );
    return result.rows[0];
}

// ==========================================
// DELETE OPERATION
// ==========================================

async function deleteTask(id) {
    const result = await pool.query(
        `DELETE FROM tasks WHERE id = $1 RETURNING *`,
        [id]
    );
    return result.rows[0];
}

// ==========================================
// START DATABASE INITIALIZATION (PROTECTED INVOKER)
// ==========================================

// Fire and catch errors cleanly on boot, ensuring Express stays fully operational
initializeDatabase().catch(err => {
    console.error("⚠️ [THREAD GUARD] Initial connection dropped, keeping runtime server alive.");
});

// ==========================================
// EXPORT DATABASE REPOSITORY
// ==========================================

module.exports = {
    getAllTasks,
    getTaskById,
    createTask,
    updateTask,
    deleteTask
};
