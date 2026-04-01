import { useEffect, useState, useCallback, useRef } from 'react';
import { socketService, RoomUser } from '@/services/socketService';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';

interface CollaborationToast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning';
  timestamp: number;
}

interface UseCollaborationOptions {
  contractId: string | undefined;
  onClausesChanged?: () => void;
  onCommentsChanged?: () => void;
  onStatusChanged?: (payload: { oldStatus: string; newStatus: string }) => void;
  onRisksChanged?: () => void;
}

export function useCollaboration({
  contractId,
  onClausesChanged,
  onCommentsChanged,
  onStatusChanged,
  onRisksChanged,
}: UseCollaborationOptions) {
  const [liveUsers, setLiveUsers] = useState<RoomUser[]>([]);
  const [toasts, setToasts] = useState<CollaborationToast[]>([]);
  const toastIdRef = useRef(0);

  const user = useSelector((s: RootState) => s.auth.user);

  const addToast = useCallback(
    (message: string, type: CollaborationToast['type'] = 'info') => {
      const id = String(++toastIdRef.current);
      setToasts((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);

      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!contractId) return;

    // Connect and join room
    try {
      socketService.connect();
    } catch {
      // No token yet — skip socket
      return;
    }

    const userName =
      user?.first_name && user?.last_name
        ? `${user.first_name} ${user.last_name}`
        : user?.email || '';

    socketService.joinContract(contractId, userName);

    // ── Room presence events ──
    const handleRoomUsers = (users: RoomUser[]) => {
      setLiveUsers(users);
    };

    const handleUserJoined = (data: { userId: string; email: string; name?: string }) => {
      if (data.userId !== user?.id) {
        addToast(`${data.name || data.email} joined`, 'info');
      }
    };

    const handleUserLeft = (data: { userId: string; email: string }) => {
      if (data.userId !== user?.id) {
        addToast(`${data.email} left`, 'info');
      }
    };

    // ── Data events ──
    const handleClauseAdded = () => {
      onClausesChanged?.();
      addToast('A clause was added', 'success');
    };

    const handleClauseUpdated = () => {
      onClausesChanged?.();
      addToast('A clause was updated', 'info');
    };

    const handleClauseRemoved = () => {
      onClausesChanged?.();
      addToast('A clause was removed', 'warning');
    };

    const handleCommentAdded = () => {
      onCommentsChanged?.();
      addToast('New comment added', 'info');
    };

    const handleCommentResolved = () => {
      onCommentsChanged?.();
      addToast('A comment was resolved', 'success');
    };

    const handleStatusChanged = (payload: { oldStatus: string; newStatus: string }) => {
      onStatusChanged?.(payload);
      addToast(
        `Status changed: ${payload.oldStatus.replace(/_/g, ' ')} → ${payload.newStatus.replace(/_/g, ' ')}`,
        'warning',
      );
    };

    const handleRiskUpdated = () => {
      onRisksChanged?.();
      addToast('Risk analysis updated', 'info');
    };

    socketService.on('room:users', handleRoomUsers);
    socketService.on('user:joined', handleUserJoined);
    socketService.on('user:left', handleUserLeft);
    socketService.on('clause:added', handleClauseAdded);
    socketService.on('clause:updated', handleClauseUpdated);
    socketService.on('clause:removed', handleClauseRemoved);
    socketService.on('comment:added', handleCommentAdded);
    socketService.on('comment:resolved', handleCommentResolved);
    socketService.on('status:changed', handleStatusChanged);
    socketService.on('risk:updated', handleRiskUpdated);

    return () => {
      socketService.off('room:users', handleRoomUsers);
      socketService.off('user:joined', handleUserJoined);
      socketService.off('user:left', handleUserLeft);
      socketService.off('clause:added', handleClauseAdded);
      socketService.off('clause:updated', handleClauseUpdated);
      socketService.off('clause:removed', handleClauseRemoved);
      socketService.off('comment:added', handleCommentAdded);
      socketService.off('comment:resolved', handleCommentResolved);
      socketService.off('status:changed', handleStatusChanged);
      socketService.off('risk:updated', handleRiskUpdated);
      socketService.leaveContract(contractId);
    };
  }, [contractId]);

  return {
    liveUsers,
    toasts,
    dismissToast,
  };
}
