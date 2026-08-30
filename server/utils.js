// server/utils.js
function computeDamage({ baseDamageByDifficulty, correct, timeTaken, difficulty, combo, playerClass, energy }) {
  // baseDamageByDifficulty is numeric
  const base = baseDamageByDifficulty || 10;
  let damage = 0;
  let energyGain = 10; // per correct
  let backfire = false;
  let backfireDamage = 0;

  if (correct) {
    // speed bonus: faster => more bonus. timeTaken in ms
    let speedFactor = 1;
    if (timeTaken !== null) {
      const t = Math.max(200, timeTaken); // min 200ms
      // faster than 2000ms gets bonus
      speedFactor = 1 + Math.max(0, (2000 - t) / 2000) * 0.25; // up to +25%
    }
    // combo multiplier
    const comboMult = 1 + Math.min(5, combo) * 0.05; // each combo +5% up to +25%
    // class modifiers
    let classMult = 1;
    if (playerClass === 'MAGE') classMult += 0.15; // Arcane Blast
    if (playerClass === 'ARCHER') classMult += 0.10; // Quick Shot
    if (playerClass === 'WARRIOR') classMult += 0.05; // crit chance handled separately
    if (playerClass === 'KNIGHT') classMult -= 0.05; // defensive baseline

    damage = Math.round(base * speedFactor * comboMult * classMult);

    // critical chance: harder difficulty => higher crit chance
    const diffCrit = { Easy: 0.02, Normal: 0.05, Hard: 0.10, Expert: 0.18, Legendary: 0.30 };
    const critChance = diffCrit[difficulty] || 0.05;
    if (Math.random() < critChance) {
      damage = damage * 2; // critical doubles
      // mark critical in result (caller can detect by comparing)
    }

    // energy gain
    energyGain = Math.min(100, Math.round(10 + (base / 10)));
  } else {
    // wrong answer: small chance of backfire on hard questions
    const backfireChance = difficulty === 'Easy' ? 0 : difficulty === 'Normal' ? 0.02 : difficulty === 'Hard' ? 0.06 : difficulty === 'Expert' ? 0.12 : 0.2;
    if (Math.random() < backfireChance) {
      backfire = true;
      backfireDamage = Math.round(base * 0.5);
    }
  }

  return { damage, energyGain, backfire, backfireDamage };
}

function nowISO() {
  return new Date().toISOString();
}

module.exports = { computeDamage, nowISO };

