// server/questions.js
const questionBank = {
  Easy: [
    { text: '3 + 4 = ?', answer: '7', baseDamage: 10 },
    { text: '5 × 2 = ?', answer: '10', baseDamage: 10 }
  ],
  Normal: [
    { text: '12 × 8 = ?', answer: '96', baseDamage: 20 },
    { text: '3x + 5 = 20; x = ?', answer: '5', baseDamage: 20 }
  ],
  Hard: [
    { text: 'Solve: 2x^2 - 8x + 6 = 0 (one root)', answer: '1', baseDamage: 35 },
    { text: 'LCM of 12 and 18 = ?', answer: '36', baseDamage: 35 }
  ],
  Expert: [
    { text: 'Integrate: ∫2x dx = ?', answer: 'x^2 + C', baseDamage: 50 },
    { text: 'If f(x)=2x+3, f^{-1}(5)=?', answer: '1', baseDamage: 50 }
  ],
  Legendary: [
    { text: 'Find determinant of [[2,3],[1,4]] = ?', answer: '5', baseDamage: 80 }
  ]
};

function sampleQuestions() {
  // flatten
  return Object.keys(questionBank).reduce((acc, k) => acc.concat(questionBank[k].map(q => ({...q, difficulty: k}))), []);
}

function getQuestionByDifficulty(difficulty) {
  const arr = questionBank[difficulty] || questionBank['Normal'];
  const q = arr[Math.floor(Math.random()*arr.length)];
  // attach serverSentAt for timing
  return { ...q, difficulty, serverSentAt: Date.now() };
}

module.exports = { sampleQuestions, getQuestionByDifficulty };

