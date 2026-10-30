import { useEffect, useState } from 'react';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function standalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** iPhone / iPad in Safari (other browsers there can't add to the home screen). */
function iosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function phone(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * "Keep the gallery on your home screen": a one-tap button on Android, a short how-to on iPhone.
 * Shown on phones only, until it's used or closed (per gallery, on this device).
 */
export function InstallHint({ id, light = false }: { id: string; light?: boolean }) {
  const key = `install-hint:${id}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return standalone() || !phone() || localStorage.getItem(key) === '1';
    } catch {
      return true;
    }
  });
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const ios = !hidden && iosSafari();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* private mode */
    }
  };

  if (hidden || (!prompt && !ios)) return null;
  return (
    <div className={`install-hint${light ? ' light' : ''}`} role="note" data-testid="install-hint">
      {prompt ? (
        <button
          type="button"
          className="install-go"
          onClick={async () => {
            await prompt.prompt();
            await prompt.userChoice.catch(() => null);
            close();
          }}
        >
          הוסיפו את הגלריה למסך הבית
        </button>
      ) : (
        <span>
          לשמירת הגלריה במסך הבית: לחצו על <b>שיתוף</b> <span aria-hidden="true">⬆︎</span> ואז <b>"הוספה למסך הבית"</b>.
        </span>
      )}
      <button type="button" className="install-x" onClick={close} aria-label="סגירה">
        ×
      </button>
    </div>
  );
}
