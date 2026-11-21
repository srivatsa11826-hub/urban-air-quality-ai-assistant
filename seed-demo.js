const bcrypt = require('bcryptjs');
const { getDb } = require('./db/database');
const { v4: uuidv4 } = require('uuid');

async function seedDemo() {
  const db = getDb();
  const email = 'demo@airguard.com';
  const password = 'password123';
  const name = 'Aarav Sharma';

  // 1. Create or update user
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const hash = await bcrypt.hash(password, 12);

  if (!user) {
    const uuid = uuidv4();
    const res = db.prepare('INSERT INTO users (uuid, email, password, name) VALUES (?, ?, ?, ?)').run(uuid, email, hash, name);
    user = { id: res.lastInsertRowid, uuid, email, name };
    console.log('✅ Created demo user with ID:', user.id);
  } else {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
    console.log('✅ Demo user password reset to:', password);
  }

  // 2. Profile
  const existingProf = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(user.id);
  if (!existingProf) {
    db.prepare(`
      INSERT INTO profiles (user_id, city, country, family_size, health_concerns, transport, work_style, budget, specific_concerns)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, 'New Delhi', 'India', '3-4', 'asthma', 'car', 'hybrid', 'medium',
      'Severe winter morning smog, 8-year-old child with mild asthma, daily school commute'
    );
    console.log('✅ Created demo profile for New Delhi');
  }

  // 3. Sample impact logs
  const existingLogs = db.prepare('SELECT COUNT(*) as c FROM impact_log WHERE user_id = ?').get(user.id).c;
  if (existingLogs === 0) {
    db.prepare('INSERT INTO impact_log (user_id, action, category, co2_saved, aqi_impact) VALUES (?, ?, ?, ?, ?)').run(
      user.id, 'Fitted N95 respirator & cabin AC set to recirculation mode', 'Transport', 1.8, 'Avoided 85% particulate exposure'
    );
    db.prepare('INSERT INTO impact_log (user_id, action, category, co2_saved, aqi_impact) VALUES (?, ?, ?, ?, ?)').run(
      user.id, 'Switched dinner cooking to single-burner induction plate', 'Food', 2.4, '100% elimination of indoor NOx plumes'
    );
    db.prepare('INSERT INTO impact_log (user_id, action, category, co2_saved, aqi_impact) VALUES (?, ?, ?, ?, ?)').run(
      user.id, 'Sealed bedroom window drafts with silicone weatherstrip tape', 'Home', 0.8, 'Cuts overnight PM2.5 infiltration by 50%'
    );
    console.log('✅ Seeded 3 sample verified impact logs');
  }

  // 4. Sample conversation session
  const existingSess = db.prepare('SELECT id FROM chat_sessions WHERE user_id = ? LIMIT 1').get(user.id);
  if (!existingSess) {
    const sUuid = uuidv4();
    const sRes = db.prepare('INSERT INTO chat_sessions (uuid, user_id, title, aqi_at_time) VALUES (?, ?, ?, ?)').run(
      sUuid, user.id, 'Winter Morning Smog & School Commute Defense', 285
    );
    db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(
      sRes.lastInsertRowid, 'user', 'My 8-year-old child walks to school at 7:30 AM in Delhi smog. What precautions should we take?'
    );
    db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(
      sRes.lastInsertRowid, 'assistant', `## 🚨 Morning Smog Commute Protocol for Children

At **7:30 AM in New Delhi**, the winter **ground thermal inversion layer** is at its densest, trapping diesel soot and fine PM2.5 particles below 100 meters. Children inhale 50% more air per pound of body weight than adults, placing developing lung airways under severe stress.

### 🛡️ Immediate Commute Safeguards:
- **Respirator Requirement**: Equip your child with a **fitted pediatric N95 respirator** (look for NIOSH or ISI-marked masks with adjustable nose wire and dual headbands). Cloth and surgical masks filter under 25% of sub-micron soot.
- **Commute Timing**: If possible, request school bus arrival after 8:30 AM or coordinate carpooling with internal AC recirculation.
- **Physical Exertion**: Instruct your child to walk at a relaxed, gentle pace—vigorous walking or running increases alveolar particle deposition by up to **300%**.

### 💚 Impact on Your Family:
- ✅ **-85% PM2.5 Inhaled**: Proper N95 fit prevents acute airway constriction.
- ✅ **Zero Indoor Infiltration**: Keep school blazer and shoes outside the bedroom to prevent tracking particulate dust indoors.

⚡ **Quick Win for Today**: Keep windows sealed until the 12:30 PM solar heating window, and give warm water steam hydration before bedtime.`
    );
    console.log('✅ Seeded initial consultation in chat history');
  }

  console.log('🎉 DEMO CREDENTIALS INITIALIZED SUCCESSFULLY!');
}

seedDemo().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
