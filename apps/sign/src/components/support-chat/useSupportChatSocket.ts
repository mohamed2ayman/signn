import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { supportSocketService } from '@/services/supportSocketService';
import {
  appendMessage,
  patchActiveChat,
  setConnectionState,
  setShowCsat,
  addTypingUser,
  removeTypingUser,
} from '@/store/slices/supportChatSlice';
import type { SupportChat, SupportChatMessage } from '@/services/api/supportChatService';

/**
 * Mounts the /support socket, joins the active chat room, and pipes server
 * events into the supportChat Redux slice. Handles reconnects automatically
 * (socket.io re-emits 'connect' on reconnect — we re-join the room).
 */
export function useSupportChatSocket(activeChatId: string | null) {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!activeChatId) return;

    dispatch(setConnectionState('connecting'));
    let socket;
    try {
      socket = supportSocketService.connect();
    } catch {
      dispatch(setConnectionState('error'));
      return;
    }

    const handleConnect = () => {
      dispatch(setConnectionState('connected'));
      supportSocketService.joinChat(activeChatId);
    };
    const handleDisconnect = () => {
      dispatch(setConnectionState('idle'));
    };
    const handleMessage = (msg: SupportChatMessage) => {
      if (msg.chat_id === activeChatId) dispatch(appendMessage(msg));
    };
    const handleAssigned = (payload: any) => {
      if (payload.chatId === activeChatId) {
        dispatch(
          patchActiveChat({
            status: 'ACTIVE',
            assigned_ops_id: payload.opsId,
          } as Partial<SupportChat>),
        );
      }
    };
    const handleTransferred = (payload: any) => {
      if (payload.chatId === activeChatId) {
        dispatch(
          patchActiveChat({
            assigned_ops_id: payload.toOpsId,
          } as Partial<SupportChat>),
        );
      }
    };
    const handleClosed = (payload: any) => {
      if (payload.chatId === activeChatId) {
        dispatch(patchActiveChat({ status: 'CLOSED' } as Partial<SupportChat>));
        dispatch(setShowCsat(true));
      }
    };
    const handleTyping = (payload: { chatId: string; userId: string }) => {
      if (payload.chatId === activeChatId) dispatch(addTypingUser(payload.userId));
    };
    const handleStopTyping = (payload: { chatId: string; userId: string }) => {
      if (payload.chatId === activeChatId) dispatch(removeTypingUser(payload.userId));
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('support:message', handleMessage);
    socket.on('support:assigned', handleAssigned);
    socket.on('support:transferred', handleTransferred);
    socket.on('support:closed', handleClosed);
    socket.on('support:typing', handleTyping);
    socket.on('support:stop_typing', handleStopTyping);

    if (socket.connected) {
      dispatch(setConnectionState('connected'));
      supportSocketService.joinChat(activeChatId);
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('support:message', handleMessage);
      socket.off('support:assigned', handleAssigned);
      socket.off('support:transferred', handleTransferred);
      socket.off('support:closed', handleClosed);
      socket.off('support:typing', handleTyping);
      socket.off('support:stop_typing', handleStopTyping);
      supportSocketService.leaveChat(activeChatId);
    };
  }, [activeChatId, dispatch]);
}
