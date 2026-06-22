document.querySelectorAll('.quiz').forEach((quiz) => {
  const options = quiz.querySelector('.quiz-options');
  if (!options) return;

  const correctIndex = Number(options.dataset.correct);
  const feedback = quiz.querySelector('.quiz-feedback');
  const buttons = options.querySelectorAll('button');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      if (options.dataset.answered === 'true') return;
      options.dataset.answered = 'true';

      const chosen = Number(button.dataset.index);
      const isCorrect = chosen === correctIndex;

      buttons.forEach((btn) => {
        btn.disabled = true;
        const idx = Number(btn.dataset.index);
        if (idx === correctIndex) btn.classList.add('correct');
        else if (idx === chosen && !isCorrect) btn.classList.add('incorrect');
      });

      if (feedback) {
        feedback.textContent = isCorrect
          ? 'Exact — SessionManager est le hub runtime ; la webview est une projection.'
          : 'Pas tout à fait — la webview affiche ; SessionManager possède l\'état conversation.';
        feedback.style.color = isCorrect ? 'var(--correct)' : 'var(--incorrect)';
      }
    });
  });
});
