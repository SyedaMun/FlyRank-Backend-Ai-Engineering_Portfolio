const { Pool } = require("pg");

// Make sure the function captures the working pool parameter passed from server.js
async function initializeDatabase(pool) {
    try {
        if (!pool) {
            throw new Error("No database pool instance was provided by server.js");
        }

        // --- Existing Weeks 1-6 Tasks Table ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                done INTEGER DEFAULT 0
            )
        `);
        console.log("✅ PostgreSQL tasks table ready.");

        // ==========================================
        // WEEK 7 ADDITION: AI Workflows Table
        // ==========================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_workflows (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                raw_graph JSONB NOT NULL,       
                execution_plan JSONB,           
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ PostgreSQL ai_workflows table ready.");

        // ==========================================
        // WEEK 7 ADDITION: BE-08 PDF Report Orders
        // ==========================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                customer TEXT NOT NULL,
                product TEXT NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ PostgreSQL orders table ready.");

        // ==========================================
        // WEEK 7 ADDITION: BE-08 PDF Artifact Tracking
        // ==========================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                path TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ PostgreSQL reports table ready.");

        // Safe fallback logic passing the pool parameter forward
        if (typeof seedDefaultTasks === "function") {
            await seedDefaultTasks(pool);
        }
        await seedMockOrders(pool);

    } catch (err) {
        console.error("❌ Database initialization failed safely:", err);
    }
}

async function seedMockOrders(pool) {
    try {
        if (!pool) return;
        
        // Enforce clean dev cycles: wipe old rows so seeding stays at exactly 200 rows
        await pool.query('TRUNCATE TABLE orders RESTART IDENTITY CASCADE;');
        
        const customers = ['Alice Vance', 'Bob Sterling', 'Clara Frost', 'David Vance', 'Elena Rostova', 'Frank Miller'];
        const products = ['AI Workflow Engine Pro', 'SaaS Analytics Dashboard', 'Headless Browser Cluster', 'Automated PDF Engine', 'Supabase Auth Gateway'];
        const insertQueries = [];
        
        for (let i = 0; i < 200; i++) {
            const randomCustomer = customers[Math.floor(Math.random() * customers.length)];
            const randomProduct = products[Math.floor(Math.random() * products.length)];
            const randomAmount = (Math.random() * (200 - 5) + 5).toFixed(2);
            const randomDaysAgo = Math.floor(Math.random() * 30);
            const orderDate = new Date();
            orderDate.setDate(orderDate.getDate() - randomDaysAgo);
            
            insertQueries.push(
                pool.query(
                    'INSERT INTO orders (customer, product, amount, created_at) VALUES (\$1, \$2, \$3, \$4)', 
                    [randomCustomer, randomProduct, randomAmount, orderDate]
                )
            );
        }
        await Promise.all(insertQueries);
        console.log("📊 PostgreSQL data initialization complete: 200 mock orders loaded successfully.");
    } catch (err) {
        console.error("❌ Failed to seed mock orders:", err.message);
    }
}

module.exports = { initializeDatabase, seedMockOrders };
