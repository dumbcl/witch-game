'use strict';

const SOUND_STORAGE_KEY = 'witch-sound-muted';
const soundButton = document.getElementById('sound-button');
const backgroundMusic = document.getElementById('background-music');
const cardFlipEffect = document.getElementById('card-flip-effect');
let soundMuted = false;

try {
  soundMuted = localStorage.getItem(SOUND_STORAGE_KEY) === 'true';
} catch {
  // Sound also works when the browser disables storage.
}

backgroundMusic.volume = 0.35;
cardFlipEffect.volume = 0.65;

function updateSoundButton() {
  soundButton.setAttribute('aria-pressed', String(!soundMuted));
  soundButton.title = soundMuted ? 'Включить звук' : 'Выключить звук';
}

function startBackgroundMusic() {
  if (!soundMuted && backgroundMusic.paused) backgroundMusic.play().catch(() => {});
}

function playCardFlipSound() {
  if (soundMuted) return;
  cardFlipEffect.currentTime = 0;
  cardFlipEffect.play().catch(() => {});
}

soundButton.addEventListener('click', () => {
  soundMuted = !soundMuted;
  updateSoundButton();
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, String(soundMuted));
  } catch {
    // Keep the preference for the current tab.
  }

  if (soundMuted) {
    backgroundMusic.pause();
    cardFlipEffect.pause();
  } else {
    startBackgroundMusic();
  }
});

// Start playback after a user gesture, including when a guest opens the room list.
document.addEventListener('click', event => {
  if (!soundButton.contains(event.target)) startBackgroundMusic();
});

updateSoundButton();
