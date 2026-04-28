import { useEffect } from 'react';
import { supportSocketService } from '@/services/supportSocketService';

/**
 * Connects to the /support namespace and listens for ops-only queue events:
 *   – `support:queue_update` — emitted whenever a chat enters/leaves WAITING
 *
 * Ops members are auto-joined to `ops:queue:{orgId}` server-side on connect,
 * so no manual room join is needed here. The caller passes a refetch function
 * (typically the queue React-Query refetch or a setState trigger) and we call
 * it on every queue update.
 */
export function useOpsQueueSocket(onQueueUpdate: () => void) {
  useEffect(() => {
    let socket;
    try {
      socket = supportSocketService.connect();
    } catch {
      return;
    }

    const handler = () => onQueueUpdate();
    socket.on('support:queue_update', handler);

    return () => {
      socket.off('support:queue_update', handler);
    };
  }, [onQueueUpdate]);
}
