import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

console.log("Testing connection to database url:", process.env.DATABASE_URL);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  try {
    const client = await pool.connect();
    console.log("Successfully connected to the database server!");
    
    // Check if the database campus_connect exists
    const res = await client.query("SELECT datname FROM pg_database WHERE datname = 'campus_connect'");
    if (res.rows.length === 0) {
      console.log("Database 'campus_connect' does NOT exist.");
    } else {
      console.log("Database 'campus_connect' exists!");
    }
    
    client.release();
  } catch (err: any) {
    console.error("Database connection failed!");
    console.error("Error Code:", err.code);
    console.error("Message:", err.message);
  } finally {
    await pool.end();
  }
}

main();
