(function() {
  "use strict";

  const REMINDER_ID = "telemost-record-reminder";
  const STORAGE_KEY_PREFIX = "telemost-record-reminder-dismissed:";
  const IN_CALL_SELECTORS = [
    '[data-testid="end-call-alt-button"]',
    '[data-testid="participants-button"]',
    '[data-testid="chat-alt-button"]',
    '[data-testid="more-popup-alt-button"]',
    '[data-testid="demonstration-button"]',
    '[title="Выйти из встречи"]',
    '[title="Участники"]'
  ];
  const REMINDER_TEXT = "Поставь запись";
  const REMINDER_REPEAT_MS = 18000;

  let reminderElement = null;
  let repeatTimer = null;
  let observer = null;
  let routeWatchTimer = null;
  let lastSeenPath = location.pathname;
  let activeAudioContext = null;
  let selectedVoice = null;

  const getDismissedKey = () => `${STORAGE_KEY_PREFIX}${location.pathname}`;

  const hasDismissedReminder = () => sessionStorage.getItem(getDismissedKey()) === "1";

  const getAudioContext = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }

    if (!activeAudioContext || activeAudioContext.state === "closed") {
      activeAudioContext = new AudioContextClass();
    }

    return activeAudioContext;
  };

  const pickBestVoice = () => {
    if (!("speechSynthesis" in window)) {
      return null;
    }

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
      return null;
    }

    const preferredPatterns = [
      /microsoft irina/i,
      /microsoft pavel/i,
      /microsoft dmitry/i,
      /russian/i,
      /ru-/i,
      /male/i,
      /desktop/i
    ];

    for (const pattern of preferredPatterns) {
      const match = voices.find((voice) => {
        return pattern.test(`${voice.name} ${voice.lang}`);
      });

      if (match) {
        return match;
      }
    }

    return voices[0];
  };

  const ensureVoiceLoaded = () => {
    if (!("speechSynthesis" in window) || selectedVoice) {
      return;
    }

    selectedVoice = pickBestVoice();
  };

  const playRobotChime = () => {
    const audioContext = getAudioContext();
    if (!audioContext) {
      return;
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const now = audioContext.currentTime;
    const masterGain = audioContext.createGain();
    const bandPass = audioContext.createBiquadFilter();
    const lowPass = audioContext.createBiquadFilter();
    const compressor = audioContext.createDynamicsCompressor();

    bandPass.type = "bandpass";
    bandPass.frequency.value = 920;
    bandPass.Q.value = 1.8;

    lowPass.type = "lowpass";
    lowPass.frequency.value = 1800;

    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
    masterGain.gain.exponentialRampToValueAtTime(0.03, now + 0.16);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 10;

    const mainOsc = audioContext.createOscillator();
    const subOsc = audioContext.createOscillator();

    mainOsc.type = "sawtooth";
    subOsc.type = "square";
    mainOsc.frequency.setValueAtTime(180, now);
    mainOsc.frequency.exponentialRampToValueAtTime(110, now + 0.3);
    subOsc.frequency.setValueAtTime(90, now);
    subOsc.frequency.exponentialRampToValueAtTime(55, now + 0.3);

    mainOsc.connect(bandPass);
    subOsc.connect(bandPass);
    bandPass.connect(lowPass);
    lowPass.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(audioContext.destination);

    mainOsc.start(now);
    subOsc.start(now);
    mainOsc.stop(now + 0.34);
    subOsc.stop(now + 0.34);
  };

  const stopReminderAudio = () => {
    if (repeatTimer !== null) {
      clearInterval(repeatTimer);
      repeatTimer = null;
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    if (activeAudioContext && activeAudioContext.state !== "closed") {
      activeAudioContext.close().catch(() => {});
      activeAudioContext = null;
    }
  };

  const speakReminder = () => {
    playRobotChime();

    if ("speechSynthesis" in window) {
      ensureVoiceLoaded();

      const utterance = new SpeechSynthesisUtterance("Внимание. Поставь запись.");
      utterance.lang = selectedVoice?.lang || document.documentElement.lang || "ru-RU";
      utterance.rate = 0.72;
      utterance.pitch = 0.45;
      utterance.volume = 1;
      utterance.voice = selectedVoice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      return;
    }

    const audioContext = getAudioContext();
    if (!audioContext) {
      return;
    }

    const oscillator = audioContext.createOscillator();
    const subOscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const filterNode = audioContext.createBiquadFilter();

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    filterNode.type = "bandpass";
    filterNode.frequency.setValueAtTime(700, audioContext.currentTime);
    filterNode.Q.setValueAtTime(2, audioContext.currentTime);

    oscillator.type = "sawtooth";
    subOscillator.type = "square";
    oscillator.frequency.setValueAtTime(155, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(110, audioContext.currentTime + 0.5);
    subOscillator.frequency.setValueAtTime(77, audioContext.currentTime);
    subOscillator.frequency.exponentialRampToValueAtTime(55, audioContext.currentTime + 0.5);
    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.03);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.55);

    oscillator.connect(filterNode);
    subOscillator.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    subOscillator.start();
    oscillator.stop(audioContext.currentTime + 0.6);
    subOscillator.stop(audioContext.currentTime + 0.6);
    oscillator.addEventListener("ended", () => {
      filterNode.disconnect();
      gainNode.disconnect();
    }, { once: true });
  };

  const dismissReminder = () => {
    sessionStorage.setItem(getDismissedKey(), "1");
    stopReminderAudio();

    if (reminderElement) {
      reminderElement.hidden = true;
    }
  };

  const createReminder = () => {
    if (reminderElement) {
      return reminderElement;
    }

    const container = document.createElement("section");
    container.id = REMINDER_ID;
    container.className = "telemost-record-reminder";
    container.setAttribute("role", "alertdialog");
    container.setAttribute("aria-live", "assertive");
    container.setAttribute("aria-label", REMINDER_TEXT);

    container.innerHTML = `
      <div class="telemost-record-reminder__badge">Напоминание</div>
      <h2 class="telemost-record-reminder__title">Поставь запись</h2>
      <p class="telemost-record-reminder__text">
        Ты уже в звонке. Перед началом разговора включи запись, чтобы потом ничего не потерялось.
      </p>
      <label class="telemost-record-reminder__check">
        <input class="telemost-record-reminder__checkbox" type="checkbox">
        <span>Запись включена, можно закрыть это окно</span>
      </label>
      <div class="telemost-record-reminder__hint">Пока окно открыто, напоминание будет повторяться голосом.</div>
    `;

    const checkbox = container.querySelector(".telemost-record-reminder__checkbox");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        dismissReminder();
      }
    });

    reminderElement = container;
    document.documentElement.appendChild(container);
    return container;
  };

  const showReminder = () => {
    if (hasDismissedReminder()) {
      return;
    }

    const element = createReminder();
    element.hidden = false;

    if (repeatTimer === null) {
      speakReminder();
      repeatTimer = window.setInterval(() => {
        if (document.hidden || hasDismissedReminder()) {
          return;
        }

        speakReminder();
      }, REMINDER_REPEAT_MS);
    }
  };

  const getMeetingUiSignalCount = () => {
    return IN_CALL_SELECTORS.reduce((count, selector) => {
      return count + (document.querySelector(selector) ? 1 : 0);
    }, 0);
  };

  const hasConnectedStateInPreloadedData = () => {
    const stateNode = document.getElementById("preloaded-state");
    if (!stateNode || !stateNode.textContent) {
      return false;
    }

    try {
      const state = JSON.parse(stateNode.textContent);
      const conferenceStatus = state?.call?.conference?.conferenceStatus;
      const messengerStatus = state?.call?.messenger?.outgoingCall?.status;
      return conferenceStatus === "connected" || messengerStatus === "connected";
    } catch (error) {
      return false;
    }
  };

  const isInCall = () => {
    const uiSignals = getMeetingUiSignalCount();
    if (uiSignals >= 2) {
      return true;
    }

    return hasConnectedStateInPreloadedData();
  };

  const checkMeetingState = () => {
    const joined = isInCall();
    if (!joined || hasDismissedReminder()) {
      return;
    }

    showReminder();

    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  const initObserver = () => {
    checkMeetingState();

    if (hasDismissedReminder()) {
      return;
    }

    observer = new MutationObserver(() => {
      checkMeetingState();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  };

  const watchRouteChanges = () => {
    routeWatchTimer = window.setInterval(() => {
      if (location.pathname === lastSeenPath) {
        return;
      }

      lastSeenPath = location.pathname;
      stopReminderAudio();

      if (reminderElement) {
        reminderElement.hidden = true;
      }

      if (!observer && !hasDismissedReminder()) {
        initObserver();
        return;
      }

      checkMeetingState();
    }, 1000);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initObserver, { once: true });
  } else {
    initObserver();
  }

  if ("speechSynthesis" in window) {
    ensureVoiceLoaded();
    window.speechSynthesis.addEventListener("voiceschanged", ensureVoiceLoaded, { once: true });
  }

  watchRouteChanges();

  window.addEventListener("beforeunload", () => {
    if (routeWatchTimer !== null) {
      clearInterval(routeWatchTimer);
    }

    stopReminderAudio();
  });
})();
