import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  user: {
    id: string;
    email: string;
    role: string;
    organization_id: string;
  };
}

const OPS_ROLES = new Set(['SYSTEM_ADMIN', 'OPERATIONS']);

/**
 * Live Chat Support gateway. Mirrors the structure of CollaborationGateway
 * (same JWT-from-handshake auth, in-memory room map, namespace pattern) but
 * lives on its own `/support` namespace so it does not interfere with the
 * existing /collaboration socket.
 *
 * Rooms:
 *   - support:{chatId}        — the user + the assigned ops member(s)
 *   - ops:queue:{orgId}       — every ONLINE/AWAY ops user in that org;
 *                                receives queue + internal-note events
 *                                (NEVER emits internal notes to the user
 *                                 room — this isolation is critical).
 *   - ops:queue:global        — fallback for users with no organization_id
 *                                (personal-mode subscribers)
 */
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/support',
})
export class SupportGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SupportGateway.name);

  /** chatId → set of socketIds in the support:{chatId} room */
  private chatRooms = new Map<string, Set<string>>();

  constructor(private readonly configService: ConfigService) {}

  // ─── Connection Lifecycle ───────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Support client ${client.id} rejected: no token`);
        client.disconnect();
        return;
      }

      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = jwt.verify(token, secret!) as any;

      (client as AuthenticatedSocket).user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        organization_id: payload.organization_id,
      };

      // Ops users automatically join their org's queue room so they receive
      // queue updates and internal-note broadcasts in real time.
      if (OPS_ROLES.has(payload.role)) {
        const queueRoom = this.opsQueueRoom(payload.organization_id);
        client.join(queueRoom);
        this.logger.log(
          `Ops ${payload.email} joined queue room ${queueRoom}`,
        );
      }

      this.logger.log(
        `Support client connected: ${client.id} (user: ${payload.email}, role: ${payload.role})`,
      );
    } catch (err) {
      this.logger.warn(
        `Support client ${client.id} rejected: invalid token`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = (client as AuthenticatedSocket).user;
    if (!user) return;

    // Remove from all chat rooms
    for (const [chatId, sockets] of this.chatRooms.entries()) {
      if (sockets.has(client.id)) {
        sockets.delete(client.id);
        if (sockets.size === 0) this.chatRooms.delete(chatId);
      }
    }

    this.logger.log(`Support client disconnected: ${client.id}`);
  }

  // ─── Room Management ────────────────────────────────────────

  @SubscribeMessage('support:join')
  handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = (client as AuthenticatedSocket).user;
    if (!user || !data?.chatId) return;

    const roomKey = this.chatRoom(data.chatId);
    client.join(roomKey);

    if (!this.chatRooms.has(data.chatId)) {
      this.chatRooms.set(data.chatId, new Set());
    }
    this.chatRooms.get(data.chatId)!.add(client.id);

    this.logger.log(
      `User ${user.email} joined chat room ${roomKey}`,
    );
  }

  @SubscribeMessage('support:leave')
  handleLeaveChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = (client as AuthenticatedSocket).user;
    if (!user || !data?.chatId) return;

    const roomKey = this.chatRoom(data.chatId);
    client.leave(roomKey);

    const sockets = this.chatRooms.get(data.chatId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) this.chatRooms.delete(data.chatId);
    }
  }

  @SubscribeMessage('support:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = (client as AuthenticatedSocket).user;
    if (!user || !data?.chatId) return;

    // Broadcast to everyone in the room except the sender.
    client.to(this.chatRoom(data.chatId)).emit('support:typing', {
      chatId: data.chatId,
      userId: user.id,
      role: OPS_ROLES.has(user.role) ? 'OPS' : 'USER',
    });
  }

  @SubscribeMessage('support:stop_typing')
  handleStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string },
  ) {
    const user = (client as AuthenticatedSocket).user;
    if (!user || !data?.chatId) return;

    client.to(this.chatRoom(data.chatId)).emit('support:stop_typing', {
      chatId: data.chatId,
      userId: user.id,
    });
  }

  // ─── Event Emitters (called by services) ────────────────────

  emitMessage(chatId: string, payload: any) {
    this.server.to(this.chatRoom(chatId)).emit('support:message', payload);
  }

  emitAssigned(chatId: string, payload: any) {
    this.server.to(this.chatRoom(chatId)).emit('support:assigned', payload);
  }

  emitTransferred(chatId: string, payload: any) {
    this.server.to(this.chatRoom(chatId)).emit('support:transferred', payload);
  }

  emitClosed(chatId: string, payload: any) {
    this.server.to(this.chatRoom(chatId)).emit('support:closed', payload);
  }

  /**
   * Internal notes must NEVER reach the user. Always emits to the ops queue
   * room, never to the support:{chatId} room.
   */
  emitNoteAdded(organizationId: string | null, payload: any) {
    this.server
      .to(this.opsQueueRoom(organizationId))
      .emit('support:note_added', payload);
  }

  /**
   * Recompute & broadcast queue length / estimated wait to every ops member
   * in the org.
   */
  emitQueueUpdate(organizationId: string | null, payload: any) {
    this.server
      .to(this.opsQueueRoom(organizationId))
      .emit('support:queue_update', payload);
  }

  // ─── Helpers ────────────────────────────────────────────────

  private chatRoom(chatId: string): string {
    return `support:${chatId}`;
  }

  private opsQueueRoom(organizationId: string | null | undefined): string {
    return organizationId ? `ops:queue:${organizationId}` : 'ops:queue:global';
  }
}
