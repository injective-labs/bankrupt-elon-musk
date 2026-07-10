"use client";

import { useCallback, useRef } from "react";
import type { SoundKind } from "@/types";

export function useSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    let ctx = ctxRef.current;
    if (!ctx) {
      const AudioCtor: typeof AudioContext | undefined =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      ctx = new AudioCtor();
      ctxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    return ctx;
  }, []);

  const tone = useCallback(
    (
      ctx: AudioContext,
      frequency: number,
      start: number,
      duration: number,
      type: OscillatorType = "sine",
      volume = 0.05,
    ) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.025);
    },
    [],
  );

  const playSound = useCallback(
    (kind: SoundKind) => {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (kind === "buy") {
        tone(ctx, 660, now, 0.12, "triangle", 0.045);
        tone(ctx, 990, now + 0.08, 0.13, "triangle", 0.04);
      }
      if (kind === "largeBuy") {
        tone(ctx, 110, now, 0.2, "sawtooth", 0.035);
        tone(ctx, 740, now + 0.08, 0.16, "triangle", 0.045);
        tone(ctx, 1120, now + 0.18, 0.18, "sine", 0.035);
      }
      if (kind === "refund") {
        tone(ctx, 520, now, 0.09, "sine", 0.035);
        tone(ctx, 390, now + 0.08, 0.12, "sine", 0.03);
      }
      if (kind === "error") {
        tone(ctx, 180, now, 0.16, "square", 0.025);
      }
      if (kind === "chaos") {
        [220, 330, 494, 740, 988, 1318].forEach((freq, index) => {
          tone(ctx, freq, now + index * 0.045, 0.12, index % 2 ? "triangle" : "sine", 0.035);
        });
      }
      if (kind === "reset") {
        [880, 660, 440, 220].forEach((freq, index) => {
          tone(ctx, freq, now + index * 0.055, 0.11, "triangle", 0.032);
        });
      }
    },
    [ensureAudioContext, tone],
  );

  return playSound;
}
