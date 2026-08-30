const questions = [
  { text: '3 + 5 = ?', answer: '8', difficulty: 'Easy' },
  { text: '12 × 8 = ?', answer: '96', difficulty: 'Normal' },
  { text: '3x + 5 = 20, x = ?', answer: '5', difficulty: 'Normal' },
  { text: 'LCM of 12 and 18 = ?', answer: '36', difficulty: 'Hard' }
];

function getQuestion() {
  return questions[Math.floor(Math.random() * questions.length)];
}

module.exports = { getQuestion };
