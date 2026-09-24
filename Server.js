const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Get challenges by codes
app.post('/api/challenges', async (req, res) => {
  try {
    const { codes } = req.body;
    if (!Array.isArray(codes) || codes.length === 0) return res.json([]);
    
    const result = await pool.query(
      'SELECT * FROM daystash_challenges WHERE share_code = ANY($1) ORDER BY created_at DESC',
      [codes]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get challenge with all data
app.get('/api/challenge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [c, days, deps] = await Promise.all([
      pool.query('SELECT * FROM daystash_challenges WHERE id = $1', [id]),
      pool.query('SELECT * FROM daystash_saved_days WHERE challenge_id = $1 ORDER BY day_number', [id]),
      pool.query('SELECT * FROM daystash_deposits WHERE challenge_id = $1 ORDER BY deposited_at', [id]),
    ]);
    res.json({
      challenge: c.rows[0],
      savedDays: days.rows,
      deposits: deps.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find challenge by code
app.get('/api/find/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      'SELECT * FROM daystash_challenges WHERE share_code = $1',
      [code]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create challenge
app.post('/api/create', async (req, res) => {
  try {
    const { name, emoji, max_day, start_date, target_amount, created_by } = req.body;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const result = await pool.query(
      `INSERT INTO daystash_challenges (name, emoji, max_day, start_date, target_amount, created_by, share_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, emoji, max_day, start_date, target_amount || null, created_by, code]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle day saved/unsaved
app.post('/api/toggle-day', async (req, res) => {
  try {
    const { challenge_id, day_number, saved_by, isSaved } = req.body;
    
    if (isSaved) {
      await pool.query(
        'DELETE FROM daystash_saved_days WHERE challenge_id = $1 AND day_number = $2',
        [challenge_id, day_number]
      );
    } else {
      await pool.query(
        'INSERT INTO daystash_saved_days (challenge_id, day_number, saved_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [challenge_id, day_number, saved_by]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add deposit
app.post('/api/deposit', async (req, res) => {
  try {
    const { challenge_id, amount, days_covered, leftover, deposited_by } = req.body;
    
    const depResult = await pool.query(
      `INSERT INTO daystash_deposits (challenge_id, amount, days_covered, leftover, deposited_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [challenge_id, amount, days_covered, leftover, deposited_by]
    );
    
    if (days_covered && days_covered.length > 0) {
      const values = days_covered.map(d => `('${challenge_id}'::uuid, ${d}, '${deposited_by}')`).join(',');
      await pool.query(
        `INSERT INTO daystash_saved_days (challenge_id, day_number, saved_by) VALUES ${values}
         ON CONFLICT (challenge_id, day_number) DO NOTHING`
      );
    }
    
    res.json(depResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DayStash API running on port ${PORT}`));
