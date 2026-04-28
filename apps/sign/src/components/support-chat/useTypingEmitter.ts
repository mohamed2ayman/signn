import { useCallback, useEffect, useRef } from 'react';
import { supportSocketService } from '@/services/supportSocketService';

/**
 * Debounced typing emitter for the live-chat input.
 *
 * Spec: emit `support:typing` 300ms after the first keystroke (so we don't
 * spam the room on every character), and emit `support:stop_typing`
 * automatically 2s after the last keystroke.
 *
 * Usage:
 *   const onChange = useTypingEmitter(chatId);
 *   <textarea onChange={(e) => { onChange(); setText(e.target.value); }} />
 */
export function useTypingEmitter(chatId: string | null | undefined) {
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);

  const clear = useCallback(() => {
    if (startTimer.current) clearTimeout(startTimer.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    startTimer.current = null;
    stopTimer.current = null;
  }, []);

  const onKeystroke = useCallback(() => {
    if (!chatId) return;

    // Schedule "started typing" 300ms after the first keystroke.
    if (!isTyping.current && !startTimer.current) {
      startTimer.current = setTimeout(() => {
        isTyping.current = true;
        startTimer.current = null;
        supportSocketService.sendTyping(chatId);
      }, 300);
    }

    // Reset the auto-stop timer to 2s from now.
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      if (isTyping.current) {
        supportSocketService.sendStopTyping(chatId);
        isTyping.current = false;
      }
      // Cancel any pending start emit (user typed only briefly).
      if (startTimer.current) {
        clearTimeout(startTimer.current);
        startTimer.current = null;
      }
      stopTimer.current = null;
    }, 2000);
  }, [chatId]);

  // Stop typing immediately on unmount (e.g. closing the chat window).
  useEffect(() => {
    return () => {
      if (chatId && isTyping.current) {
        supportSocketService.sendStopTyping(chatId);
      }
      isTyping.current = false;
      clear();
    };
  }, [chatId, clear]);

  return onKeystroke;
}
