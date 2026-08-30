function calculateDamage(correct, difficulty, combo) {
  if (!correct) return 0;

  const base = {
    Easy: 10,
    Normal: 20,
    Hard: 35
  }[difficulty] || 10;

  const comboBonus = 1 + combo * 0.05;

  return Math.round(base * comboBonus);
}

module.exports = { calculateDamage };
